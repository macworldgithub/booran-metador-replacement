import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '../../common/enums';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { PortalActor } from '../conversations/conversations.service';
import { DealerSocketService } from './dealersocket.service';

@ApiTags('DealerSocket Session')
@ApiBearerAuth()
@Roles(UserRole.GROUP_ADMIN)
@Controller('api/integrations/dealersocket')
export class DealerSocketController {
  constructor(private readonly service: DealerSocketService) {}

  @Get('status')
  @ApiOperation({ summary: 'Read cached DealerSocket session and rooftop verification status' })
  status() { return this.service.request('status'); }

  @Post('check')
  @HttpCode(202)
  @ApiOperation({ summary: 'Queue a read-only DealerSocket connection check on the automation PC' })
  check(@CurrentUser() actor: PortalActor) { return this.service.request('check', actor); }

  @Post('login/start')
  @HttpCode(202)
  @ApiOperation({ summary: 'Open the dedicated login browser on the automation PC; complete MFA there' })
  login(@CurrentUser() actor: PortalActor) { return this.service.request('login/start', actor); }

  @Get('leads/status')
  @Roles(UserRole.GROUP_ADMIN, UserRole.SALES_MANAGER, UserRole.BDC, UserRole.SALESPERSON, UserRole.READ_ONLY)
  @ApiOperation({ summary: 'Read a rooftop/owner-scoped live DealerSocket snapshot; no lead enrollment or messaging' })
  leads(@CurrentUser() actor: PortalActor) { return this.service.request('leads/status', actor); }

  @Post('leads/read')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request a fresh read-only CRM snapshot; Group Admin only' })
  readLeads(@CurrentUser() actor: PortalActor) { return this.service.request('leads/read', actor); }
}
