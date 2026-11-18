/**
 * Turns common database errors into clear HTTP answers instead of "500 Internal Server Error":
 *   P2002  a unique value already exists (e.g. an email)  → 409 Conflict
 *   P2025  the record to change doesn't exist               → 404 Not Found
 *   P2003  a record is still used by another one             → 409 Conflict
 *
 * For P2002 the message says what is taken. PostgreSQL leaves the clashing columns out of its
 * message on tables with row security (every organization table), so Prisma only tells us the
 * model (`meta.target` is null); DUPLICATES says what a clash means for each model.
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    const answers: Record<string, { status: number; message: string }> = {
      P2002: { status: HttpStatus.CONFLICT, message: duplicateMessage(error.meta) },
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

/** What a duplicate means, per model (the unique rules in prisma/schema.prisma). */
const DUPLICATES: Record<string, string> = {
  SuperAdmin: 'This email is already used',
  Organization: 'An organization with this slug already exists',
  Branch: 'A branch with this code already exists',
  BranchGroup: 'This group is already switched on at the branch',
  Role: 'A role with this name already exists',
  User: 'This email is already used by another user',
  AcademicYear: 'An academic year with this name already exists',
  Subject: 'A subject with this code already exists',
  ClassSubject: 'This subject is already taught in this class',
  Class: 'This code is already used at this place in the structure',
  Student: 'This admission number is already used',
  DocumentType: 'A document type with this name already exists',
  Enrolment:
    'This roll number is already used in the section, or the student already has a current placement',
  AttendanceRecord: 'This student is already marked for this day',
};

/**
 * "This email is already used" when Prisma names the columns (without the organization or
 * other ids they belong to); else the model's message; else a general one.
 */
export function duplicateMessage(meta: Record<string, unknown> | undefined): string {
  const target = meta?.target;
  // A list of columns; a string is an index name, which means nothing to a user.
  const fields = Array.isArray(target)
    ? target.map(String).filter((f) => !/(^|_)id$|[a-z]Id$/.test(f))
    : [];
  if (fields.length > 0) return `This ${fields.join(', ')} is already used`;
  const model = typeof meta?.modelName === 'string' ? meta.modelName : '';
  return DUPLICATES[model] ?? 'This value is already used';
}
