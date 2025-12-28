import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { faker } from '@faker-js/faker';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from './users/user.entity';
import { Team } from './teams/team.entity';
import { Project } from './projects/project.entity';
import { Task, TaskStatus } from './tasks/task.entity';

@Injectable()
export class AppService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Team)
    private teamRepository: Repository<Team>,
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async seedDatabase() {
    try {
      console.log('🌱 Starting seeding...');

      // Clear existing data (disable FK checks temporarily)
      console.log('🗑️  Clearing existing data...');
      await this.userRepository.query('SET FOREIGN_KEY_CHECKS = 0;');
      await this.taskRepository.clear();
      await this.userRepository.clear();
      await this.teamRepository.clear();
      await this.projectRepository.clear();
      await this.userRepository.query('SET FOREIGN_KEY_CHECKS = 1;');
      console.log('✅ Existing data cleared');

      const hashedPassword = await bcrypt.hash('password123', 10);

      // Create 10 projects
      console.log('📦 Creating 10 projects...');
      const projects: Project[] = [];
      for (let i = 0; i < 10; i++) {
        const project = this.projectRepository.create({
          name: faker.company.name() + ' Project',
          description: faker.company.catchPhrase(),
        });
        await this.projectRepository.save(project);
        projects.push(project);
      }
      console.log(`✅ Created ${projects.length} projects`);

      // Create 2-3 teams per project
      console.log('👥 Creating teams...');
      const teams: Team[] = [];
      const allUsers: User[] = [];

      for (const project of projects) {
        const teamCount = faker.number.int({ min: 2, max: 3 });

        for (let i = 0; i < teamCount; i++) {
          // Create team owner first
          const owner = this.userRepository.create({
            email: faker.internet.email().toLowerCase(),
            password: hashedPassword,
            name: faker.person.fullName(),
            role: UserRole.MEMBER,
          });
          await this.userRepository.save(owner);
          allUsers.push(owner);

          // Create team
          const team = this.teamRepository.create({
            name: faker.commerce.department() + ' Team',
            projectId: project.id,
            ownerId: owner.id,
          });
          await this.teamRepository.save(team);
          teams.push(team);

          // Update owner's teamId
          owner.teamId = team.id;
          await this.userRepository.save(owner);

          // Create 1-3 more users for this team
          const userCount = faker.number.int({ min: 1, max: 3 });
          for (let j = 0; j < userCount; j++) {
            const user = this.userRepository.create({
              email: faker.internet.email().toLowerCase(),
              password: hashedPassword,
              name: faker.person.fullName(),
              role: UserRole.MEMBER,
              teamId: team.id,
            });
            await this.userRepository.save(user);
            allUsers.push(user);
          }
        }
      }
      console.log(`✅ Created ${teams.length} teams`);
      console.log(`✅ Created ${allUsers.length} users`);

      // Create 3-5 tasks per user
      console.log('📝 Creating tasks...');
      let taskCount = 0;
      const taskStatuses = [
        TaskStatus.TODO,
        TaskStatus.IN_PROGRESS,
        TaskStatus.DONE,
      ];

      for (const user of allUsers) {
        const tasksPerUser = faker.number.int({ min: 3, max: 5 });

        for (let i = 0; i < tasksPerUser; i++) {
          const task = this.taskRepository.create({
            title: faker.hacker.phrase(),
            description: faker.lorem.sentence(),
            status: faker.helpers.arrayElement(taskStatuses),
            assignedTo: user.id,
            deadline: faker.date.future(),
          });
          await this.taskRepository.save(task);
          taskCount++;
        }
      }
      console.log(`✅ Created ${taskCount} tasks`);

      // Create admin user
      console.log('👑 Creating admin user...');
      const admin = this.userRepository.create({
        email: 'admin@example.com',
        password: hashedPassword,
        name: 'Admin User',
        role: UserRole.ADMIN,
      });
      await this.userRepository.save(admin);
      console.log('✅ Admin user created');

      return {
        success: true,
        message: '🎉 Seeding completed successfully!',
        summary: {
          projects: projects.length,
          teams: teams.length,
          users: allUsers.length + 1,
          tasks: taskCount,
        },
        credentials: {
          email: 'admin@example.com',
          password: 'password123',
          note: 'All users have password: password123',
        },
      };
    } catch (error) {
      console.error('❌ Error during seeding:', error);
      return {
        success: false,
        message: 'Error during seeding',
        error: error.message,
      };
    }
  }
}
