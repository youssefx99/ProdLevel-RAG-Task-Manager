import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { TeamsModule } from './teams/teams.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import databaseConfig from './config/database.config';
import qdrantConfig from './config/qdrant.config';

@Module({
  imports: [
    // Global config
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, qdrantConfig],
      envFilePath: '.env',
    }),

    // Database connection
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => {
        return config.get<TypeOrmModuleOptions>('database')!;
      },
    }),

    // Auth module
    AuthModule,

    // AI module
    AiModule,

    // Feature modules
    UsersModule,
    TeamsModule,
    ProjectsModule,
    TasksModule,
  ],
})
export class AppModule {}
