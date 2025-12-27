import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
  Logger,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { IndexingService } from '../ai/indexing/indexing.service';

@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly indexingService: IndexingService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createUserDto: CreateUserDto) {
    const user = await this.usersService.create(createUserDto);

    try {
      await this.indexingService.indexUser(user.id);
      this.logger.debug(`📊 Indexed user: ${user.id}`);
    } catch (error) {
      this.logger.warn(`Failed to index user: ${error.message}`);
    }

    return user;
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    return this.usersService.findAll(page, limit);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    const user = await this.usersService.update(id, updateUserDto);

    try {
      await this.indexingService.reindexEntity('user', id);
      this.logger.debug(`📊 Reindexed user: ${id}`);
    } catch (error) {
      this.logger.warn(`Failed to reindex user: ${error.message}`);
    }

    return user;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.usersService.remove(id);

    try {
      await this.indexingService.deleteFromIndex('user', id);
      this.logger.debug(`📊 Removed user from index: ${id}`);
    } catch (error) {
      this.logger.warn(`Failed to remove user from index: ${error.message}`);
    }
  }
}
