import { Global, Module } from '@nestjs/common';
import { FilesService } from './files.service';

/** File storage (ADR-0023), available to every module that keeps uploaded files. */
@Global()
@Module({
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
