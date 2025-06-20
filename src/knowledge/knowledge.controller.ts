import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  Body,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
          cb(null, true);
        } else {
          cb(
            new BadRequestException('Seuls les fichiers PDF sont autorisés'),
            false,
          );
        }
      },
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max par fichier
      },
    }),
  )
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: { urls?: string[] },
  ) {
    const pdfResults = [];
    const urlResults = [];

    if (files?.length > 0) {
      const r = await Promise.all(
        files.map((file) => this.knowledgeService.ingestPdfFile(file)),
      );
      pdfResults.push(...r);
    }
    if (body.urls) {
      const r = await Promise.all(
        body.urls.map((url) => this.knowledgeService.ingestUrl(url)),
      );
      urlResults.push(...r);
    }

    const results = [...pdfResults, ...urlResults];

    return {
      message: `${results.length} Document(s) traité(s) avec succès`,
      totalFiles: files?.length || 0,
      totalUrls: body?.urls?.length || 0,
      results: results,
    };
  }

  @Post('search')
  async search(@Body() body: { query: string }) {
    return this.knowledgeService.search(body.query);
  }
}
