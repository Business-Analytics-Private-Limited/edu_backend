/**
 * Operational endpoints of the host (health checks). Not a business service: it has no
 * database schema and no manifest, so it lives in the host rather than in backend/services.
 */
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class SystemModule {}
