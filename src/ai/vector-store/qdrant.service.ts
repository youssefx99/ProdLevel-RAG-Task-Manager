import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { QdrantConfig } from '../../config/qdrant.config';

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, any>;
}

export interface SearchResult {
  id: string;
  score: number;
  payload: Record<string, any>;
}

export interface CollectionInfo {
  exists: boolean;
  vectorCount?: number;
  vectorSize?: number;
  distance?: string;
}

@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private client: QdrantClient;
  private config: QdrantConfig;

  constructor(private configService: ConfigService) {
    this.config = this.configService.get<QdrantConfig>('qdrant')!;

    this.client = new QdrantClient({
      url: `${this.config.https ? 'https' : 'http'}://${this.config.host}:${this.config.port}`,
      apiKey: this.config.apiKey,
      timeout: this.config.timeout,
    });
  }

  /**
   * Initialize connection on module startup
   */
  async onModuleInit() {
    await this.initialize();
  }

  /**
   * Test connection to Qdrant and log status
   * Auto-creates collection with proper configuration if not exists
   */
  async initialize(): Promise<void> {
    try {
      this.logger.log('Connecting to Qdrant...');

      // Test connection by getting collections list
      await this.client.getCollections();

      this.logger.log(
        `✓ Connected to Qdrant at ${this.config.host}:${this.config.port}`,
      );

      // Check if main collection exists
      const collectionInfo = await this.getCollection(
        this.config.collectionName,
      );
      if (collectionInfo.exists) {
        this.logger.log(
          `✓ Collection "${this.config.collectionName}" found (${collectionInfo.vectorCount} vectors)`,
        );
      } else {
        // Auto-create collection in development
        if (process.env.NODE_ENV === 'development') {
          this.logger.log(
            `Creating collection "${this.config.collectionName}"...`,
          );
          await this.createCollectionWithIndices();
          this.logger.log(
            `✓ Collection "${this.config.collectionName}" created successfully`,
          );
        } else {
          this.logger.warn(
            `⚠ Collection "${this.config.collectionName}" does not exist. Please create it manually in production.`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`✗ Failed to connect to Qdrant: ${error.message}`);

      // Fail-fast in development
      if (process.env.NODE_ENV === 'development') {
        throw new Error(`Qdrant connection failed: ${error.message}`);
      }

      // Graceful degradation in production
      this.logger.warn(
        '⚠ AI features will be unavailable until Qdrant is accessible',
      );
    }
  }

  /**
   * Create collection with optimized configuration and payload indices
   */
  async createCollectionWithIndices(): Promise<void> {
    const collectionName = this.config.collectionName;
    const vectorSize = this.config.vectorSize;

    // Create collection with optimized settings
    await this.createCollection(collectionName, vectorSize, 'Cosine');

    // Create payload indices for efficient filtering
    this.logger.log('Creating payload indices...');

    try {
      // Index for entity type (keyword)
      await this.client.createPayloadIndex(collectionName, {
        field_name: 'entity_type',
        field_schema: 'keyword',
      });

      // Index for created_at (datetime)
      await this.client.createPayloadIndex(collectionName, {
        field_name: 'created_at',
        field_schema: 'datetime',
      });

      // Index for updated_at (datetime)
      await this.client.createPayloadIndex(collectionName, {
        field_name: 'updated_at',
        field_schema: 'datetime',
      });

      // Index for relationships.team_id (keyword)
      await this.client.createPayloadIndex(collectionName, {
        field_name: 'relationships.team_id',
        field_schema: 'keyword',
      });

      // Index for relationships.project_id (keyword)
      await this.client.createPayloadIndex(collectionName, {
        field_name: 'relationships.project_id',
        field_schema: 'keyword',
      });

      // Index for relationships.assigned_to (keyword)
      await this.client.createPayloadIndex(collectionName, {
        field_name: 'relationships.assigned_to',
        field_schema: 'keyword',
      });

      this.logger.log('✓ Payload indices created successfully');
    } catch (error) {
      this.logger.warn(
        `⚠ Some payload indices may already exist: ${error.message}`,
      );
    }
  }

  /**
   * Create a collection with specified vector size and distance metric
   */
  async createCollection(
    collectionName: string,
    vectorSize: number,
    distance: 'Cosine' | 'Euclid' | 'Dot' = 'Cosine',
  ): Promise<void> {
    try {
      // Check if collection already exists
      const exists = await this.collectionExists(collectionName);

      if (exists) {
        this.logger.log(
          `Collection "${collectionName}" already exists, skipping creation`,
        );
        return;
      }

      this.logger.log(
        `Creating collection "${collectionName}" with vector size ${vectorSize}...`,
      );

      await this.client.createCollection(collectionName, {
        vectors: {
          size: vectorSize,
          distance: distance,
        },
        optimizers_config: {
          indexing_threshold: 10000, // Start HNSW indexing after 10k vectors
        },
        hnsw_config: {
          m: 16, // Number of connections per node
          ef_construct: 100, // Quality of index construction
        },
      });

      // Create payload indices for filtering
      await this.createPayloadIndices(collectionName);

      this.logger.log(`✓ Collection "${collectionName}" created successfully`);
    } catch (error) {
      this.logger.error(
        `Failed to create collection "${collectionName}": ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Create payload indices for efficient filtering
   */
  private async createPayloadIndices(collectionName: string): Promise<void> {
    try {
      // Index for entity_type filtering
      await this.client.createPayloadIndex(collectionName, {
        field_name: 'entity_type',
        field_schema: 'keyword',
      });

      // Index for created_at filtering
      await this.client.createPayloadIndex(collectionName, {
        field_name: 'created_at',
        field_schema: 'datetime',
      });

      // Index for relationship filtering
      await this.client.createPayloadIndex(collectionName, {
        field_name: 'relationships.team_id',
        field_schema: 'keyword',
      });

      await this.client.createPayloadIndex(collectionName, {
        field_name: 'relationships.project_id',
        field_schema: 'keyword',
      });

      this.logger.log(`✓ Payload indices created for "${collectionName}"`);
    } catch (error) {
      this.logger.warn(
        `Warning: Failed to create some payload indices: ${error.message}`,
      );
    }
  }

  /**
   * Check if a collection exists
   */
  async collectionExists(collectionName: string): Promise<boolean> {
    try {
      const collections = await this.client.getCollections();
      return collections.collections.some((col) => col.name === collectionName);
    } catch (error) {
      this.logger.error(
        `Failed to check collection existence: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Insert a single vector with metadata
   */
  async insertVector(
    collectionName: string,
    id: string,
    vector: number[],
    payload: Record<string, any>,
  ): Promise<void> {
    try {
      // Validate vector dimensions
      if (vector.length !== this.config.vectorSize) {
        throw new Error(
          `Vector dimension mismatch: expected ${this.config.vectorSize}, got ${vector.length}`,
        );
      }

      // Generate numeric hash from string ID for Qdrant compatibility
      const numericId = this.stringToNumericId(id);

      await this.client.upsert(collectionName, {
        wait: true,
        points: [
          {
            id: numericId,
            vector: vector,
            payload: {
              ...payload,
              point_id: id, // Keep original string ID in payload
              indexed_at: new Date().toISOString(),
            },
          },
        ],
      });

      this.logger.debug(
        `✓ Inserted vector with id "${id}" (${numericId}) into "${collectionName}"`,
      );
    } catch (error) {
      this.logger.error(`Failed to insert vector "${id}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Convert string ID to numeric ID for Qdrant
   */
  private stringToNumericId(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Bulk insert vectors for efficiency
   */
  async insertVectorsBatch(
    collectionName: string,
    points: VectorPoint[],
    batchSize: number = 100,
  ): Promise<void> {
    try {
      this.logger.log(
        `Inserting ${points.length} vectors in batches of ${batchSize}...`,
      );

      // Process in batches
      for (let i = 0; i < points.length; i += batchSize) {
        const batch = points.slice(i, i + batchSize);

        // Validate all vectors in batch
        for (const point of batch) {
          if (point.vector.length !== this.config.vectorSize) {
            throw new Error(
              `Vector dimension mismatch for id "${point.id}": expected ${this.config.vectorSize}, got ${point.vector.length}`,
            );
          }
        }

        await this.client.upsert(collectionName, {
          wait: true,
          points: batch.map((point) => ({
            id: point.id,
            vector: point.vector,
            payload: {
              ...point.payload,
              indexed_at: new Date().toISOString(),
            },
          })),
        });

        const progress = Math.min(i + batchSize, points.length);
        this.logger.log(
          `Progress: ${progress}/${points.length} vectors inserted`,
        );
      }

      this.logger.log(`✓ Successfully inserted ${points.length} vectors`);
    } catch (error) {
      this.logger.error(`Failed to insert batch: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search for similar vectors
   */
  async searchVectors(
    collectionName: string,
    queryVector: number[],
    limit: number = 10,
    filter?: Record<string, any>,
  ): Promise<SearchResult[]> {
    try {
      // Validate query vector dimensions
      if (queryVector.length !== this.config.vectorSize) {
        throw new Error(
          `Query vector dimension mismatch: expected ${this.config.vectorSize}, got ${queryVector.length}`,
        );
      }

      const searchRequest: any = {
        vector: queryVector,
        limit: limit,
        with_payload: true,
      };

      // Add filter if provided
      if (filter && filter.must && filter.must.length > 0) {
        searchRequest.filter = filter;
      }

      const results = await this.client.search(collectionName, searchRequest);

      return results.map((result) => ({
        id: result.id.toString(),
        score: result.score,
        payload: result.payload || {},
      }));
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a single vector by ID
   */
  async deleteVector(collectionName: string, id: string): Promise<void> {
    try {
      await this.client.delete(collectionName, {
        wait: true,
        points: [id],
      });

      this.logger.debug(
        `✓ Deleted vector with id "${id}" from "${collectionName}"`,
      );
    } catch (error) {
      this.logger.error(`Failed to delete vector "${id}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Bulk delete vectors
   */
  async deleteVectorsBatch(
    collectionName: string,
    ids: string[],
  ): Promise<void> {
    try {
      this.logger.log(`Deleting ${ids.length} vectors...`);

      await this.client.delete(collectionName, {
        wait: true,
        points: ids,
      });

      this.logger.log(`✓ Successfully deleted ${ids.length} vectors`);
    } catch (error) {
      this.logger.error(`Failed to delete batch: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update a vector and/or its payload
   */
  async updateVector(
    collectionName: string,
    id: string,
    vector?: number[],
    payload?: Record<string, any>,
  ): Promise<void> {
    try {
      if (!vector && !payload) {
        throw new Error('Either vector or payload must be provided for update');
      }

      if (vector) {
        // If updating vector, validate dimensions
        if (vector.length !== this.config.vectorSize) {
          throw new Error(
            `Vector dimension mismatch: expected ${this.config.vectorSize}, got ${vector.length}`,
          );
        }

        // Update vector (this will also update payload if provided)
        await this.client.upsert(collectionName, {
          wait: true,
          points: [
            {
              id: id,
              vector: vector,
              payload: payload
                ? { ...payload, updated_at: new Date().toISOString() }
                : undefined,
            },
          ],
        });
      } else if (payload) {
        // Update only payload
        await this.client.setPayload(collectionName, {
          wait: true,
          payload: {
            ...payload,
            updated_at: new Date().toISOString(),
          },
          points: [id],
        });
      }

      this.logger.debug(`✓ Updated vector with id "${id}"`);
    } catch (error) {
      this.logger.error(`Failed to update vector "${id}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Get collection information
   */
  async getCollection(collectionName: string): Promise<CollectionInfo> {
    try {
      const exists = await this.collectionExists(collectionName);

      if (!exists) {
        return { exists: false };
      }

      const info = await this.client.getCollection(collectionName);

      // Safely extract vector config
      let vectorSize: number | undefined;
      let distance: string | undefined;

      const vectors = info.config.params.vectors;
      if (vectors && typeof vectors === 'object' && 'size' in vectors) {
        vectorSize = vectors.size as number;
        distance = vectors.distance as string;
      }

      return {
        exists: true,
        vectorCount: info.points_count || undefined,
        vectorSize: vectorSize,
        distance: distance,
      };
    } catch (error) {
      this.logger.error(`Failed to get collection info: ${error.message}`);
      return { exists: false };
    }
  }

  /**
   * Delete entire collection (use with caution!)
   */
  async deleteCollection(collectionName: string): Promise<void> {
    try {
      this.logger.warn(`⚠ Deleting collection "${collectionName}"...`);
      await this.client.deleteCollection(collectionName);
      this.logger.log(`✓ Collection "${collectionName}" deleted`);
    } catch (error) {
      this.logger.error(`Failed to delete collection: ${error.message}`);
      throw error;
    }
  }

  /**
   * Scroll through points with filter (no vector required)
   * ROOT FIX: For BM25 keyword search without embedding generation
   */
  async scrollPoints(
    collectionName: string,
    filter?: Record<string, any>,
    limit: number = 50,
  ): Promise<SearchResult[]> {
    try {
      const scrollRequest: any = {
        limit,
        with_payload: true,
        with_vector: false, // Don't need vectors for keyword search
      };

      if (filter && (filter.must?.length > 0 || filter.should?.length > 0)) {
        scrollRequest.filter = filter;
      }

      const results = await this.client.scroll(collectionName, scrollRequest);

      return (results.points || []).map((point) => ({
        id: point.id.toString(),
        score: 0, // Will be calculated by BM25
        payload: point.payload || {},
      }));
    } catch (error) {
      this.logger.error(`Scroll failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get Qdrant client for advanced operations
   */
  getClient(): QdrantClient {
    return this.client;
  }
}
