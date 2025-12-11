import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { Team } from '../teams/team.entity';
import { Project } from '../projects/project.entity';
import { Task } from '../tasks/task.entity';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'task_manager',
    entities: [User, Team, Project, Task],
    synchronize: process.env.NODE_ENV !== 'production', // Auto-sync in dev only
    logging: process.env.NODE_ENV === 'development',
  }),
);
