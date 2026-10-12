import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { IngestLeadDto } from './dto/ingest-lead.dto';

@ApiTags('Lead Intake')
@Controller('api/leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post('ingest')
  @ApiOperation({
    summary: 'Ingest DealerSocket new lead forward',
    description:
      'Receives lead forward from DealerSocket, performs Australian mobile normalisation, checks 14-day duplicates and 3-rooftop suppression list, and triggers Step 1 (<60s).',
  })
  @ApiResponse({ status: 201, description: 'Lead successfully ingested or merged' })
  async ingestLead(@Body() dto: IngestLeadDto) {
    return this.leadsService.ingestLead(dto);
  }
}
