-- =============================================================================
-- Database roles for LOCAL DEVELOPMENT and TESTS (run by `pnpm db:setup`).
-- Safe to run many times. Passwords equal the role names: fine on a developer
-- machine, NEVER anywhere else (production roles come from infrastructure setup).
--
-- Two roles, each with one job:
--   edu_owner  owns the tables and runs migrations. Row security doesn't apply to
--              it. May create databases (Prisma needs that for `db:migration`).
--   edu_app    what the running app uses. Can read and write data, can't change
--              tables, and row security keeps organizations apart for it.
-- =============================================================================

do $$
begin
  if not exists (select from pg_roles where rolname = 'edu_owner') then
    create role edu_owner login password 'edu_owner';
  end if;
  if not exists (select from pg_roles where rolname = 'edu_app') then
    create role edu_app login password 'edu_app';
  end if;
end
$$;

alter role edu_owner bypassrls createdb;
alter role edu_app nobypassrls;
