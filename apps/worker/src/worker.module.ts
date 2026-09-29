/** Root module of the worker. Each kind of background work is one provider here. */
import { Module } from '@nestjs/common';
import { RelayService } from './relay/relay.service';

@Module({
  providers: [RelayService],
})
export class WorkerModule {}
