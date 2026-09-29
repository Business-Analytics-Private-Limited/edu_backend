/**
 * The worker's settings, read from environment variables and checked at startup.
 * Local defaults apply outside production (see .env.example).
 */
import { z } from 'zod';

const isProduction = process.env.NODE_ENV === 'production';
const requiredInProduction = (localDefault: string) =>
  isProduction ? z.string().min(1) : z.string().min(1).default(localDefault);

const schema = z.object({
  DATABASE_RELAY_URL: requiredInProduction(
    'postgres://edu_relay:edu_relay@localhost:5432/eduplatform',
  ),
  REDIS_URL: requiredInProduction('redis://localhost:6379'),
  RELAY_INTERVAL_MS: z.coerce.number().int().min(100).default(500),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return result.data;
}

/** BullMQ takes ioredis options rather than a URL. */
export function redisConnection(url: string): {
  host: string;
  port: number;
  password?: string;
  username?: string;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
  };
}
