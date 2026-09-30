# Module documentation

One document per module of EduPlatform: what it is for, its screens / endpoints and its rules.

| Module | In plain words | Status | Document | Code |
|---|---|---|---|---|
| platform | Organizations, institutions, campuses; which modules each organization has | **Built** | [platform.md](platform.md) | `src/modules/super-admin`, `src/modules/organization` |
| access | Login, users, roles and permissions, roles at places | **Built** | [access.md](access.md) | `src/modules/auth`, `users`, `roles`, `src/common/scope.ts` |
| audit | Who changed what, where, when | **Built** | [audit.md](audit.md) | `src/modules/audit` |
| academic | Academic years, classes / groups / sections, subjects, holidays | Next (design) | [academic.md](academic.md) | — |
| students | Admissions, profiles, guardians, documents, promotion | Design | [students.md](students.md) | — |
| attendance | Manual and biometric attendance, corrections, reports | Design | [attendance.md](attendance.md) | — |
| portal | Parents and students see profile and attendance | Design | [portal.md](portal.md) | — |
| imports | Import students and other data from Excel / CSV | Design | [imports.md](imports.md) | — |
| files | Storing uploaded documents | Design | [files.md](files.md) | — |

`identity.md` was merged into `access.md`.

## Reading the design documents

The documents marked **Design** were written before the backend was simplified ([ADR-0015](../adr/0015-simplified-backend.md)). Their purpose, data and rules still describe the product; their technical parts do not match today's code:

| They say | Today |
|---|---|
| a PostgreSQL schema per module, `tenant_id` | one Prisma schema (`prisma/schema.prisma`), `organization_id`, same row security |
| paths like `/academic/...`, `/admin/...` | paths like `/api/v1/academic-years`, super admin under `/api/v1/super-admin/...` |
| permissions ending in `.manage` | view / create / update / delete ([access.md](access.md)) |
| outbox events, Keycloak, OpenAPI files in `packages/contracts` | direct service calls, JWT login, Swagger generated from the code |

When a module is built, its document is rewritten to match the code (as platform, access and audit were).
