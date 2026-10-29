import { Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../database/store.service';
import { RooftopId } from '../../common/enums';
import { RooftopEntity } from '../database/entities';

@Injectable()
export class RooftopsService {
  constructor(private readonly store: StoreService) {}
  private configuration(rooftop: RooftopEntity) {
    const testMode = !!process.env.MOBILEMESSAGE_TEST_RECIPIENT;
    const providerConfigured = process.env.MOBILEMESSAGE_ENABLED === 'true'
      && !!process.env.MOBILEMESSAGE_API_USERNAME && !!process.env.MOBILEMESSAGE_API_PASSWORD;
    return { ...rooftop,
      senderPhone: testMode && rooftop.id === RooftopId.CRANBOURNE_KIA
        ? process.env.SMS_KIA_NUMBER || '' : rooftop.senderPhone,
      smsMode: !providerConfigured ? 'disabled' : testMode
        ? rooftop.id === RooftopId.CRANBOURNE_KIA ? 'test_only' : 'disabled' : 'enabled',
    };
  }

  async getAllRooftops(): Promise<RooftopEntity[]> {
    await this.store.refreshRooftops();
    return this.store.getRooftops().map(rooftop => this.configuration(rooftop));
  }

  async getRooftopById(id: RooftopId): Promise<RooftopEntity> {
    await this.store.refreshRooftops();
    const rooftop = this.store.getRooftopById(id);
    if (!rooftop) {
      throw new NotFoundException(`Rooftop ${id} not found`);
    }
    return this.configuration(rooftop);
  }
}
