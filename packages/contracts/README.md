# Contracts

`@eduplatform/contracts`: the API contract, owned by the backend ([ADR-0010](../../docs/adr/0010-api-documentation.md)). Change it **before** implementing (CLAUDE.md rule 7).

The frontend repository never imports this package. It copies the built contract (`dist/openapi.json`, also served at `http://localhost:3000/api/docs/openapi.json`) with `pnpm api:sync` ([ADR-0013](../../docs/adr/0013-separate-frontend-and-backend-repositories.md)). When you change the contract, say so in your pull request so the frontend team syncs.

| Path | What it is | Edit? |
|---|---|---|
| `openapi/common.yaml` | Shared parts: error format, pagination, headers, security | yes |
| `openapi/<service>.yaml` | One file per service: its endpoints | yes |
| `events/` | Event payload schemas | yes |
| `src/events.ts`, `src/manifest.ts` | Event envelope and module manifest types | yes |
| `scripts/build.mjs` | The build: merges, checks the rules, generates everything below | rarely |
| `dist/openapi.json`, `dist/openapi.yaml` | Merged contract, served by Swagger UI | generated |
| `src/generated/openapi.ts` | TypeScript types for every endpoint | generated, committed |
| `postman/eduplatform.postman_collection.json` | Postman collection | generated, committed |
| `postman/local.postman_environment.json` | Postman environment for localhost | yes |

After editing a YAML file: `pnpm contracts:build`, and commit the regenerated files (CI fails if they are stale).

The build rejects an operation without `operationId` (`module.resource.action`), `summary`, `tags`, `x-module` or `x-permission`, and any reference that doesn't resolve.

Examples keep the generated Postman collection identical between builds (CI checks this). Wherever a value is missing, the converter invents a random one, so:

- give every schema field an `example`;
- a nullable field needs a **non-null** example (`example: null` counts as missing);
- an object with free-form keys (`additionalProperties`) needs an example on the object itself.
