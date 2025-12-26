import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { IndexingService } from '../indexing/indexing.service';

/**
 * Index System Info & Statistics Only
 * Updates system requirements and app statistics
 *
 * Usage: npm run index:system
 */
async function indexSystem() {
  console.log('📋 Indexing System Information & Statistics...\n');

  const app = await NestFactory.createApplicationContext(AppModule);
  const indexingService = app.get(IndexingService);

  try {
    await indexingService.indexSystemInfo();
    await indexingService.indexStatistics();

    console.log('\n✅ System info and statistics indexed successfully!');
  } catch (error) {
    console.error('❌ Indexing failed:', error.message);
    process.exit(1);
  }

  await app.close();
  process.exit(0);
}

indexSystem();
