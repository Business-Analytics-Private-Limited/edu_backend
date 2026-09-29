# Module: platform

| | |
|---|---|
| Schema | `platform` |
| Phase | 2 (tenants, entitlements, settings), with the connection resolver in Phase 1 |
| Depends on | none (foundation) |
| Code | `services/platform/` |

## Purpose

The control plane. It knows which organizations (tenants) exist, which institutions and campuses they have, which modules and variants each tenant may use, and how each module is configured at each level.

## Responsibilities

- Tenant registry and lifecycle (onboarding, active, suspended, closed).
- Institutions and campuses.
- Module catalog, synced from module manifests at deploy.
- Plans, entitlements (layer 1), module settings (layer 2), feature flags, limits.
- Tenant placement (which database cluster holds a tenant's data).
- Impersonation sessions for platform support.
- Answers checks 1 and 2 of every request (entitlement and configuration), cached in Redis.

Not this module: user accounts (`identity`), roles and permissions (`access`), academic structure (`academic`).

## Manifest

- Always enabled for every tenant; can't be disabled.
- No variants.
- Settings: none of its own. It stores every other module's settings.

## Permissions

Tenant side (from doc 4):

| Permission | Allows |
|---|---|
| `platform.institution.view` | See the organization, its institutions and campuses, and its own entitlements |
| `platform.institution.manage` | Create, edit and deactivate institutions |
| `platform.campus.manage` | Create, edit and deactivate campuses |
| `platform.settings.manage` | Change module settings and variant choices at organization, institution or campus level |

Platform staff (super admin console only; granted by platform role, never to tenant users):

| Permission | platform_owner | platform_admin | platform_support |
|---|:-:|:-:|:-:|
| `admin.tenant.view` | ✓ | ✓ | ✓ |
| `admin.tenant.manage` | ✓ | ✓ | |
| `admin.entitlement.manage` | ✓ | ✓ | |
| `admin.plan.manage` | ✓ | ✓ | |
| `admin.flag.manage` | ✓ | ✓ | |
| `admin.impersonation.start` | ✓ | | ✓ |
| `admin.staff.manage` | ✓ | | |

## Data model

### Platform-level tables (no tenant, no RLS; `edu_app` read-only)

```
platform.platform_users                 platform staff (Keycloak realm 'platform')           [std]
  id              uuid pk
  keycloak_sub    text unique not null
  email           text not null  [P]
  display_name    text not null  [P]
  role            text check (platform_owner | platform_admin | platform_support)
  status          text check (active | disabled)

platform.modules                        synced from manifests at deploy
  key             text pk               'students'
  name            text not null
  category        text not null
  manifest_version integer not null
  depends_on      text[] not null
  applies_to      text[] not null       institution types
  status          text check (available | planned | retired)
  manifest        jsonb not null        full manifest snapshot
  synced_at       timestamptz not null

platform.module_variants
  module_key      text references platform.modules
  key             text                  'manual', 'biometric'
  name            text not null
  is_default      boolean not null
  status          text check (available | planned | retired)
  settings_schema jsonb
  primary key (module_key, key)

platform.plans                                                                               [std]
  id uuid pk, key text unique, name text not null, description text, is_active boolean not null

platform.plan_modules
  plan_id uuid references platform.plans, module_key text references platform.modules,
  limits jsonb not null default '{}',
  primary key (plan_id, module_key)

platform.plan_module_variants
  plan_id uuid, module_key text, variant_key text,
  primary key (plan_id, module_key, variant_key),
  foreign key (plan_id, module_key) references platform.plan_modules,
  foreign key (module_key, variant_key) references platform.module_variants

platform.feature_flags
  key text pk, description text not null, default_enabled boolean not null default false

platform.tenant_placements              silo option: where each tenant's data lives
  tenant_id       uuid pk
  cluster_key     text not null default 'primary'
  database_name   text not null
  moved_at        timestamptz
```

### Tenant registry

```
platform.tenants                        one row per organization                            [std]
  id              uuid pk               this is the tenant id
  slug            text unique not null  URL and Keycloak organization alias, e.g. 'sri-vidya'
  legal_name      text not null
  display_name    text not null
  keycloak_org_id text unique
  plan_id         uuid references platform.plans
  status          text check (onboarding | active | suspended | closed)
  status_reason   text
  branding        jsonb not null default '{}'    { logoFileId, primaryColor }
  primary_contact jsonb  [P]            { name, phone, email }
```

RLS: `edu_app` sees only `id = app.current_tenant_id()`; `edu_platform` sees all.

### Tenant-owned tables

```
platform.institutions                                                                        [std][sd]
  id, tenant_id
  code            text not null         unique (tenant_id, code) where deleted_at is null
  name            text not null
  short_name      text
  type            text check (junior_college | degree_college | engineering_college | school)
  structure_template_key text not null  'junior_college_v1'
  timezone        text not null default 'Asia/Kolkata'
  locale          text not null default 'en-IN'
  currency        char(3) not null default 'INR'
  address         jsonb
  external_codes  jsonb not null default '{}'    { bie, aishe, udise, university }
  logo_file_id    uuid
  status          text check (active | inactive)

platform.campuses                                                                            [std][sd]
  id, tenant_id
  institution_id  uuid not null         fk (tenant_id, institution_id) → institutions
  code            text not null         unique (tenant_id, institution_id, code) where deleted_at is null
  name            text not null
  address         jsonb
  timezone        text                  null = the institution's
  status          text check (active | inactive)

platform.tenant_entitlements            layer 1                                              [std]
  id, tenant_id
  module_key      text not null references platform.modules
  enabled         boolean not null
  allowed_variants text[] not null default '{}'
  limits          jsonb not null default '{}'    { "students.max": 2000, "devices.max": 5 }
  starts_at       timestamptz not null
  ends_at         timestamptz
  source          text check (plan | override)
  read_only_until timestamptz           set when disabled (read-only grace period)
  unique (tenant_id, module_key)

platform.module_settings                layer 2                                              [std]
  id, tenant_id
  module_key      text not null
  scope_type      text check (organization | institution | campus)
  scope_id        uuid                  null for organization
  enabled_variants text[] not null default '{}'
  settings        jsonb not null default '{}'
  unique nulls not distinct (tenant_id, module_key, scope_type, scope_id)
  check ((scope_type = 'organization') = (scope_id is null))

platform.tenant_feature_flags
  tenant_id, flag_key text references platform.feature_flags, enabled boolean not null,
  primary key (tenant_id, flag_key)

platform.impersonation_sessions
  id, tenant_id
  platform_user_id uuid not null        references platform.platform_users
  target_user_id  uuid not null         → identity.users
  reason          text not null
  started_at      timestamptz not null
  expires_at      timestamptz not null  at most 60 minutes after start
  ended_at        timestamptz
```

## API

### Tenant side

| Method | Path | operationId | Permission | Description |
|---|---|---|---|---|
| GET | `/platform/organization` | `platform.organization.get` | authenticated | Own organization: name, branding, status |
| GET | `/platform/entitlements` | `platform.entitlement.list` | `platform.institution.view` | Modules and variants the organization may use |
| GET | `/platform/institutions` | `platform.institution.list` | `platform.institution.view` | Institutions the user can see |
| POST | `/platform/institutions` | `platform.institution.create` | `platform.institution.manage` | Create an institution (also creates its first campus) |
| GET | `/platform/institutions/{institutionId}` | `platform.institution.get` | `platform.institution.view` | One institution |
| PATCH | `/platform/institutions/{institutionId}` | `platform.institution.update` | `platform.institution.manage` | Edit details, time zone, codes |
| DELETE | `/platform/institutions/{institutionId}` | `platform.institution.delete` | `platform.institution.manage` | Soft delete; blocked while it has active students |
| GET | `/platform/institutions/{institutionId}/campuses` | `platform.campus.list` | `platform.institution.view` | Campuses of an institution |
| POST | `/platform/institutions/{institutionId}/campuses` | `platform.campus.create` | `platform.campus.manage` | Add a campus |
| PATCH | `/platform/campuses/{campusId}` | `platform.campus.update` | `platform.campus.manage` | Edit a campus |
| DELETE | `/platform/campuses/{campusId}` | `platform.campus.delete` | `platform.campus.manage` | Soft delete; blocked while in use |
| GET | `/platform/module-settings` | `platform.module_setting.list` | `platform.institution.view` | Settings for `?moduleKey&scopeType&scopeId`, with the resolved (inherited) values |
| PUT | `/platform/module-settings` | `platform.module_setting.put` | `platform.settings.manage` | Set variants and settings at one scope; validated against the manifest and the entitlement |

### Super admin (`/admin/...`, platform realm only)

| Method | Path | operationId | Permission | Description |
|---|---|---|---|---|
| GET | `/admin/tenants` | `admin.tenant.list` | `admin.tenant.view` | Search tenants |
| POST | `/admin/tenants` | `admin.tenant.create` | `admin.tenant.manage` | Start onboarding: details and plan |
| GET | `/admin/tenants/{tenantId}` | `admin.tenant.get` | `admin.tenant.view` | Tenant details, institutions, entitlements, usage |
| PATCH | `/admin/tenants/{tenantId}` | `admin.tenant.update` | `admin.tenant.manage` | Edit details, plan |
| POST | `/admin/tenants/{tenantId}/institutions` | `admin.tenant.add_institution` | `admin.tenant.manage` | Add institutions during onboarding |
| POST | `/admin/tenants/{tenantId}/first-admin` | `admin.tenant.invite_admin` | `admin.tenant.manage` | Create the organization admin and send the invitation |
| POST | `/admin/tenants/{tenantId}/activate` | `admin.tenant.activate` | `admin.tenant.manage` | Finish onboarding |
| POST | `/admin/tenants/{tenantId}/suspend` | `admin.tenant.suspend` | `admin.tenant.manage` | Suspend with a reason; users can't log in |
| POST | `/admin/tenants/{tenantId}/reactivate` | `admin.tenant.reactivate` | `admin.tenant.manage` | Reactivate |
| GET | `/admin/tenants/{tenantId}/entitlements` | `admin.entitlement.list` | `admin.tenant.view` | Entitlements with dependency status |
| PUT | `/admin/tenants/{tenantId}/entitlements/{moduleKey}` | `admin.entitlement.put` | `admin.entitlement.manage` | Enable, set variants, limits, dates |
| DELETE | `/admin/tenants/{tenantId}/entitlements/{moduleKey}` | `admin.entitlement.disable` | `admin.entitlement.manage` | Disable (read-only grace period; no data deleted) |
| GET | `/admin/tenants/{tenantId}/usage` | `admin.tenant.usage` | `admin.tenant.view` | Students, users, storage, devices |
| GET | `/admin/modules` | `admin.module.list` | `admin.tenant.view` | Module catalog with variants |
| GET, POST | `/admin/plans` | `admin.plan.list`, `admin.plan.create` | `admin.tenant.view`, `admin.plan.manage` | Plans |
| GET, PATCH | `/admin/plans/{planId}` | `admin.plan.get`, `admin.plan.update` | `admin.tenant.view`, `admin.plan.manage` | One plan and its modules |
| GET | `/admin/feature-flags` | `admin.flag.list` | `admin.tenant.view` | Flags |
| PUT | `/admin/tenants/{tenantId}/feature-flags/{flagKey}` | `admin.flag.put` | `admin.flag.manage` | Per-tenant flag |
| POST | `/admin/impersonations` | `admin.impersonation.start` | `admin.impersonation.start` | Start with tenant, target user, reason, duration |
| POST | `/admin/impersonations/{sessionId}/end` | `admin.impersonation.end` | `admin.impersonation.start` | End early |

## Events

Published:

| Type | When | Data |
|---|---|---|
| `platform.tenant.created` | Tenant created | `tenantId, slug, displayName` |
| `platform.tenant.status_changed` | Activated, suspended, reactivated, closed | `tenantId, from, to, reason` |
| `platform.institution.changed` | Institution created, updated or deleted | `institutionId, change, fields` |
| `platform.campus.changed` | Campus created, updated or deleted | `campusId, institutionId, change` |
| `platform.module.enabled` | Entitlement enabled or changed | `moduleKey, allowedVariants, limits` |
| `platform.module.disabled` | Entitlement disabled | `moduleKey, readOnlyUntil` |
| `platform.settings.changed` | Module settings changed at any scope | `moduleKey, scopeType, scopeId` |

Consumed: none.

## Public facade

```ts
interface PlatformFacade {
  getTenant(tenantId): Promise<TenantSummary>;
  getInstitution(institutionId): Promise<Institution | null>;
  getCampus(campusId): Promise<Campus | null>;
  isModuleEnabled(moduleKey, variantKey?): Promise<boolean>;          // check 1, cached
  isVariantActive(moduleKey, variantKey, scope): Promise<boolean>;    // check 2, cached
  resolveSettings<T>(moduleKey, scope: { institutionId?, campusId? }): Promise<T>;
  getLimit(moduleKey, limitKey): Promise<number | null>;
  resolvePlacement(tenantId): Promise<Placement>;                     // used by server-kit
}
```

## Business rules

1. A module can't be enabled unless all its `depends_on` modules are enabled; a module can't be disabled while a dependent module is enabled.
2. Disabling a module never deletes data. The module becomes read-only until `read_only_until` (default 90 days), then hidden.
3. Settings resolve module default → organization → institution → campus; most specific wins. A variant can't be enabled at any scope unless it is in the entitlement's `allowed_variants`.
4. Every institution has at least one campus.
5. Suspending a tenant blocks all logins for that tenant at the next token check (at most 5 minutes, the access token lifetime).
6. Impersonation lasts at most 60 minutes, requires a reason, and appears in the tenant's audit log.
7. Cache keys for checks 1 and 2 are dropped when `platform.module.*` or `platform.settings.changed` events are relayed; changes take effect within seconds.

## Tests

- Enabling `attendance` without `students` fails; disabling `students` with `attendance` enabled fails.
- A campus can't enable `biometric` when the tenant's entitlement allows only `manual`.
- Settings inheritance returns the campus value over the institution value over the organization value.
- A tenant-side endpoint never returns another tenant's institutions, even for a user with `platform.institution.view`.
- A tenant token can't call `/admin/...`; a platform token can't call tenant endpoints except through impersonation.

## Open questions

- Plan changes: when a tenant's plan changes, are existing overrides kept? Proposed: yes; overrides always win.
