import { Module } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';

@Module({
  providers: [KnowledgeService],
  controllers: [KnowledgeController],
})
export class KnowledgeModule {}
