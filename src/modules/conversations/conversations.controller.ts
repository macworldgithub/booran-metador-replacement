import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import {
  QueryProspectsDto,
  SendStaffMessageDto,
  AddInternalNoteDto,
  UpdateJourneyDto,
  SetOutcomeDto,
  AssignProspectDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { PortalActor } from './conversations.service';

@ApiTags('Conversation Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/prospects')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List prospects for portal inbox',
    description:
      "Filterable by rooftop, status, owner, or search term. Sorted by latest inbound first. Scoped to the calling user's assigned rooftops.",
  })
  @ApiResponse({ status: 200, description: 'Filtered list of prospects' })
  getProspects(
    @Query() query: QueryProspectsDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.conversationsService.getProspects(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a prospect and clear unread badge' })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({ status: 200, description: 'Prospect entity' })
  @ApiResponse({ status: 404, description: 'Prospect not found' })
  getProspect(@Param('id') id: string, @CurrentUser() user: PortalActor) {
    return this.conversationsService.getProspectById(id, user);
  }

  @Get(':id/thread')
  @ApiOperation({
    summary: 'Get full chronological event thread for a prospect',
  })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({
    status: 200,
    description: 'Chronological thread with all events',
  })
  getThread(@Param('id') id: string, @CurrentUser() user: PortalActor) {
    return this.conversationsService.getThread(id, user);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send a staff SMS from the portal' })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({ status: 201, description: 'SMS sent, thread event created' })
  sendMessage(
    @Param('id') id: string,
    @Body() dto: SendStaffMessageDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.conversationsService.sendStaffMessage(id, dto, user);
  }

  @Post(':id/notes')
  @ApiOperation({ summary: 'Add an internal note (never shown to customer)' })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({ status: 201, description: 'Internal note added to thread' })
  addNote(
    @Param('id') id: string,
    @Body() dto: AddInternalNoteDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.conversationsService.addInternalNote(id, dto, user);
  }

  @Patch(':id/journey')
  @ApiOperation({
    summary: 'Control automated journey (pause, resume, skip step, stop)',
  })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({ status: 200, description: 'Journey state updated' })
  updateJourney(
    @Param('id') id: string,
    @Body() dto: UpdateJourneyDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.conversationsService.updateJourney(id, dto, user);
  }

  @Patch(':id/outcome')
  @ApiOperation({ summary: 'Set final outcome and close journey' })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({
    status: 200,
    description: 'Outcome set, write-back queued to DealerSocket',
  })
  setOutcome(
    @Param('id') id: string,
    @Body() dto: SetOutcomeDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.conversationsService.setOutcome(id, dto, user);
  }

  @Patch(':id/assign')
  @ApiOperation({ summary: 'Reassign prospect to a salesperson' })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({ status: 200, description: 'Prospect reassigned' })
  assign(
    @Param('id') id: string,
    @Body() dto: AssignProspectDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.conversationsService.assignProspect(id, dto, user);
  }
}
