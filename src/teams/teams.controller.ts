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
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { IndexingService } from '../ai/indexing/indexing.service';

@Controller('teams')
export class TeamsController {
  private readonly logger = new Logger(TeamsController.name);

  constructor(
    private readonly teamsService: TeamsService,
    private readonly indexingService: IndexingService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createTeamDto: CreateTeamDto) {
    const team = await this.teamsService.create(createTeamDto);

    try {
      await this.indexingService.indexTeam(team.id);
      this.logger.debug(`📊 Indexed team: ${team.id}`);
    } catch (error) {
      this.logger.warn(`Failed to index team: ${error.message}`);
    }

    return team;
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    return this.teamsService.findAll(page, limit);
  }

  @Get('count')
  count() {
    return this.teamsService.count();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.teamsService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateTeamDto: UpdateTeamDto) {
    const team = await this.teamsService.update(id, updateTeamDto);

    try {
      await this.indexingService.reindexEntity('team', id);
      this.logger.debug(`📊 Reindexed team: ${id}`);
    } catch (error) {
      this.logger.warn(`Failed to reindex team: ${error.message}`);
    }

    return team;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.teamsService.remove(id);

    try {
      await this.indexingService.deleteFromIndex('team', id);
      this.logger.debug(`📊 Removed team from index: ${id}`);
    } catch (error) {
      this.logger.warn(`Failed to remove team from index: ${error.message}`);
    }
  }
}
