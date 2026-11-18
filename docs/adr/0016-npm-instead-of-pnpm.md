# ADR-0016: npm instead of pnpm

Status: Accepted
Date: 2026-09-30

Supersedes the "pnpm kept" part of ADR-0015 (and of ADR-0004). Applies to both repositories (backend and frontend).

## Context

After ADR-0015 both repositories were simple, but starting them still needed pnpm: an extra tool to install (`corepack enable` as administrator, or `npx pnpm@...`), with its own commands. The project owner wants the usual `npm install` and `npm run dev`, which every Node.js tutorial uses and which work right after installing Node.js.

## Decision

- Both repositories use **npm**, which ships with Node.js. The lock file is `package-lock.json` (committed); CI runs `npm ci`.
- Commands are `npm run <script>`, for example `npm run dev`, `npm run test:e2e`, `npm run db:migrate`. Arguments go after `--`: `npm run db:migration -- add_subjects`.
- The frontend uses **npm workspaces** (`"workspaces"` in the root `package.json`) for `apps/web`, `apps/admin` and `packages/ui`: one `npm install` at the top, one `node_modules`. `npm run dev` starts both apps together with `concurrently`.

## Consequences

- New developers need only Node.js and PostgreSQL.
- npm is somewhat slower to install than pnpm and less strict about undeclared dependencies; accepted for two small repositories.
