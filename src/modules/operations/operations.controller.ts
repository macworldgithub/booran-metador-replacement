import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RooftopId, UserRole } from '../../common/enums';
import type { PortalActor } from '../conversations/conversations.service';
import { OperationsService } from './operations.service';
import {
  ConsentDto,
  JourneyDraftDto,
    ReportQueryDto,
  RooftopSettingsDto,
  TaskStatusDto,
  } from './dto';
import { StoreService } from '../database/store.service';

@ApiBearerAuth()
@Controller('api')
export class OperationsController {
  constructor(
    private readonly service: OperationsService,
    private readonly store: StoreService,
  ) {}
  @ApiTags('DealerSocket Integration')
  @Roles(UserRole.GROUP_ADMIN)
  @Get('integrations/dealersocket/heartbeat/status')
  @ApiOperation({ summary: 'Read the latest live scraper heartbeat' })
  async dealerSocketStatus() {
    const record = await this.store.recordGet(
      'connector_status',
      'dealersocket',
    );
    if (!record?.data)
      return {
        status: 'never_connected',
        readOnly: true,
        recordsSeen: 0,
        recordsChanged: 0,
        recordsSent: 0,
        errors: 0,
      };
    const completed = new Date(record.data.pollCompletedAt).getTime();
    const interval = Number(record.data.intervalSeconds);
    const stale =
      Number.isFinite(completed) &&
      Number.isFinite(interval) &&
      Date.now() - completed > interval * 2500;
    return { ...record.data, status: stale ? 'failed' : record.data.status };
  }
  @ApiTags('Rooftops')
  @Roles(UserRole.GROUP_ADMIN)
  @Patch('rooftops/:id')
  @ApiOperation({
    summary: 'Update rooftop identity, contact, quiet hours and closed days',
  })
  rooftop(
    @Param('id') id: RooftopId,
    @Body() dto: RooftopSettingsDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.service.saveRooftop(id, dto, user);
  }
  @ApiTags('Journey Configuration')
  @Roles(UserRole.GROUP_ADMIN)
  @Get('journeys')
  @ApiOperation({
    summary: 'List journey drafts and immutable published versions',
  })
  journeys(@Query() query: ReportQueryDto, @CurrentUser() user: PortalActor) {
    return this.service.journeys(user, query.rooftopId);
  }
  @ApiTags('Journey Configuration')
  @Roles(UserRole.GROUP_ADMIN)
  @Post('journeys')
  @ApiOperation({ summary: 'Create a journey draft per rooftop and lead type' })
  create(@Body() dto: JourneyDraftDto, @CurrentUser() user: PortalActor) {
    return this.service.createJourney(dto, user);
  }
  @ApiTags('Journey Configuration')
  @Roles(UserRole.GROUP_ADMIN)
  @Patch('journeys/:id')
  @ApiOperation({ summary: 'Edit an unpublished journey draft' })
  edit(
    @Param('id') id: string,
    @Body() dto: JourneyDraftDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.service.updateJourney(id, dto, user);
  }
  @ApiTags('Journey Configuration')
  @Roles(UserRole.GROUP_ADMIN)
  @Post('journeys/:id/publish')
  @ApiOperation({
    summary:
      'Publish a version for new journeys; existing messages are unchanged',
  })
  publish(@Param('id') id: string, @CurrentUser() user: PortalActor) {
    return this.service.publish(id, user);
  }
  @ApiTags('Journey Configuration')
  @Roles(UserRole.GROUP_ADMIN)
  @Post('journeys/:id/activate')
  @ApiOperation({ summary: 'Enable the current version for new leads' })
  activate(@Param('id') id: string, @CurrentUser() user: PortalActor) {
    return this.service.toggleJourney(id, true, user);
  }
  @ApiTags('Journey Configuration')
  @Roles(UserRole.GROUP_ADMIN)
  @Post('journeys/:id/pause')
  @ApiOperation({
    summary: 'Pause enrolment of new leads into the current version',
  })
  pause(@Param('id') id: string, @CurrentUser() user: PortalActor) {
    return this.service.toggleJourney(id, false, user);
  }
  @ApiTags('Conversation Portal')
  @Patch('prospects/:id/consent')
  @ApiOperation({
    summary:
      'Record enquiry/marketing consent evidence without removing suppression',
  })
  consent(
    @Param('id') id: string,
    @Body() dto: ConsentDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.service.consent(id, dto, user);
  }
  @ApiTags('Staff Tasks & Notifications')
  @Get('tasks')
  @ApiOperation({ summary: 'List scoped close-loop handoff tasks' })
  tasks(@CurrentUser() user: PortalActor) {
    return this.service.workQueue('task', user);
  }
  @ApiTags('Staff Tasks & Notifications')
  @Patch('tasks/:id')
  @ApiOperation({ summary: 'Complete or reopen an authorised handoff task' })
  taskUpdate(
    @Param('id') id: string,
    @Body() dto: TaskStatusDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.service.updateWork('task', id, dto.status, user);
  }
  @ApiTags('Staff Tasks & Notifications')
  @Get('notifications')
  @ApiOperation({ summary: 'List duplicate-lead and handoff notifications' })
  notifications(@CurrentUser() user: PortalActor) {
    return this.service.workQueue('notification', user);
  }
  @ApiTags('Staff Tasks & Notifications')
  @Patch('notifications/:id/read')
  @ApiOperation({ summary: 'Mark an authorised notification read' })
  markRead(@Param('id') id: string, @CurrentUser() user: PortalActor) {
    return this.service.updateWork('notification', id, true, user);
  }
  @ApiTags('Reports')
  @Roles(UserRole.GROUP_ADMIN, UserRole.SALES_MANAGER)
  @Get('reports/journey-performance')
  @ApiOperation({
    summary: 'Rooftop-scoped leads, replies, timing, failures and outcomes',
  })
  performance(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.service.report(query, user);
  }
  @ApiTags('Compliance & Suppression')
  @Roles(UserRole.GROUP_ADMIN)
  @Get('compliance/send-audit')
  @ApiOperation({
    summary:
      'Export staff/automated sends with actor, content, time, delivery and journey version',
  })
  sendAudit(@Query() query: ReportQueryDto, @CurrentUser() user: PortalActor) {
    return this.service.report(query, user, true);
  }
  @ApiTags('Compliance & Suppression')
  @Roles(UserRole.GROUP_ADMIN)
  @Get('compliance/activity-audit')
  @ApiOperation({
    summary: 'Export administrative and consent/suppression change history',
  })
  audit() {
    return this.store.recordList('audit');
  }
}
