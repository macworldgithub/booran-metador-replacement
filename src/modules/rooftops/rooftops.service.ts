import { Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../database/store.service';
import { RooftopId } from '../../common/enums';
import { RooftopEntity } from '../database/entities';

@Injectable()
export class RooftopsService {
  constructor(private readonly store: StoreService) {}

  getAllRooftops(): RooftopEntity[] {
    return this.store.getRooftops();
  }

  getRooftopById(id: RooftopId): RooftopEntity {
    const rooftop = this.store.getRooftopById(id);
    if (!rooftop) {
      throw new NotFoundException(`Rooftop ${id} not found`);
    }
    return rooftop;
  }
}
