/**
 * Turns common database errors into clear HTTP answers instead of "500 Internal Server Error":
 *   P2002  a unique value already exists (e.g. an email)  → 409 Conflict
 *   P2025  the record to change doesn't exist               → 404 Not Found
 *   P2003  a record is still used by another one             → 409 Conflict
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    const answers: Record<string, { status: number; message: string }> = {
      P2002: {
        status: HttpStatus.CONFLICT,
        message: `This ${fieldsOf(error) || 'value'} is already used`,
      },
      P2025: { status: HttpStatus.NOT_FOUND, message: 'Not found' },
      P2003: { status: HttpStatus.CONFLICT, message: 'This record is still in use' },
    };
    const answer = answers[error.code] ?? {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Database error',
    };
    response.status(answer.status).json({
      statusCode: answer.status,
      message: answer.message,
      error: HttpStatus[answer.status],
    });
  }
}

/** The column names of a unique-constraint error, e.g. "email". */
function fieldsOf(error: Prisma.PrismaClientKnownRequestError): string {
  const target = error.meta?.target;
  return Array.isArray(target) ? target.join(', ') : typeof target === 'string' ? target : '';
}
