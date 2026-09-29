# ADR-0010: API documentation with OpenAPI, Swagger UI and generated Postman collections

Status: Accepted
Date: 2026-09-28

## Context

Every endpoint must be documented for the frontend, for testers and for institutions' IT staff who integrate later. The project rule "contracts first" (CLAUDE.md rule 7) already makes OpenAPI the source of an endpoint's shape. Hand-written Swagger annotations or a hand-maintained Postman collection would drift from the real API.

## Decision

- **Source of truth:** one OpenAPI 3.1 document per module in `packages/contracts/openapi/<module>.yaml`, plus shared components (errors, pagination, security) in `packages/contracts/openapi/common.yaml`. Written **before** the endpoint is implemented.
- **Bundling:** a script bundles the module documents into `packages/contracts/dist/openapi.yaml` (and `.json`).
- **Swagger UI:** the API serves the bundled document at `/api/docs` (UI) and `/api/docs/openapi.json` in development and staging. It is off in production unless explicitly enabled.
- **Postman:** a script converts the bundled document into `packages/contracts/postman/eduplatform.postman_collection.json`, plus environment files for local and staging. The collection is generated, never edited by hand; it is regenerated in CI and the build fails if the committed copy is out of date.
- **Implementation checks:** request and response bodies are validated with zod schemas generated from the same OpenAPI document. A contract test calls every documented operation and fails if the API returns a shape the document doesn't describe, or if a route exists that the document doesn't list.
- **Conventions** for paths, errors, pagination and security are in [doc 8](../08-api-conventions.md).

## Consequences

- The documentation cannot drift from the running API without a failing test.
- Every module's Phase starts by writing its OpenAPI file; the module document in `docs/modules/` lists the endpoints and links to it.

## Alternatives considered

- **Code-first with `@nestjs/swagger` decorators:** documentation is generated from controllers, but it contradicts "contracts first" and lets undocumented behaviour ship. Rejected.
- **Hand-maintained Postman collection:** drifts within weeks. Rejected.
