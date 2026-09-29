# Running one service on its own

Every service can be started alone, for example to work on `students` without starting the others. The same API host (`apps/api`) runs whichever services you name.

## Steps

1. In the `.env` file at the repository root, name the services to run and, if you like, a port:

   ```
   ENABLED_SERVICES=students,academic,identity,files
   PORT=3010
   ```

2. Start only the backend API host:

   ```sh
   pnpm dev:api
   ```

3. The startup log confirms what runs: `"services":["academic","identity","files","students"] … api started`.

To go back to all services, remove `ENABLED_SERVICES` (or leave it empty).

## Why you must list the dependencies too

A service calls the services it depends on inside the same process, through their public interface. So `students` can't start without `academic`, `identity` and `files` (its `dependsOn` in the manifest). The host checks this at startup and stops with a clear message:

```
ENABLED_SERVICES is missing dependencies (students needs academic). Add them to ENABLED_SERVICES.
```

Dependencies: [docs/02-domain-map.md §2.3](../02-domain-map.md). A misspelled name also stops startup and lists the available services.

## What still runs for every service

- **Migrations:** `pnpm db:migrate` always creates the tables of every service, because they share one database. Running one service doesn't remove other tables.
- **Health endpoints:** `/api/v1/health` works in every combination.

## Other commands

| Command | Starts |
|---|---|
| `pnpm dev` | API (all services, or those in `ENABLED_SERVICES`), worker, device gateway |
| `pnpm dev:api` | API only |

The web app and admin console run from the separate frontend repository (`pnpm dev` there).

## Later: a service as a truly separate microservice

`ENABLED_SERVICES` runs a subset in one process for development. In production, a service that needs to scale on its own gets its own host deployment (same code, its own port and database), and a reverse proxy routes its URL paths to it. Its dependencies are then called over HTTP instead of in-process. See [ADR-0011](../adr/0011-microservice-ready-services.md).
