import { Test, TestingModule } from '@nestjs/testing';
import { DocumentTransformerService } from './document-transformer.service';
import { User, UserRole } from '../../users/user.entity';
import { Team } from '../../teams/team.entity';
import { Project } from '../../projects/project.entity';
import { Task, TaskStatus } from '../../tasks/task.entity';

describe('DocumentTransformerService', () => {
  let service: DocumentTransformerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DocumentTransformerService],
    }).compile();

    service = module.get<DocumentTransformerService>(
      DocumentTransformerService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('transformUser', () => {
    it('should transform user with team and tasks', () => {
      const user = new User();
      user.id = 'user-123';
      user.name = 'John Doe';
      user.email = 'john@example.com';
      user.role = UserRole.ADMIN;
      user.createdAt = new Date('2025-01-01');
      user.updatedAt = new Date('2025-12-14');

      const team = new Team();
      team.name = 'Backend Team';
      user.team = team;

      const task1 = new Task();
      task1.title = 'Database Optimization';
      task1.status = TaskStatus.IN_PROGRESS;

      const task2 = new Task();
      task2.title = 'API Development';
      task2.status = TaskStatus.TODO;

      user.tasks = [task1, task2];

      const result = service.transformUser(user);

      expect(result.text).toContain('John Doe');
      expect(result.text).toContain('john@example.com');
      expect(result.text).toContain('Admin');
      expect(result.text).toContain('Backend Team');
      expect(result.text).toContain('Database Optimization');
      expect(result.metadata.entity_type).toBe('user');
      expect(result.metadata.tasks_count).toBe(2);
    });
  });

  describe('transformTeam', () => {
    it('should transform team with members and project', () => {
      const team = new Team();
      team.id = 'team-123';
      team.name = 'Backend Team';
      team.createdAt = new Date('2025-01-01');
      team.updatedAt = new Date('2025-12-14');

      const owner = new User();
      owner.name = 'Jane Smith';
      owner.email = 'jane@example.com';
      owner.role = UserRole.ADMIN;
      team.owner = owner;

      const project = new Project();
      project.name = 'Infrastructure Project';
      project.description = 'Improve system scalability';
      team.project = project;

      const member1 = new User();
      member1.name = 'Alice';
      const member2 = new User();
      member2.name = 'Bob';
      team.users = [member1, member2];

      const result = service.transformTeam(team);

      expect(result.text).toContain('Backend Team');
      expect(result.text).toContain('Jane Smith');
      expect(result.text).toContain('Infrastructure Project');
      expect(result.text).toContain('2 members');
      expect(result.metadata.entity_type).toBe('team');
      expect(result.metadata.members_count).toBe(2);
    });
  });

  describe('transformTask', () => {
    it('should transform task with deadline and assignee', () => {
      const task = new Task();
      task.id = 'task-123';
      task.title = 'Database Optimization';
      task.description = 'Improve query performance';
      task.status = TaskStatus.IN_PROGRESS;
      task.createdAt = new Date('2025-12-01');
      task.updatedAt = new Date('2025-12-14');
      task.deadline = new Date('2025-12-20');

      const assignee = new User();
      assignee.name = 'John Doe';
      assignee.email = 'john@example.com';
      assignee.role = UserRole.MEMBER;
      task.assignee = assignee;

      const result = service.transformTask(task);

      expect(result.text).toContain('Database Optimization');
      expect(result.text).toContain('Improve query performance');
      expect(result.text).toContain('In Progress');
      expect(result.text).toContain('John Doe');
      expect(result.metadata.entity_type).toBe('task');
      expect(result.metadata.task_status).toBe(TaskStatus.IN_PROGRESS);
    });

    it('should detect overdue tasks', () => {
      const task = new Task();
      task.id = 'task-123';
      task.title = 'Overdue Task';
      task.status = TaskStatus.TODO;
      task.createdAt = new Date('2025-11-01');
      task.updatedAt = new Date('2025-12-14');
      task.deadline = new Date('2025-12-01'); // Past deadline

      const result = service.transformTask(task);

      expect(result.text).toContain('Overdue');
      expect(result.metadata.is_overdue).toBe(true);
    });
  });
});
