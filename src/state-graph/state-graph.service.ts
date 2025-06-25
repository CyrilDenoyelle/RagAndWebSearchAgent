import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { Runnable, RunnableConfig } from '@langchain/core/runnables';
import { StructuredTool, Tool, tool } from '@langchain/core/tools';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import { ChatOpenAI } from '@langchain/openai';
import { Injectable } from '@nestjs/common';
import { TavilySearch } from '@langchain/tavily';
import {
  Annotation,
  AnnotationRoot,
  BaseChannel,
  END,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { KnowledgeService } from 'src/knowledge/knowledge.service';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { writeFileSync } from 'node:fs';
import { ToolCall } from '@langchain/core/dist/messages/tool';

// Types pour les node du graphe d'état
type NodeNames = 'Coordinator' | 'Rag' | 'Tavily';

// Type pour l'état de l'agent avec les annotations LangGraph
// Définit la structure des données partagées entre les node
type AgentState = AnnotationRoot<{
  messages: BaseChannel<BaseMessage[], BaseMessage[], BaseMessage[]>;
  sender: BaseChannel<BaseChannel<string, string, string>, string, string>;
}>;

/**
 * Service principal pour gérer le StateGraph
 * Coordonne les échanges entre différents agents spécialisés
 */
@Injectable()
// Agents spécialisés pour différentes tâches
export class StateGraphService {
  // Agent pour la recherche dans la base de connaissances
  private knowledgeAgent: Runnable;
  // Agent pour la recherche web
  private tavilyAgent: Runnable;
  // Agent coordinateur qui orchestre les autres agents
  private coordinatorAgent: Runnable;
  // private workflow: StateGraph<AgentState, NodeNames>; // type error
  private workflow: any;
  // Graphe compilé pour l'exécution
  private graph: ReturnType<StateGraph<AgentState, NodeNames>['compile']>;
  private knowledgeTool: Tool;
  private tavilyTool: TavilySearch;

  constructor(private readonly knowledgeService: KnowledgeService) {
    this.init();
  }

  /**
   * Point d'entrée principal pour exécuter le workflow d'agents
   * @param input Question ou requête de l'utilisateur
   * @returns Résultat du traitement par les agents
   */
  async run(input: string) {
    return this.graph.invoke({
      messages: [{ role: 'user', content: input }],
      config: { recursionLimit: 25 },
    });
  }

  /**
   * Initialise tous les composants du service :
   * - Crée les tools (RAG, Tavily)
   * - Configure les agents spécialisés
   * - Construit le graphe d'état
   */
  // Création de l'outil RAG pour la recherche dans la base de connaissances
  async init(): Promise<void> {
    this.knowledgeTool = tool(
      async (input: string): Promise<string> => {
        const result = await this.knowledgeService.search(input);
        return typeof result === 'string' ? result : JSON.stringify(result);
      },
      {
        name: 'rag_search',
        description: 'Search in the knowledge base to answer to the question.',
      },
    );

    this.tavilyTool = new TavilySearch();

    this.coordinatorAgent = await this.createAgent({
      llm: new ChatOpenAI({ model: 'gpt-4o-mini' }),
      tools: [],
      systemMessage: `Your role is to coordinate the flow between the user and the specialized agents.
First, take the user's question and forward it as-is to the research agents.
Then, wait for both responses.
Once you have both, merge the information in a clear and structured way:
- first section should be "Documents" present the answer from the RAG agent,
- then should be a section "Web" the one from the Tavily agent,
- and finally provide a short summary or conclusion synthesizing both sources.

add FINAL ANSWER to the answer
Do not try to answer the question yourself before querying the agents.`,
    });

    this.knowledgeAgent = await this.createAgent({
      llm: new ChatOpenAI({ model: 'gpt-4o-mini' }),
      tools: [this.knowledgeTool],
      systemMessage:
        'Your role is to search in the knowledge base to answer to the question.',
    });

    this.tavilyAgent = await this.createAgent({
      llm: new ChatOpenAI({ model: 'gpt-4o-mini' }),
      tools: [this.tavilyTool],
      systemMessage:
        'Your role is to search online. You are given a question and you need to search the web for the answer.',
    });

    const agentState = Annotation.Root({
      // Concatène les messages
      messages: Annotation<BaseMessage[]>({
        reducer: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
      }),
      sender: Annotation<string>({
        // Garde le dernier expéditeur
        reducer: (x: string, y: string) => y ?? x ?? 'user',
        default: () => 'user',
      }),
    });

    const toolNode = new ToolNode<typeof agentState.State>([
      this.knowledgeTool,
      this.tavilyTool,
    ]);

    /**
     * Fonction helper pour exécuter un node d'agent
     * Gère la conversion des résultats en format compatible avec StateGraph
     */
    async function runAgentNode(props: {
      state: typeof agentState.State;
      agent: Runnable;
      name: string;
      config?: RunnableConfig;
    }): Promise<{
      messages: BaseMessage[];
      sender: string;
    }> {
      const { state, agent, name, config } = props;
      let result = await agent.invoke(state, config);
      // Si l'agent n'appelle pas d'outil, on convertit le résultat en message humain
      if (!result?.tool_calls || result.tool_calls.length === 0) {
        result = new HumanMessage({ ...result, name: name });
      }
      return {
        messages: [result],
        // Marque l'expéditeur pour le routeur
        sender: name,
      };
    }

    // Ajout des nodes au graph
    this.workflow = new StateGraph(agentState)
      .addNode(
        'Coordinator',
        (state: typeof agentState.State, config?: RunnableConfig) =>
          runAgentNode({
            state,
            agent: this.coordinatorAgent,
            name: 'Coordinator',
            config,
          }),
      )
      .addNode(
        'Rag',
        (state: typeof agentState.State, config?: RunnableConfig) =>
          runAgentNode({
            state,
            agent: this.knowledgeAgent,
            name: 'Rag',
            config,
          }),
      )
      .addNode(
        'Tavily',
        (state: typeof agentState.State, config?: RunnableConfig) => {
          // filtrer les messages de recherche RAG pour empêcher Tavily d'utiliser ces données au lieu de chercher sur le web
          const messages = state.messages.filter((e) => {
            if (
              'tool_calls' in e &&
              Array.isArray(e.tool_calls) &&
              e.tool_calls.length > 0
            )
              return (
                e.tool_calls.findIndex(
                  (toolCall: ToolCall) => toolCall.name === 'rag_search',
                ) === -1
              );
            else return !['Rag', 'rag_search'].includes(e.name);
          });

          return runAgentNode({
            state: {
              ...state,
              messages,
            },
            agent: this.tavilyAgent,
            name: 'Tavily',
            config,
          });
        },
      )
      .addNode('call_tool', toolNode);

    /**
     * Routeur qui détermine le prochain node à exécuter
     * Basée sur le contenu et le type du dernier message
     */
    function router(state: typeof agentState.State): string {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as AIMessage;
      if (lastMessage?.tool_calls && lastMessage.tool_calls.length > 0) {
        // l'agent précédent appelle un tool
        return 'call_tool';
      }
      // Si le message contient "FINAL ANSWER", terminer l'exécution
      if (
        typeof lastMessage.content === 'string' &&
        lastMessage.content.includes('FINAL ANSWER')
      ) {
        return 'end';
      }
      return 'continue';
    }

    // Configuration des edges conditionnelles du graph
    this.workflow
      // Point de départ vers le coordinateur
      .addEdge(START, 'Coordinator')
      .addConditionalEdges('Coordinator', router, {
        // Si continue, aller au node RAG
        continue: 'Rag',
        // Si fin, terminer
        end: END,
      })
      .addConditionalEdges('Rag', router, {
        continue: 'Tavily',
        call_tool: 'call_tool',
      })
      .addConditionalEdges('Tavily', router, {
        continue: 'Coordinator',
        call_tool: 'call_tool',
      })
      .addConditionalEdges(
        'call_tool',
        // Après l'exécution d'un outil, retourner à l'agent qui l'a appelé
        (state: typeof agentState.State): string => state.sender,
        {
          Tavily: 'Tavily',
          Rag: 'Rag',
        },
      );

    this.graph = this.workflow.compile();

    // Génération d'une image du StateGraph
    const graphStateImage = await (
      await this.graph.getGraphAsync()
    ).drawMermaidPng();
    const graphStateArrayBuffer = await graphStateImage.arrayBuffer();

    const filePath = './graphState.png';
    writeFileSync(filePath, new Uint8Array(graphStateArrayBuffer));
  }

  /**
   * Crée un agent avec les tools et la configuration spécifiés
   * @param llm Modèle de langage à utiliser
   * @param tools disponibles pour l'agent
   * @param systemMessage définissant le rôle de l'agent
   * @returns agent invocable
   */
  async createAgent({
    llm,
    tools,
    systemMessage,
  }: {
    llm: ChatOpenAI;
    tools: StructuredTool[];
    systemMessage: string;
  }): Promise<Runnable> {
    const toolNames = tools.map((tool) => tool.name).join(', ');
    const formattedTools = tools.map((t) => convertToOpenAITool(t));

    // Création du template de prompt avec le message système et les tools
    const promptTemplate = ChatPromptTemplate.fromMessages([
      [
        'system',
        'You are a helpful AI assistant, collaborating with other assistants.' +
          ' Use the provided tools to progress towards answering the question.' +
          ' You have access to the following tools: {tool_names}.\n{system_message}',
      ],
      new MessagesPlaceholder('messages'),
    ]);
    const prompt = await promptTemplate.partial({
      system_message: systemMessage,
      tool_names: toolNames,
    });

    // Retourne l'agent avec les tools liés
    return prompt.pipe(llm.bindTools(formattedTools));
  }
}
