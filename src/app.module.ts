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
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { User } from './users/user.entity';
import { Team } from './teams/team.entity';
import { Project } from './projects/project.entity';
import { Task } from './tasks/task.entity';
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

    // Import entities for seeding
    TypeOrmModule.forFeature([User, Team, Project, Task]),

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
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
