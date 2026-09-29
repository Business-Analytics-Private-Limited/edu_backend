/**
 * `pnpm platform:add-staff -- --email <email> --role <role>`
 *
 * Gives a person access to the super admin console. Do this once for the first platform
 * owner, and for each new staff member (a staff screen comes later).
 *
 * Steps:
 *   1. Create the person in Keycloak, realm "platform" (http://localhost:8080 → admin console →
 *      realm "platform" → Users → Add user; set an email and a password). On first login
 *      Keycloak asks them to set up a one-time-password app (MFA).
 *   2. Run this command with the same email and a role:
 *        platform_owner    everything, including managing staff
 *        platform_admin    organizations, entitlements, plans, flags
 *        platform_support  read-only, plus impersonation (with a reason)
 *
 * It finds the Keycloak account by email (Keycloak admin API, KEYCLOAK_ADMIN_USER /
 * KEYCLOAK_ADMIN_PASSWORD, default admin/admin locally) and links it in platform.platform_users.
 * Running it again for the same person updates their role and reactivates them.
 */
import { parseArgs } from 'node:util';
import { createPool, loadLocalEnv, newId } from '@eduplatform/server-kit';

const ROLES = ['platform_owner', 'platform_admin', 'platform_support'] as const;

async function keycloakAdminToken(keycloakUrl: string): Promise<string> {
  const response = await fetch(`${keycloakUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: process.env.KEYCLOAK_ADMIN_USER ?? 'admin',
      password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin',
    }),
  });
  if (!response.ok)
    throw new Error(`Keycloak admin login failed (${response.status}). Is Keycloak running?`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const { values } = parseArgs({
    options: { email: { type: 'string' }, role: { type: 'string' } },
  });
  const email = values.email?.trim().toLowerCase();
  const role = values.role as (typeof ROLES)[number] | undefined;
  if (!email || !role || !ROLES.includes(role)) {
    throw new Error(
      `Usage: pnpm platform:add-staff -- --email <email> --role <${ROLES.join('|')}>`,
    );
  }

  const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
  const adminToken = await keycloakAdminToken(keycloakUrl);
  const search = await fetch(
    `${keycloakUrl}/admin/realms/platform/users?email=${encodeURIComponent(email)}&exact=true`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );
  if (!search.ok) throw new Error(`Keycloak user search failed (${search.status})`);
  const users = (await search.json()) as {
    id: string;
    firstName?: string;
    lastName?: string;
    username: string;
  }[];
  const account = users[0];
  if (!account) {
    throw new Error(
      `No user with email ${email} in Keycloak realm "platform". Create it there first.`,
    );
  }
  const displayName =
    [account.firstName, account.lastName].filter(Boolean).join(' ') || account.username;

  const pool = createPool(
    process.env.DATABASE_PLATFORM_URL ??
      'postgres://edu_platform:edu_platform@localhost:5432/eduplatform',
    { max: 1 },
  );
  try {
    await pool.query(
      `insert into platform.platform_users (id, keycloak_sub, email, display_name, role)
       values ($1, $2, $3, $4, $5)
       on conflict (keycloak_sub) do update
         set email = excluded.email, display_name = excluded.display_name, role = excluded.role,
             status = 'active', updated_at = now(), version = platform.platform_users.version + 1`,
      [newId(), account.id, email, displayName, role],
    );
  } finally {
    await pool.end();
  }
  console.log(`${displayName} <${email}> is now ${role}. Sign in at the super admin console.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
