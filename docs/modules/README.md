# Module documentation

One document per module. Each follows the same template so that anyone can find the same information in the same place.

| Module | Schema | Phase | Document | OpenAPI |
|---|---|---|---|---|
| platform | `platform` | 2 | [platform.md](platform.md) | `packages/contracts/openapi/platform.yaml` |
| identity | `identity` | 2 | [identity.md](identity.md) | `packages/contracts/openapi/identity.yaml` |
| access | `access` | 2 | [access.md](access.md) | `packages/contracts/openapi/access.yaml` |
| audit | `audit` | 1–2 | [audit.md](audit.md) | `packages/contracts/openapi/audit.yaml` |
| files | `files` | 2 | [files.md](files.md) | none (no public endpoints) |
| academic | `academic` | 3 | [academic.md](academic.md) | `packages/contracts/openapi/academic.yaml` |
| students | `students` | 4 | [students.md](students.md) | `packages/contracts/openapi/students.yaml` |
| attendance | `attendance` | 5 | [attendance.md](attendance.md) | `packages/contracts/openapi/attendance.yaml`, `device-gateway.yaml` |
| portal | none | 6 | [portal.md](portal.md) | `packages/contracts/openapi/portal.yaml` |
| imports | `imports` | 7 | [imports.md](imports.md) | `packages/contracts/openapi/imports.yaml` |

The OpenAPI file for a module is written at the start of the module's phase (contracts first). Until then, the endpoint table in the module document is the plan.

## Conventions used in these documents

- Table notation: `[std]` = standard columns, `[sd]` = soft delete, `[P]` = personal data, `[S]` = sensitive personal data. See [doc 7 §7.2](../07-database-design.md).
- Every tenant table has `tenant_id uuid not null`, `unique (tenant_id, id)`, and the forced `tenant_isolation` RLS policy. The tables below don't repeat this.
- Every module that publishes events has `<schema>.outbox`; every module that consumes events has `<schema>.inbox` ([doc 7 §7.5](../07-database-design.md)). Not repeated below.
- Endpoints: path prefix `/api/v1` omitted. Super admin endpoints live under `/admin/...` and accept only tokens from the `platform` realm.
- Every endpoint also returns the standard errors from [doc 8 §8.6](../08-api-conventions.md).

## Template

```md
# Module: <key>

| | |
|---|---|
| Schema | ... |
| Phase | ... |
| Depends on | ... |
| Code | services/<key>/ |

## Purpose
## Responsibilities (and what this module does not do)
## Manifest (variants, settings, limits)
## Permissions
## Data model
## API
## Events (published / consumed)
## Public facade (for other modules)
## Business rules
## Tests (beyond the standard isolation and contract tests)
## Open questions
```
