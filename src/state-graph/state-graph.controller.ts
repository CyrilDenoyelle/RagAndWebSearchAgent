import { Body, Controller, Post } from '@nestjs/common';
import { StateGraphService } from './state-graph.service';

@Controller('state-graph')
export class StateGraphController {
  constructor(private readonly stateGraphService: StateGraphService) {}

  @Post('run')
  async run(@Body() body: { question: string }) {
    const lastState = await this.stateGraphService.run(body.question);
    return {
      content: lastState.messages[lastState.messages.length - 1].content,
    };
  }
}
