import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OllamaService } from './ollama.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 120000, // 2 minutes default timeout
      maxRedirects: 5,
    }),
  ],
  providers: [OllamaService],
  exports: [OllamaService],
})
export class OllamaModule {}
