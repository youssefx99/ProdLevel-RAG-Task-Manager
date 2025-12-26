import { DataSource } from 'typeorm';
import { faker } from '@faker-js/faker';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from '../users/user.entity';
import { Team } from '../teams/team.entity';
import { Project } from '../projects/project.entity';
import { Task, TaskStatus } from '../tasks/task.entity';

const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'task_manager',
  entities: [User, Team, Project, Task],
  synchronize: false,
});

async function seed() {
  try {
    console.log('🌱 Starting seeding...');

    // Initialize connection
    await AppDataSource.initialize();
    console.log('✅ Database connected');

    // Clear existing data (disable FK checks temporarily)
    console.log('🗑️  Clearing existing data...');
    await AppDataSource.query('SET FOREIGN_KEY_CHECKS = 0;');
    await AppDataSource.getRepository(Task).clear();
    await AppDataSource.getRepository(User).clear();
    await AppDataSource.getRepository(Team).clear();
    await AppDataSource.getRepository(Project).clear();
    await AppDataSource.query('SET FOREIGN_KEY_CHECKS = 1;');
    console.log('✅ Existing data cleared');

    const hashedPassword = await bcrypt.hash('password123', 10);

    // Create 10 projects
    console.log('📦 Creating 10 projects...');
    const projects: Project[] = [];
    for (let i = 0; i < 10; i++) {
      const project = AppDataSource.getRepository(Project).create({
        name: faker.company.name() + ' Project',
        description: faker.company.catchPhrase(),
      });
      await AppDataSource.getRepository(Project).save(project);
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
        const owner = AppDataSource.getRepository(User).create({
          email: faker.internet.email().toLowerCase(),
          password: hashedPassword,
          name: faker.person.fullName(),
          role: UserRole.MEMBER,
        });
        await AppDataSource.getRepository(User).save(owner);
        allUsers.push(owner);

        // Create team
        const team = AppDataSource.getRepository(Team).create({
          name: faker.commerce.department() + ' Team',
          projectId: project.id,
          ownerId: owner.id,
        });
        await AppDataSource.getRepository(Team).save(team);
        teams.push(team);

        // Update owner's teamId
        owner.teamId = team.id;
        await AppDataSource.getRepository(User).save(owner);

        // Create 1-3 more users for this team (2-4 total including owner)
        const userCount = faker.number.int({ min: 1, max: 3 });
        for (let j = 0; j < userCount; j++) {
          const user = AppDataSource.getRepository(User).create({
            email: faker.internet.email().toLowerCase(),
            password: hashedPassword,
            name: faker.person.fullName(),
            role: UserRole.MEMBER,
            teamId: team.id,
          });
          await AppDataSource.getRepository(User).save(user);
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
        const task = AppDataSource.getRepository(Task).create({
          title: faker.hacker.phrase(),
          description: faker.lorem.sentence(),
          status: faker.helpers.arrayElement(taskStatuses),
          assignedTo: user.id,
          deadline: faker.date.future(),
        });
        await AppDataSource.getRepository(Task).save(task);
        taskCount++;
      }
    }
    console.log(`✅ Created ${taskCount} tasks`);

    // Create admin user
    console.log('👑 Creating admin user...');
    const admin = AppDataSource.getRepository(User).create({
      email: 'admin@example.com',
      password: hashedPassword,
      name: 'Admin User',
      role: UserRole.ADMIN,
    });
    await AppDataSource.getRepository(User).save(admin);
    console.log('✅ Admin user created');
    console.log('   Email: admin@example.com');
    console.log('   Password: password123');

    console.log('\n🎉 Seeding completed successfully!');
    console.log(`\n📊 Summary:`);
    console.log(`   Projects: ${projects.length}`);
    console.log(`   Teams: ${teams.length}`);
    console.log(`   Users: ${allUsers.length + 1} (including admin)`);
    console.log(`   Tasks: ${taskCount}`);
    console.log(`\n💡 All users have password: password123`);

    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    await AppDataSource.destroy();
    process.exit(1);
  }
}

seed();
