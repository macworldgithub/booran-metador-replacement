import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import {
  QueryProspectsDto,
  SendStaffMessageDto,
  AddInternalNoteDto,
  UpdateJourneyDto,
  SetOutcomeDto,
  AssignProspectDto,
} from './dto';

@ApiTags('Conversation Portal')
@Controller('api/prospects')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List prospects for portal inbox',
    description:
      'Filterable by rooftop, status, owner, or search term. Sorted by latest inbound first.',
  })
  @ApiResponse({ status: 200, description: 'Filtered list of prospects' })
  getProspects(@Query() query: QueryProspectsDto) {
    return this.conversationsService.getProspects(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single prospect details' })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({ status: 200, description: 'Prospect record' })
  getProspect(@Param('id') id: string) {
    return this.conversationsService.getProspectById(id);
  }

  @Get(':id/thread')
  @ApiOperation({
    summary: 'Get unified chronological conversation thread',
    description:
      'Returns all events (Automated SMS, Staff SMS, Customer Inbound, System events, Internal notes) strictly ordered by timestamp.',
  })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({ status: 200, description: 'Chronological timeline' })
  getThread(@Param('id') id: string) {
    return this.conversationsService.getThread(id);
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: 'Staff send SMS from portal',
    description:
      'Sends SMS using rooftop number, appends to the thread in sequence, automatically pauses automated journey, and queues CRM write-back.',
  })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({ status: 201, description: 'Staff SMS sent and appended to thread' })
  sendStaffMessage(
    @Param('id') id: string,
    @Body() dto: SendStaffMessageDto,
  ) {
    return this.conversationsService.sendStaffMessage(id, dto);
  }

  @Post(':id/notes')
  @ApiOperation({
    summary: 'Add internal note to thread',
    description:
      'Adds a private note visible only to dealership staff in the portal. Customer never sees this.',
  })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({ status: 201, description: 'Internal note added' })
  addInternalNote(
    @Param('id') id: string,
    @Body() dto: AddInternalNoteDto,
  ) {
    return this.conversationsService.addInternalNote(id, dto);
  }

  @Patch(':id/journey')
  @ApiOperation({
    summary: 'Control automated journey state',
    description: 'Pause, resume, skip step, or stop automated journey follow-up.',
  })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({ status: 200, description: 'Journey state updated' })
  updateJourney(
    @Param('id') id: string,
    @Body() dto: UpdateJourneyDto,
  ) {
    return this.conversationsService.updateJourney(id, dto);
  }

  @Patch(':id/outcome')
  @ApiOperation({
    summary: 'Set prospect outcome',
    description:
      'Sets outcome (e.g. appointment requested, not interested, already bought), closes journey, and syncs to DealerSocket.',
  })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({ status: 200, description: 'Outcome recorded' })
  setOutcome(@Param('id') id: string, @Body() dto: SetOutcomeDto) {
    return this.conversationsService.setOutcome(id, dto);
  }

  @Patch(':id/assign')
  @ApiOperation({ summary: 'Reassign prospect to another salesperson' })
  @ApiParam({ name: 'id', description: 'Prospect ID' })
  @ApiResponse({ status: 200, description: 'Prospect reassigned' })
  assignProspect(
    @Param('id') id: string,
    @Body() dto: AssignProspectDto,
  ) {
    return this.conversationsService.assignProspect(id, dto);
  }
}
