/**
 * Makes PrismaService available everywhere (@Global), so any service can ask for it:
 *   constructor(private readonly prisma: PrismaService) {}
 */
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
