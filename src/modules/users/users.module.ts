import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/** An organization's staff users. */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
