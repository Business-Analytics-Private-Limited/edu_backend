# Module documentation

One document per module of EduPlatform: what it is for, its screens / endpoints and its rules.

| Module | In plain words | Status | Document | Code |
|---|---|---|---|---|
| platform | Organizations (with their type), branches; which modules each organization has | **Built** | [platform.md](platform.md) | `src/modules/super-admin`, `src/modules/organization` |
| access | Login, users, roles and permissions, roles at the organization or a branch | **Built** | [access.md](access.md) | `src/modules/auth`, `users`, `roles`, `src/common/scope.ts` |
| audit | Who changed what, where, when | **Built** | [audit.md](audit.md) | `src/modules/audit` |
| academic | Academic years, the structure shaped by the organization's type, sections per branch, subjects, calendar | **Built** | [academic.md](academic.md) | `src/modules/academic` |
| students | Admission, profiles, placements and their history, outgoing students, promotion, import, documents | **Built** | [students.md](students.md) | `src/modules/students` |
| attendance | Daily attendance per section, corrections, reports (period-wise and biometric next) | **Built (part 1)** | [attendance.md](attendance.md) | `src/modules/attendance` |
| portal | Parents and students see their children's / own details and attendance | **Built (part 1)** | [portal.md](portal.md) | `src/modules/portal` |
| imports | Import students and other data from Excel / CSV | Design | [imports.md](imports.md) | — |
| files | Storing uploaded files (student documents) | **Built** | [files.md](files.md) | `src/modules/files` |

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
