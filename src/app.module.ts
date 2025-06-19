import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    KnowledgeModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
