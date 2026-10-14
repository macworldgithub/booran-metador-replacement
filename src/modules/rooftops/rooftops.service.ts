import { Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../database/store.service';
import { RooftopId } from '../../common/enums';
import { RooftopEntity } from '../database/entities';

@Injectable()
export class RooftopsService {
  constructor(private readonly store: StoreService) {}

  async getAllRooftops(): Promise<RooftopEntity[]> {
    await this.store.refreshRooftops();
    return this.store.getRooftops();
  }

  async getRooftopById(id: RooftopId): Promise<RooftopEntity> {
    await this.store.refreshRooftops();
    const rooftop = this.store.getRooftopById(id);
    if (!rooftop) {
      throw new NotFoundException(`Rooftop ${id} not found`);
    }
    return rooftop;
  }
}
