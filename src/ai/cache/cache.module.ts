import { Module } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    NestCacheModule.register({
      ttl: 300, // 5 minutes default TTL
      max: 100, // Maximum number of items in cache
      isGlobal: true,
    }),
  ],
  exports: [NestCacheModule],
})
export class CacheModule {}
