import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Phase 5 adds the vendor push endpoints (/iclock/...) and punch ingestion. */
@Module({
  controllers: [HealthController],
})
export class GatewayModule {}
