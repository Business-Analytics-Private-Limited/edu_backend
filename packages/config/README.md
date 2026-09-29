# Config

`@eduplatform/config`: shared TypeScript settings, so every backend package compiles with the same strict rules.

| File | Used by |
|---|---|
| `tsconfig.base.json` | Everything: strict mode and common options |
| `tsconfig.node.json` | Apps, services and server-kit: Node module resolution, decorators for NestJS |

ESLint and Prettier settings live at the repository root (`eslint.config.mjs`, `.prettierrc.json`).
