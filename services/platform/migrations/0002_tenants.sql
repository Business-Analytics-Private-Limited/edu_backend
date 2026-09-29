-- Tenants and everything a tenant owns in the platform schema (docs/modules/platform.md).
--
-- Every table here has Row-Level Security with two policies:
--   tenant_isolation (edu_app)       a tenant user's request sees only its own tenant's rows
--   platform_staff   (edu_platform)  super admin endpoints see every tenant's rows, but only in
--                                    this schema (ADR-0009)

-- ---------------------------------------------------------------------------------------------
-- The tenant registry: one row per organization. Its id IS the tenant id.
create table platform.tenants (
  id              uuid        primary key,
  slug            text        not null unique
                    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 40),
  legal_name      text        not null,
  display_name    text        not null,
  keycloak_org_id text        unique,       -- set when the first admin is invited (identity service)
  plan_id         uuid        references platform.plans (id),
  status          text        not null default 'onboarding'
                    check (status in ('onboarding', 'active', 'suspended', 'closed')),
  status_reason   text,
  branding        jsonb       not null default '{}',
  primary_contact jsonb,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  version         integer     not null default 1
);
comment on column platform.tenants.primary_contact is '@pii';

alter table platform.tenants enable row level security;
alter table platform.tenants force row level security;
-- A tenant user reads only their own organization; they never change it directly.
create policy tenant_self on platform.tenants
  for select to edu_app using (id = (select app.current_tenant_id()));
create policy platform_staff on platform.tenants
  for all to edu_platform using (true) with check (true);

-- Where each tenant's data lives (silo option, ADR-0002). Everyone is on 'primary' for now.
create table platform.tenant_placements (
  tenant_id     uuid        primary key references platform.tenants (id),
  cluster_key   text        not null default 'primary',
  database_name text        not null,
  moved_at      timestamptz
);

-- ---------------------------------------------------------------------------------------------
create table platform.institutions (
  id                     uuid        primary key,
  tenant_id              uuid        not null references platform.tenants (id),
  code                   text        not null,
  name                   text        not null,
  short_name             text,
  type                   text        not null
                           check (type in ('junior_college', 'degree_college', 'engineering_college', 'school')),
  structure_template_key text        not null,
  timezone               text        not null default 'Asia/Kolkata',
  locale                 text        not null default 'en-IN',
  currency               char(3)     not null default 'INR',
  address                jsonb,
  external_codes         jsonb       not null default '{}',
  logo_file_id           uuid,
  status                 text        not null default 'active' check (status in ('active', 'inactive')),
  created_at             timestamptz not null default now(),
  created_by             uuid,
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  version                integer     not null default 1,
  deleted_at             timestamptz,
  deleted_by             uuid,
  unique (tenant_id, id)
);
create unique index institutions_code_uq on platform.institutions (tenant_id, code) where deleted_at is null;

create table platform.campuses (
  id             uuid        primary key,
  tenant_id      uuid        not null,
  institution_id uuid        not null,
  code           text        not null,
  name           text        not null,
  address        jsonb,
  timezone       text,       -- null = the institution's
  status         text        not null default 'active' check (status in ('active', 'inactive')),
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  version        integer     not null default 1,
  deleted_at     timestamptz,
  deleted_by     uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, institution_id) references platform.institutions (tenant_id, id)
);
create unique index campuses_code_uq on platform.campuses (tenant_id, institution_id, code) where deleted_at is null;
create index campuses_institution_idx on platform.campuses (tenant_id, institution_id);

-- Layer 1: which modules the super admin granted to each tenant.
create table platform.tenant_entitlements (
  id               uuid        primary key,
  tenant_id        uuid        not null references platform.tenants (id),
  module_key       text        not null references platform.modules (key),
  enabled          boolean     not null,
  allowed_variants text[]      not null default '{}',
  limits           jsonb       not null default '{}',
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz,
  source           text        not null check (source in ('plan', 'override', 'core')),
  read_only_until  timestamptz,  -- set when disabled: read-only grace period
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  version          integer     not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, module_key)
);

-- Layer 2: how each tenant configured its modules, per organization, institution or campus.
create table platform.module_settings (
  id               uuid        primary key,
  tenant_id        uuid        not null references platform.tenants (id),
  module_key       text        not null references platform.modules (key),
  scope_type       text        not null check (scope_type in ('organization', 'institution', 'campus')),
  scope_id         uuid,
  enabled_variants text[]      not null default '{}',
  settings         jsonb       not null default '{}',
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  version          integer     not null default 1,
  unique (tenant_id, id),
  unique nulls not distinct (tenant_id, module_key, scope_type, scope_id),
  check ((scope_type = 'organization') = (scope_id is null))
);

create table platform.tenant_feature_flags (
  tenant_id uuid    not null references platform.tenants (id),
  flag_key  text    not null references platform.feature_flags (key),
  enabled   boolean not null,
  primary key (tenant_id, flag_key)
);

create table platform.impersonation_sessions (
  id               uuid        primary key,
  tenant_id        uuid        not null references platform.tenants (id),
  platform_user_id uuid        not null references platform.platform_users (id),
  target_user_id   uuid        not null,   -- identity.users (another schema: no foreign key)
  reason           text        not null,
  started_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  ended_at         timestamptz,
  unique (tenant_id, id),
  check (expires_at <= started_at + interval '60 minutes')
);

-- Events of the platform service (ADR-0006, docs/07-database-design.md §7.5).
create table platform.outbox (
  id           uuid        primary key,
  tenant_id    uuid        not null,
  type         text        not null,
  subject      text        not null,
  data_schema  text        not null,
  data         jsonb       not null,
  occurred_at  timestamptz not null default now(),
  published_at timestamptz,
  attempts     integer     not null default 0,
  last_error   text
);
create index outbox_tenant_idx on platform.outbox (tenant_id, id);
create index outbox_unsent_idx on platform.outbox (id) where published_at is null;

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security: the same two policies on every tenant-owned table.
do $$
declare
  t text;
begin
  foreach t in array array[
    'tenant_placements', 'institutions', 'campuses', 'tenant_entitlements', 'module_settings',
    'tenant_feature_flags', 'impersonation_sessions', 'outbox'
  ] loop
    execute format('alter table platform.%I enable row level security', t);
    execute format('alter table platform.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on platform.%I for all to edu_app
         using (tenant_id = (select app.current_tenant_id()))
         with check (tenant_id = (select app.current_tenant_id()))', t);
    execute format(
      'create policy platform_staff on platform.%I for all to edu_platform
         using (true) with check (true)', t);
  end loop;
end
$$;

-- The outbox relay reads and marks events of every tenant, nothing else (ADR-0009).
create policy relay_read on platform.outbox for select to edu_relay using (true);
create policy relay_mark on platform.outbox for update to edu_relay using (true) with check (true);

-- ---------------------------------------------------------------------------------------------
-- Rights.
grant select on platform.tenants, platform.tenant_placements, platform.tenant_entitlements,
  platform.tenant_feature_flags, platform.impersonation_sessions to edu_app;
grant select, insert, update, delete on platform.institutions, platform.campuses,
  platform.module_settings to edu_app;
grant insert on platform.outbox to edu_app;

grant select, insert, update, delete on platform.tenants, platform.tenant_placements,
  platform.institutions, platform.campuses, platform.tenant_entitlements, platform.module_settings,
  platform.tenant_feature_flags, platform.impersonation_sessions to edu_platform;
grant insert on platform.outbox to edu_platform;

grant usage on schema platform to edu_relay;
grant select, update (published_at, attempts, last_error) on platform.outbox to edu_relay;
