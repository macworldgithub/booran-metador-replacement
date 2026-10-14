import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiSecurity,
} from '@nestjs/swagger';
import { StoreService } from '../../database/store.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IngestLeadDto } from '../dto/ingest-lead.dto';
import { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { AdfParserService } from './adf-parser.service';
import { LeadsService } from '../leads.service';

@ApiTags('Lead Intake')
@Controller('api/leads')
export class AdfIntakeController {
  private readonly logger = new Logger(AdfIntakeController.name);

  constructor(
    private readonly adfParserService: AdfParserService,
    private readonly leadsService: LeadsService,
    private readonly store: StoreService,
  ) {}

  @Public()
  @ApiSecurity('leadForward')
  @Post('ingest-adf')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Direct DealerSocket ADF/XML Lead Intake',
    description:
      'Receives DealerSocket lead-forward XML payload, parses ADF format, creates lead thread, normalizes mobile, and kicks off Journey Step 1.',
  })
  @ApiConsumes('application/xml', 'text/xml', 'application/json', 'text/plain')
  @ApiResponse({
    status: 200,
    description: 'Lead accepted and ingested successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Malformed XML or missing mandatory fields',
  })
  async ingestAdf(
    @Body() body: any,
    @Headers('content-type') contentType: string,
    @Req() req: Request,
  ) {
    let xmlContent = '';

    if (typeof body === 'string') {
      xmlContent = body;
    } else if (typeof body === 'object' && body?.xml) {
      xmlContent = body.xml;
    } else if (Buffer.isBuffer(body)) {
      xmlContent = body.toString('utf-8');
    } else if (typeof body === 'object') {
      // In case body-parser raw/text wasn't used, try extracting rawBody or fallback
      const raw = (req as any).rawBody;
      if (raw) {
        xmlContent = raw.toString('utf-8');
      } else {
        xmlContent = JSON.stringify(body);
      }
    }

    if (!xmlContent || !xmlContent.trim()) {
      throw new BadRequestException('Empty ADF XML payload received');
    }

    this.logger.log(`Received ADF/XML payload (${xmlContent.length} bytes)`);

    const settings = await this.store.getSettings();
    const dto = plainToInstance(
      IngestLeadDto,
      this.adfParserService.parseAdf(xmlContent, settings.entityMap),
    );
    const errors = await validate(dto, { whitelist: true });
    if (errors.length)
      throw new BadRequestException(
        'ADF payload is missing or contains invalid required lead fields',
      );

    // Ingest normalized lead into the workflow & journey engine
    const result = await this.leadsService.ingestLead(dto);

    return {
      status: 'success',
      dealerSocketOpportunityId: dto.dealerSocketOpportunityId,
      prospectId: result.prospect?.id || null,
      rooftopId: dto.rooftopId,
      journeyStatus: result.prospect?.journey?.status || 'stopped',
    };
  }
}
