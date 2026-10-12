import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RooftopsService } from './rooftops.service';
import { RooftopId } from '../../common/enums';

@ApiTags('Rooftops')
@Controller('api/rooftops')
export class RooftopsController {
  constructor(private readonly rooftopsService: RooftopsService) {}

  @Get()
  @ApiOperation({ summary: 'List all in-scope dealerships (Kia, MG, Geely)' })
  @ApiResponse({ status: 200, description: 'Returns the 3 Cranbourne dealerships' })
  getAll() {
    return this.rooftopsService.getAllRooftops();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific dealership rooftop' })
  @ApiParam({ name: 'id', enum: RooftopId })
  @ApiResponse({ status: 200, description: 'Dealership details' })
  @ApiResponse({ status: 404, description: 'Rooftop not found' })
  getById(@Param('id') id: RooftopId) {
    return this.rooftopsService.getRooftopById(id);
  }
}
