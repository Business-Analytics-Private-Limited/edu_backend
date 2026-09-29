# 8. API conventions

> **Note (2026-09-29):** the backend was simplified ([ADR-0015](adr/0015-simplified-backend.md)). This document still describes the product's data and rules, but where it mentions one schema per module, the outbox, Keycloak, OpenAPI files in packages/contracts or service packages, today's code differs: one Prisma schema (`prisma/schema.prisma`), JWT login, Swagger generated from the controllers, and feature folders in `src/modules/`.

Every endpoint follows these rules. They are checked by the contract test and the architecture test ([ADR-0010](adr/0010-api-documentation.md)).

## 8.1 Where the documentation lives

| What | Where |
|---|---|
| OpenAPI per module (source of truth) | `packages/contracts/openapi/<module>.yaml` |
| Shared components (errors, pagination, security) | `packages/contracts/openapi/common.yaml` |
| Bundled document | `packages/contracts/dist/openapi.yaml` (generated) |
| Swagger UI | `http://localhost:3000/api/docs` (development and staging) |
| Postman collection and environments | `packages/contracts/postman/` (generated; import into Postman) |
| Human-readable module guide | `docs/modules/<module>.md` |

Regenerate after changing an OpenAPI file: `pnpm contracts:build` (bundles, generates types and zod schemas, regenerates the Postman collection).

## 8.2 Paths and naming

- `/api/v1/<module>/<resource>`, kebab-case, plural resources: `/api/v1/students/students`, `/api/v1/attendance/raw-events`.
- Sub-resources for ownership: `/api/v1/students/students/{studentId}/guardians`.
- Actions that aren't CRUD use `POST` on a verb sub-path: `POST /api/v1/students/promotions/{promotionId}/apply`.
- The current user's endpoints: `/api/v1/me/...`. Super admin endpoints: `/api/v1/admin/<resource>`; they accept only tokens from the Keycloak `platform` realm and use the `edu_platform` database role (ADR-0009).
- JSON bodies and query parameters in **camelCase**. Enumerated values in snake_case (`"status": "half_day"`).
- `operationId` = `<module>.<resource>.<action>`, e.g. `students.student.create`. Postman request names and generated client methods come from it.

## 8.3 Every operation documents

| Field | Example |
|---|---|
| `summary` and `description` | What it does, who uses it, side effects |
| `tags` | The module key (groups operations in Swagger and folders in Postman) |
| `x-module` | `students` — the module whose entitlement is required (`@RequireModule`) |
| `x-permission` | `students.student.create` (`@RequirePermission`) |
| `x-scope` | How the scope check picks the target, e.g. `institution from body.institutionId` |
| `x-audit` | `true` if the operation writes an audit entry |
| `x-events` | Events emitted, e.g. `[students.student.admitted]` |
| Request and response schemas | With `example` values for every field |
| All error responses | 400, 401, 403, 404, 409, 422, 429 as applicable |

The contract test fails if `x-module` or `x-permission` is missing, or if they differ from the controller's decorators.

Two explicit exceptions satisfy the guard rule (CLAUDE.md rule 3) without a module permission, and the architecture test accepts only these:

| Decorator | OpenAPI | Used for |
|---|---|---|
| `@Public()` | `security: []`, `x-permission: public` | Health checks only |
| `@AuthenticatedOnly()` | `x-permission: authenticated` | The caller's own data: `/me/*`, `/platform/organization` |

## 8.4 Authentication and headers

| Header | Direction | Purpose |
|---|---|---|
| `Authorization: Bearer <access token>` | request | Keycloak access token. Browsers never see it: the Next.js server holds the session and adds it. Postman uses its OAuth 2.0 helper against the local Keycloak. The API checks signature, realm, expiry and the `eduplatform-api` audience, then that the person is an active user. Tenant endpoints accept only `tenants`-realm tokens (requested with scope `openid organization`); `/admin` endpoints accept only `platform`-realm tokens. |
| `X-Institution-Id` | request, optional | The active institution for users who belong to several |
| `X-Request-Id` | request (optional) and response | Correlates logs and audit entries; generated if absent |
| `Idempotency-Key` | request, on create and bulk endpoints | Repeating a request with the same key within 24 h returns the first result instead of creating twice |
| `If-Match: "<version>"` | request, on update and delete | Optimistic locking; a stale version returns `409` |
| `ETag: "<version>"` | response, on single resources | The current version |
| `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` | response | Rate limiting |

## 8.5 Responses

Single resource:

```json
{ "data": { "id": "0192...", "admissionNo": "SVJC26-0001", "version": 3 } }
```

Lists use cursor pagination (stable under inserts, fast on large tables):

```
GET /api/v1/students/students?limit=50&cursor=eyJpZCI6...&status=active&sort=fullName
```

```json
{
  "data": [ { "id": "..." } ],
  "page": { "limit": 50, "nextCursor": "eyJpZCI6...", "hasMore": true }
}
```

- `limit` defaults to 25, maximum 200.
- Filters are plain query parameters; `sort` takes a field name, `-field` for descending.
- Long-running work (imports, promotion apply, exports) returns `202 Accepted` with a job resource; the client polls `GET` on it.
- Dates are `YYYY-MM-DD`; instants are ISO 8601 in UTC (`2026-09-28T04:30:00Z`). The client displays them in the institution's time zone.

## 8.6 Errors

Errors use RFC 9457 `application/problem+json` with a stable `code`:

```json
{
  "type": "https://docs.eduplatform.local/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "code": "validation_failed",
  "detail": "2 fields are invalid",
  "requestId": "01J8...",
  "errors": [
    { "path": "dateOfBirth", "code": "invalid_date", "message": "Must be a valid date" }
  ]
}
```

| Status | `code` | When |
|---|---|---|
| 400 | `bad_request` | Malformed JSON, unknown query parameter |
| 401 | `unauthenticated` | Missing, expired or invalid token |
| 403 | `module_not_enabled` | Tenant isn't entitled to the module, or the variant is off here |
| 403 | `permission_denied` | None of the user's roles grants the permission |
| 404 | `not_found` | The record doesn't exist **or is outside the user's scope** (never reveal that it exists) |
| 409 | `version_conflict` | `If-Match` version is stale |
| 409 | `conflict` | Unique rule violated (e.g. admission number taken) |
| 422 | `validation_failed` | Body fails the schema or a business rule |
| 429 | `rate_limited` | Too many requests |
| 500 | `internal_error` | Unexpected; details only in logs, never in the response |

## 8.7 Security rules for every endpoint

- Request bodies are validated strictly: unknown fields are rejected, so a client can never set `tenantId`, `createdBy` or `version` directly.
- `tenantId` never appears in a request. It comes from the verified token.
- Rate limits: 300 requests per minute per user by default; login-adjacent, import and export endpoints lower.
- Maximum request body 1 MB, except file uploads, which go directly to object storage through a signed URL.
- CSV and Excel exports escape cells that start with `=`, `+`, `-` or `@`.
