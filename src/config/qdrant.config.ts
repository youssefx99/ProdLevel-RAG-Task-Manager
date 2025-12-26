import { registerAs } from '@nestjs/config';

export interface QdrantConfig {
  host: string;
  port: number;
  apiKey?: string;
  https: boolean;
  timeout: number;
  collectionName: string;
  vectorSize: number;
}

export default registerAs(
  'qdrant',
  (): QdrantConfig => ({
    host: process.env.QDRANT_HOST || 'localhost',
    port: parseInt(process.env.QDRANT_PORT || '6333', 10),
    apiKey: process.env.QDRANT_API_KEY || undefined,
    https: process.env.QDRANT_HTTPS === 'true',
    timeout: parseInt(process.env.QDRANT_TIMEOUT || '30000', 10),
    collectionName: process.env.QDRANT_COLLECTION_NAME || 'task_manager',
    vectorSize: parseInt(process.env.QDRANT_VECTOR_SIZE || '768', 10),
  }),
);
