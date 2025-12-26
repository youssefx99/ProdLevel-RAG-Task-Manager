import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Team } from '../teams/team.entity';

export enum UserRole {
  ADMIN = 'admin',
  MEMBER = 'member',
}

@Entity('user')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ select: false })
  password: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.MEMBER })
  role: UserRole;

  @Column({ nullable: true })
  teamId: string;

  @ManyToOne(() => Team, (team) => team.users, { eager: false })
  @JoinColumn({ name: 'teamId' })
  team: Team;

  @OneToMany('Task', 'assignee')
  tasks: any[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
