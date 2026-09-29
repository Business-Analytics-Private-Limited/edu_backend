-- =============================================================================
-- Database roles for LOCAL DEVELOPMENT and TESTS.
--
-- Who uses this file:
--   * `pnpm db:setup`             prepares your locally installed PostgreSQL
--   * the integration tests       prepare their temporary test database
--   * infra/docker (on hold)      would run it when the Postgres container first starts
--
-- Safe to run many times: a role that already exists is left alone.
--
-- Passwords equal the role names. That is fine on a developer machine that only
-- listens on localhost, and NEVER acceptable anywhere else. Production roles and
-- passwords are created by infrastructure provisioning, not by this file.
--
-- Why five roles? Each process gets only the rights it needs (ADR-0009):
--   edu_owner     runs migrations and owns every table. The ONLY role that may
--                 bypass Row-Level Security, and it is never used by a running service.
--   edu_app       the API and worker jobs. Always limited to one tenant by RLS.
--   edu_platform  super admin endpoints. May see all tenants, but only in schema "platform".
--   edu_relay     the outbox relay. May read and mark outbox rows, nothing else.
--   edu_gateway   the biometric device gateway. May only record raw punches.
-- =============================================================================

do $$
begin
  if not exists (select from pg_roles where rolname = 'edu_owner') then
    create role edu_owner login password 'edu_owner' bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'edu_app') then
    create role edu_app login password 'edu_app';
  end if;
  if not exists (select from pg_roles where rolname = 'edu_platform') then
    create role edu_platform login password 'edu_platform';
  end if;
  if not exists (select from pg_roles where rolname = 'edu_relay') then
    create role edu_relay login password 'edu_relay';
  end if;
  if not exists (select from pg_roles where rolname = 'edu_gateway') then
    create role edu_gateway login password 'edu_gateway';
  end if;
end
$$;
