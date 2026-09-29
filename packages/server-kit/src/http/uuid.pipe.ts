/**
 * Checks that a path parameter is a UUID before it reaches the database:
 *
 *   @Get(':tenantId')
 *   get(@Param('tenantId', UuidPipe) tenantId: string) { … }
 *
 * A malformed id is answered with 400, not a database error.
 */
import { Injectable, type PipeTransform } from '@nestjs/common';
import { ProblemError } from '../errors/problem';
import { isUuid } from '../ids';

@Injectable()
export class UuidPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isUuid(value))
      throw new ProblemError(400, 'bad_request', 'Bad id', 'The id must be a UUID');
    return value.toLowerCase();
  }
}
