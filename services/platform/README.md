# Platform service

`@eduplatform/platform-service`: organizations (tenants), institutions, campuses, the module catalog and entitlements. Full design: [docs/modules/platform.md](../../docs/modules/platform.md). Contract: [packages/contracts/openapi/platform.yaml](../../packages/contracts/openapi/platform.yaml).

## Status

| Part | Status |
|---|---|
| Module catalog synced from manifests at startup | ✅ step 2a |
| Super admin: organizations (create, search, details, edit, activate, suspend, reactivate) | ✅ step 2a |
| Super admin: add institutions with their first campus | ✅ step 2a |
| Super admin: grant and take away modules, with dependency rules | ✅ step 2a |
| Tenant side: own organization, enabled modules | ✅ step 2a |
| Platform staff login and permissions by role | ✅ step 2a |
| Tenant side: institutions, campuses, module settings; plans, feature flags, impersonation, usage | step 2b (marked `x-planned` in the contract) |

## Where things are

| Path | What it is |
|---|---|
| `migrations/0001_catalog_and_staff.sql` | Platform-level tables: platform staff, module catalog, plans, feature flags |
| `migrations/0002_tenants.sql` | Tenants and tenant-owned tables, with Row-Level Security for `edu_app` and `edu_platform` |
| `src/manifest.ts` | This service's manifest |
| `src/catalog/planned-modules.ts` | Catalog entries for modules whose service isn't built yet (move each out when it is) |
| `src/domain/` | Business rules, no database: entitlement dependencies, status changes, staff roles |
| `src/infrastructure/schema.ts` | Drizzle table definitions (mirror of the migrations) |
| `src/application/` | Use cases: catalog, tenants, entitlements, staff, organization, and the facade |
| `src/http/` | Controllers and request schemas |
| `src/public/` | What other services and the host may use: `PlatformFacade`, tokens |

## Rules worth knowing

- Super admin code uses `PLATFORM_POOL` (role `edu_platform`), which sees all tenants **in schema `platform` only**. Tenant code uses `APP_POOL` under Row-Level Security.
- Every staff action writes `audit.platform_entries` and an event in `platform.outbox`, in the same transaction.
- Core modules (platform, identity, access, audit, files) are enabled for every new organization and can't be taken away.
- `isModuleEnabled` is cached for 60 seconds in memory; changes made by this process clear the cache at once (ADR-0014).

## Giving someone access to the super admin console

Create the person in Keycloak (realm `platform`), then:

```sh
pnpm platform:add-staff -- --email you@example.com --role platform_owner
```

Roles: `platform_owner`, `platform_admin`, `platform_support`. See `apps/api/src/cli/add-platform-staff.cli.ts`.
