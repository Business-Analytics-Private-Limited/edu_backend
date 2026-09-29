import type { LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';
import { currentContext } from '../context/request-context';

/**
 * Structured JSON logs with request, tenant and user ids on every line (ADR-0004).
 * Personal data and credentials are removed before a line is written (DPDP Act).
 */
export function createLogger(service: string, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const context = currentContext();
      if (!context) return {};
      return { requestId: context.requestId, tenantId: context.tenantId, userId: context.userId };
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.secret',
        '*.email',
        '*.phone',
        '*.fullName',
        '*.dateOfBirth',
        '*.aadhaarLast4',
        '*.address',
      ],
      censor: '[redacted]',
    },
  });
}

/** Adapts pino to Nest's logger interface, so framework messages use the same format. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string): void {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, String(message));
  }
}
