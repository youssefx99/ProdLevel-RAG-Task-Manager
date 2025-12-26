#!/usr/bin/env ts-node
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { ChatRequestDto } from '../dto/chat.dto';

/**
 * Test chat script - Debug the complete RAG pipeline
 * Usage: npm run test:chat
 */

async function bootstrap() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║         RAG Pipeline - Debug Test Script          ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const ragService = app.get(RagService);

    // Test queries
    const queries = [
      'Show me all overdue tasks',
      'Who are the members of the backend team?',
      'What projects are currently active?',
      'List all tasks for John',
    ];

    console.log('📝 Running test queries...\n');

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      console.log(`\n${'━'.repeat(80)}`);
      console.log(`TEST ${i + 1}/${queries.length}: ${query}`);
      console.log(`${'━'.repeat(80)}\n`);

      const request: ChatRequestDto = {
        query,
      };

      const response = await ragService.processQuery(request);

      console.log('\n📊 RESULTS:');
      console.log('─'.repeat(80));
      console.log(`Answer: ${response.answer}`);
      console.log();
      console.log(`Sources (${response.sources.length}):`);
      response.sources.forEach((source, idx) => {
        console.log(`  ${idx + 1}. [${source.entityType}] ${source.citation}`);
        console.log(`     Score: ${source.score.toFixed(3)}`);
        console.log(`     Text: ${source.text.substring(0, 100)}...`);
      });
      console.log();
      console.log(`Confidence: ${(response.confidence * 100).toFixed(1)}%`);
      console.log(`Processing Time: ${response.metadata.processingTime}ms`);
      console.log(`Classification: ${response.metadata.queryClassification}`);
      console.log(`Retrieved Docs: ${response.metadata.retrievedDocuments}`);
      console.log();
      console.log('Steps Executed:');
      response.metadata.stepsExecuted.forEach((step, idx) => {
        console.log(`  ${idx + 1}. ${step}`);
      });

      // Wait before next query
      if (i < queries.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log('║              All Tests Complete! ✅                ║');
    console.log('╚═══════════════════════════════════════════════════╝');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
