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
  PlatformSettingsDto,
  ReportQueryDto,
  RooftopSettingsDto,
  TaskStatusDto,
  TemplateDto,
} from './dto';
import { StoreService } from '../database/store.service';

@ApiBearerAuth()
@Controller('api')
export class OperationsController {
  constructor(
    private readonly service: OperationsService,
    private readonly store: StoreService,
  ) {}
  @ApiTags('System Settings')
  @Roles(UserRole.GROUP_ADMIN)
  @Get('settings')
  @ApiOperation({
    summary:
      'Read duplicate window, consent, retention and entity mapping settings',
  })
  settings() {
    return this.store.getSettings();
  }
  @ApiTags('System Settings')
  @Roles(UserRole.GROUP_ADMIN)
  @Patch('settings')
  @ApiOperation({ summary: 'Update persisted platform settings' })
  saveSettings(
    @Body() dto: PlatformSettingsDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.service.saveSettings(dto, user);
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
  @ApiTags('Template Library')
  @Get('templates')
  @ApiOperation({
    summary: 'List templates scoped to the authenticated rooftops',
  })
  templates(@Query() query: ReportQueryDto, @CurrentUser() user: PortalActor) {
    return this.service.templates(user, query.rooftopId);
  }
  @ApiTags('Template Library')
  @Roles(UserRole.GROUP_ADMIN)
  @Post('templates')
  @ApiOperation({ summary: 'Create a staff SMS template' })
  templateCreate(@Body() dto: TemplateDto, @CurrentUser() user: PortalActor) {
    return this.service.saveTemplate(undefined, dto, user);
  }
  @ApiTags('Template Library')
  @Roles(UserRole.GROUP_ADMIN)
  @Patch('templates/:id')
  @ApiOperation({
    summary: 'Update a template without modifying sent messages',
  })
  templateUpdate(
    @Param('id') id: string,
    @Body() dto: TemplateDto,
    @CurrentUser() user: PortalActor,
  ) {
    return this.service.saveTemplate(id, dto, user);
  }
  @ApiTags('Template Library')
  @Roles(UserRole.GROUP_ADMIN)
  @Delete('templates/:id')
  @ApiOperation({ summary: 'Archive a template' })
  templateDelete(@Param('id') id: string, @CurrentUser() user: PortalActor) {
    return this.service.archiveTemplate(id, user);
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
  @ApiTags('System Settings')
  @Roles(UserRole.GROUP_ADMIN)
  @Get('settings/retention-preview')
  @ApiOperation({
    summary: 'Preview expired completed/stopped records; no deletion',
  })
  retention() {
    return this.store.retentionPreview();
  }
}
