/** GET /health: liveness check for the device gateway. */
import { Controller, Get } from '@nestjs/common';
import { Public } from '@eduplatform/server-kit';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  live(): { data: { status: 'ok' } } {
    return { data: { status: 'ok' } };
  }
}
