import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { ConfigModule } from '@nestjs/config';
import { StateGraphModule } from './state-graph/state-graph.module';

@Module({
  imports: [
    KnowledgeModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    StateGraphModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
