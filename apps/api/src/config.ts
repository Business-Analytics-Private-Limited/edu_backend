/**
 * The API host's settings, read from environment variables and checked at startup.
 * A missing or invalid setting stops the app immediately with a clear message, instead of
 * failing later in a confusing way.
 *
 * Local development: sensible defaults apply, and the repository's .env file can override
 * them (see .env.example). Production: every setting without a plain default must be set.
 */
import { z } from 'zod';

const isProduction = process.env.NODE_ENV === 'production';

/** A setting that has a local default, but must be given explicitly in production. */
const requiredInProduction = (localDefault: string) =>
  isProduction ? z.string().min(1) : z.string().min(1).default(localDefault);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Connection for the edu_app role: every tenant query runs under Row-Level Security.
  DATABASE_APP_URL: requiredInProduction('postgres://edu_app:edu_app@localhost:5432/eduplatform'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Swagger UI at /api/docs. On by default everywhere except production.
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .default(isProduction ? 'false' : 'true')
    .transform((v) => v === 'true'),

  // Which services this process runs, comma-separated service keys, e.g. "students,academic".
  // Empty = all services. Useful to work on one service alone (docs/guides/running-one-service.md).
  ENABLED_SERVICES: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean),
    ),

  // Browser origins allowed to call the API directly (CORS), comma-separated, e.g.
  // "https://app.example.com,https://admin.example.com". Empty = no browser origin allowed.
  // Our web apps call the API from their Next.js server, which doesn't need CORS; this is only
  // for code that calls the API from the browser (docs/08-api-conventions.md §8.7).
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type ApiConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return result.data;
}
