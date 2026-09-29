-- Foundation objects shared by every module (docs/07-database-design.md §7.2, §7.4).
-- Schema "app" holds functions only, never tables. It is created by the migration runner.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Tenant context for Row-Level Security. Raises instead of matching nothing when the setting
-- is missing, and also when it is '' (what a pooled connection has after a previous
-- transaction used set_config(..., true)).
create function app.current_tenant_id() returns uuid
language plpgsql stable
as $$
declare
  v text := current_setting('app.tenant_id', true);
begin
  if v is null or v = '' then
    raise exception 'app.tenant_id is not set' using errcode = '42501';
  end if;
  return v::uuid;
end
$$;

grant usage on schema app to edu_app, edu_platform, edu_relay, edu_gateway;
grant usage on schema extensions to edu_app, edu_platform;
grant execute on function app.current_tenant_id() to edu_app, edu_platform, edu_relay, edu_gateway;
