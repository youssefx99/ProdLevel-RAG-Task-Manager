import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { IndexingService } from '../indexing/indexing.service';

/**
 * Full Re-index Script
 * Indexes all entities + system info + statistics
 *
 * Usage: npm run reindex:all
 */
async function fullReindex() {
  console.log('🚀 Starting Full Re-index...\n');

  const app = await NestFactory.createApplicationContext(AppModule);
  const indexingService = app.get(IndexingService);

  try {
    // Index everything
    const stats = await indexingService.indexAll();

    console.log('\n✅ Full re-indexing completed successfully!');
    console.log(`\nSummary:`);
    console.log(`  Users:    ${stats.users}`);
    console.log(`  Teams:    ${stats.teams}`);
    console.log(`  Projects: ${stats.projects}`);
    console.log(`  Tasks:    ${stats.tasks}`);
    console.log(`  Total Entities: ${stats.total}`);
    console.log(`  Duration: ${(stats.duration / 1000).toFixed(2)}s`);

    if (stats.errors.length > 0) {
      console.log(`\n⚠️  Errors: ${stats.errors.length}`);
      stats.errors.forEach((err) => console.log(`  - ${err}`));
    }

    console.log('\n📋 System Info: Indexed');
    console.log('📊 Statistics: Indexed');
  } catch (error) {
    console.error('❌ Re-indexing failed:', error.message);
    process.exit(1);
  }

  await app.close();
  process.exit(0);
}

fullReindex();
