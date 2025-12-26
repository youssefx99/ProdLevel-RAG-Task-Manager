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
import { User } from '../users/user.entity';

@Entity('team')
export class Team {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  projectId: string;

  @ManyToOne('Project', 'teams')
  @JoinColumn({ name: 'projectId' })
  project: any;

  @Column()
  ownerId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @OneToMany(() => User, (user) => user.team)
  users: User[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
