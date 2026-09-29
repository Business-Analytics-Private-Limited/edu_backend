import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import { currentContext } from '../context/request-context';
import { ProblemError, type ProblemCode } from '../errors/problem';

const CODE_BY_STATUS: Record<number, ProblemCode> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'permission_denied',
  404: 'not_found',
  409: 'conflict',
  413: 'bad_request',
  422: 'validation_failed',
  429: 'rate_limited',
  503: 'service_unavailable',
};

/**
 * Turns every error into `application/problem+json` (docs/08-api-conventions.md §8.6).
 * Unexpected errors are logged with details and returned as a bare 500.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const requestId = currentContext()?.requestId;

    let status = 500;
    let code: ProblemCode = 'internal_error';
    let title = 'Internal error';
    let detail: string | undefined;
    let errors: ProblemError['errors'];

    if (exception instanceof ProblemError) {
      ({ status, code, title, detail, errors } = exception);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'internal_error' : 'bad_request');
      title = exception.message;
    }

    if (status >= 500) {
      this.logger.error({ err: exception }, 'request failed');
    }

    const body = {
      type: `https://docs.eduplatform.local/errors/${code}`,
      title,
      status,
      code,
      ...(detail ? { detail } : {}),
      ...(requestId ? { requestId } : {}),
      ...(errors ? { errors } : {}),
    };
    response.statusCode = status;
    response.setHeader('content-type', 'application/problem+json');
    response.end(JSON.stringify(body));
  }
}
