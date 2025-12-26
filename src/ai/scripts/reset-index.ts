#!/usr/bin/env ts-node
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { QdrantService } from '../vector-store/qdrant.service';
import * as readline from 'readline';

/**
 * Reset index script - Deletes and recreates the Qdrant collection
 * Usage: npm run index:reset
 */

async function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function bootstrap() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║         Task Manager - Reset Index Script         ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log();
  console.log('⚠️  WARNING: This will DELETE all indexed data!');
  console.log();

  const confirmed = await askConfirmation(
    'Are you sure you want to reset the index? (y/N): ',
  );

  if (!confirmed) {
    console.log('❌ Operation cancelled.');
    process.exit(0);
  }

  // Create NestJS application context
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    // Get service
    const qdrantService = app.get(QdrantService);

    // Step 1: Connect to Qdrant
    console.log();
    console.log('📡 Connecting to Qdrant...');
    await qdrantService.initialize();
    console.log('✓ Connected\n');

    // Step 2: Check if collection exists
    const collectionName = 'task_manager';
    const collectionInfo = await qdrantService.getCollection(collectionName);

    if (collectionInfo.exists) {
      console.log(`🗑️  Deleting collection "${collectionName}"...`);
      console.log(`   Current vectors: ${collectionInfo.vectorCount || 0}`);

      // Delete collection
      await qdrantService.deleteCollection(collectionName);
      console.log('✓ Collection deleted\n');
    } else {
      console.log(`⚠️  Collection "${collectionName}" does not exist\n`);
    }

    // Step 3: Recreate collection
    console.log('📦 Creating new collection with indices...');
    await qdrantService.createCollectionWithIndices();
    console.log('✓ Collection recreated successfully\n');

    // Step 4: Summary
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║              Index Reset Complete! ✅              ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log();
    console.log('Next steps:');
    console.log('  1. Run "npm run index:all" to reindex all entities');
    console.log('  2. Or index incrementally as entities are created/updated');
    console.log();
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
