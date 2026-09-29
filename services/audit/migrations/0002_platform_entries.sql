-- audit.platform_entries: actions of PLATFORM STAFF (super admin endpoints), which aren't
-- inside one tenant's context (docs/modules/audit.md). Written with recordPlatformAudit().
--
-- Not tenant-owned, so no tenant_id and no Row-Level Security: only edu_platform may read or
-- write it, and edu_app has no access at all. Append-only like audit.entries.

create table audit.platform_entries (
  id               uuid        primary key,
  target_tenant_id uuid,                     -- the organization the action concerned, if any
  occurred_at      timestamptz not null default now(),
  actor_type       text        not null check (actor_type in ('platform_user', 'system')),
  actor_id         uuid,
  module_key       text        not null,
  entity_type      text        not null,
  entity_id        uuid,
  action           text        not null,
  changes          jsonb,
  reason           text,
  request_id       text,
  ip               inet,
  user_agent       text
);

comment on column audit.platform_entries.changes is '@pii';
comment on column audit.platform_entries.ip is '@pii';

create index platform_entries_tenant_idx on audit.platform_entries (target_tenant_id, occurred_at desc);
create index platform_entries_time_idx on audit.platform_entries (occurred_at desc);

grant usage on schema audit to edu_platform;
grant select, insert on audit.platform_entries to edu_platform;
