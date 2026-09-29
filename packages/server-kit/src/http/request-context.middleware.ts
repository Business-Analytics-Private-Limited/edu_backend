import type { IncomingMessage, ServerResponse } from 'node:http';
import { runWithContext } from '../context/request-context';
import { newId } from '../ids';

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * First middleware of every HTTP app: gives the request an id and opens its context.
 * Authentication fills in the tenant and user later (Phase 2).
 */
export function requestContextMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
): void {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : newId();
  res.setHeader('x-request-id', requestId);
  runWithContext(
    {
      requestId,
      actorType: 'user',
      ip: req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    },
    () => next(),
  );
}
