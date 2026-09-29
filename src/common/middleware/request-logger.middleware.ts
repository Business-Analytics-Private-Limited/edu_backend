/**
 * Logs one line per request when it finishes, e.g.
 *   GET /api/v1/institutions 200 12ms
 * Runs before the guards and controllers (registered in app.module.ts).
 */
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: Request, response: Response, next: NextFunction) {
    const started = Date.now();
    response.on('finish', () => {
      this.logger.log(
        `${request.method} ${request.originalUrl} ${response.statusCode} ${Date.now() - started}ms`,
      );
    });
    next();
  }
}
