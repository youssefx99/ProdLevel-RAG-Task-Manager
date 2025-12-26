import { Module } from '@nestjs/common';
import { OllamaModule } from '../llm/ollama.module';
import { EmbeddingsService } from './embeddings.service';

@Module({
  imports: [OllamaModule],
  providers: [EmbeddingsService],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
