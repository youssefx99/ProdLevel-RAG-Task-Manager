#!/usr/bin/env ts-node
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { IndexingService } from '../indexing/indexing.service';
import { QdrantService } from '../vector-store/qdrant.service';

/**
 * Bulk indexing script to index all existing database records
 * Usage: npm run index:all
 */

async function bootstrap() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║         Task Manager - Bulk Indexing Script       ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log();

  // Create NestJS application context
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    // Get services
    const indexingService = app.get(IndexingService);
    const qdrantService = app.get(QdrantService);

    // Step 1: Verify Qdrant connection
    console.log('📡 Connecting to Qdrant...');
    await qdrantService.initialize();
    console.log('✓ Qdrant connection verified\n');

    // Step 2: Check/create collection
    console.log('📦 Verifying collection...');
    const collectionName = 'task_manager';
    const collectionInfo = await qdrantService.getCollection(collectionName);

    if (!collectionInfo.exists) {
      console.log('Creating collection with indices...');
      await qdrantService.createCollectionWithIndices();
      console.log('✓ Collection created successfully\n');
    } else {
      console.log(
        `✓ Collection ready (${collectionInfo.vectorCount || 0} existing vectors)\n`,
      );
    }

    // Step 3: Start indexing
    console.log('🚀 Starting bulk indexing...\n');
    console.log('─────────────────────────────────────────────────────');

    const startTime = Date.now();
    const stats = await indexingService.indexAll();
    const durationSeconds = (stats.duration / 1000).toFixed(2);
    const entitiesPerSecond = (stats.total / (stats.duration / 1000)).toFixed(
      1,
    );

    // Step 4: Print summary
    console.log('─────────────────────────────────────────────────────');
    console.log();
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║                   Summary                          ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log();
    console.log(`  📊 Indexing Statistics:`);
    console.log(`     Users:     ${stats.users.toString().padStart(4)}`);
    console.log(`     Teams:     ${stats.teams.toString().padStart(4)}`);
    console.log(`     Projects:  ${stats.projects.toString().padStart(4)}`);
    console.log(`     Tasks:     ${stats.tasks.toString().padStart(4)}`);
    console.log(`     ─────────────────`);
    console.log(`     Total:     ${stats.total.toString().padStart(4)}`);
    console.log();
    console.log(`  ⏱️  Performance:`);
    console.log(`     Duration:  ${durationSeconds}s`);
    console.log(`     Speed:     ${entitiesPerSecond} entities/second`);
    console.log();

    if (stats.errors.length === 0) {
      console.log('  ✅ All entities indexed successfully!');
    } else {
      console.log(`  ⚠️  ${stats.errors.length} errors encountered:`);
      stats.errors.slice(0, 10).forEach((error, idx) => {
        console.log(`     ${idx + 1}. ${error}`);
      });
      if (stats.errors.length > 10) {
        console.log(`     ... and ${stats.errors.length - 10} more errors`);
      }
    }

    console.log();
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║              Indexing Complete! 🎉                 ║');
    console.log('╚═══════════════════════════════════════════════════╝');
  } catch (error) {
    console.error();
    console.error('╔═══════════════════════════════════════════════════╗');
    console.error('║                    ERROR! ❌                       ║');
    console.error('╚═══════════════════════════════════════════════════╝');
    console.error();
    console.error(`Error: ${error.message}`);
    console.error();
    console.error('Stack trace:');
    console.error(error.stack);
    process.exit(1);
  } finally {
    await app.close();
  }
}

// Run the script
bootstrap().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
