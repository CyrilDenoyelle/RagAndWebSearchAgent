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

  @Post('upload-pdf')
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
  async uploadPdfs(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    const results = await Promise.all(
      files.map((file) => this.knowledgeService.ingestPdfFile(file)),
    );

    return {
      message: `${files.length} PDF(s) traité(s) avec succès`,
      totalFiles: files.length,
      results: results.map((result, index) => ({
        fileName: files[index].originalname,
        ...result,
      })),
    };
  }

  @Post('search')
  async search(@Body() body: { query: string }) {
    return this.knowledgeService.search(body.query);
  }
}
