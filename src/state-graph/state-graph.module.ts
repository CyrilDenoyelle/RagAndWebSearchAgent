import { Module } from '@nestjs/common';
import { StateGraphService } from './state-graph.service';
import { KnowledgeModule } from 'src/knowledge/knowledge.module';
import { StateGraphController } from './state-graph.controller';

@Module({
  imports: [KnowledgeModule],
  providers: [StateGraphService],
  controllers: [StateGraphController],
})
export class StateGraphModule {}
