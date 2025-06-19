import { Injectable, BadRequestException } from '@nestjs/common';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';

@Injectable()
export class KnowledgeService {
  private readonly embeddings: OpenAIEmbeddings;
  private readonly vectorStore: MemoryVectorStore;

  constructor(private readonly configService: ConfigService) {
    this.embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-3-large',
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });
    this.vectorStore = new MemoryVectorStore(this.embeddings);
  }

  async ingestPdfFile(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    try {
      // Créer un Blob à partir du buffer du fichier
      const blob = new Blob([file.buffer], { type: 'application/pdf' });

      // Utiliser PDFLoader pour charger le PDF
      const loader = new PDFLoader(blob);
      const docs = await loader.load();

      // Découper les documents en chunks
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });

      const allSplits = await textSplitter.splitDocuments(docs);
      // Créer les embeddings pour les chunks
      const embeddingsVectors = await this.embeddings.embedDocuments(
        // docs.map((doc) => doc.pageContent),
        allSplits.map((split) => split.pageContent),
      );

      await this.vectorStore.addVectors(embeddingsVectors, allSplits);

      return {
        message: 'PDF ingéré avec succès',
        originalName: file.originalname,
        size: file.size,
        pages: docs.length,
        chunks: allSplits.length,
        documents: docs.map((doc, index) => ({
          page: index + 1,
          pageContent: doc.pageContent.substring(0, 200) + '...', // Aperçu du contenu
          metadata: doc.metadata,
        })),
        // Chunks découpés pour traitement
        splits: allSplits,
      };
    } catch (error) {
      throw new BadRequestException(
        `Erreur lors du traitement du PDF: ${error.message}`,
      );
    }
  }

  async search(query: string) {
    if (!query || query.trim() === '') {
      throw new BadRequestException('La requête ne peut pas être vide');
    }

    const embedding = await this.embeddings.embedQuery(query);

    const results = await this.vectorStore.similaritySearchVectorWithScore(
      embedding,
      1,
    );

    if (results.length === 0) {
      return {
        message:
          'Aucun résultat trouvé. Assurez-vous que des documents ont été ingérés.',
        results: [],
      };
    }

    return {
      message: `résultat trouvé`,
      results: results.map(([doc, score]) => ({
        content: doc.pageContent,
        metadata: doc.metadata,
        score: score,
      })),
    };
  }
}
