-- Platform-level tables: they belong to no tenant (docs/modules/platform.md).
-- Schema "platform" is created by the migration runner.
--
-- Rights (ADR-0009):
--   edu_platform  reads and writes them (super admin endpoints, catalog sync at startup)
--   edu_app       reads the catalog only (modules, variants, feature flags)

-- Platform staff: people at EduPlatform who use the super admin console.
-- They log in through the Keycloak realm "platform"; keycloak_sub links to that account.
create table platform.platform_users (
  id           uuid        primary key,
  keycloak_sub text        not null unique,
  email        text        not null,
  display_name text        not null,
  role         text        not null check (role in ('platform_owner', 'platform_admin', 'platform_support')),
  status       text        not null default 'active' check (status in ('active', 'disabled')),
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  version      integer     not null default 1
);
comment on column platform.platform_users.email is '@pii';
comment on column platform.platform_users.display_name is '@pii';

-- The module catalog, synced from every module's manifest when the API starts.
create table platform.modules (
  key              text        primary key,
  name             text        not null,
  category         text        not null,
  manifest_version integer     not null,
  depends_on       text[]      not null default '{}',
  applies_to       text[]      not null default '{}',
  is_core          boolean     not null default false,   -- always enabled for every tenant
  status           text        not null check (status in ('available', 'planned', 'retired')),
  manifest         jsonb       not null,                  -- full manifest snapshot
  synced_at        timestamptz not null default now()
);

create table platform.module_variants (
  module_key      text    not null references platform.modules (key),
  key             text    not null,
  name            text    not null,
  is_default      boolean not null default false,
  status          text    not null check (status in ('available', 'planned', 'retired')),
  settings_schema jsonb,
  primary key (module_key, key)
);

-- Plans: default bundles of modules (Starter, Standard, …). Screens arrive in step 2b.
create table platform.plans (
  id          uuid        primary key,
  key         text        not null unique,
  name        text        not null,
  description text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  version     integer     not null default 1
);

create table platform.plan_modules (
  plan_id    uuid  not null references platform.plans (id),
  module_key text  not null references platform.modules (key),
  limits     jsonb not null default '{}',
  primary key (plan_id, module_key)
);

create table platform.plan_module_variants (
  plan_id     uuid not null,
  module_key  text not null,
  variant_key text not null,
  primary key (plan_id, module_key, variant_key),
  foreign key (plan_id, module_key) references platform.plan_modules (plan_id, module_key),
  foreign key (module_key, variant_key) references platform.module_variants (module_key, key)
);

create table platform.feature_flags (
  key             text    primary key,
  description     text    not null,
  default_enabled boolean not null default false
);

grant usage on schema platform to edu_app, edu_platform;
grant select on platform.modules, platform.module_variants, platform.feature_flags to edu_app;
grant select, insert, update, delete on
  platform.platform_users, platform.modules, platform.module_variants, platform.plans,
  platform.plan_modules, platform.plan_module_variants, platform.feature_flags
  to edu_platform;
