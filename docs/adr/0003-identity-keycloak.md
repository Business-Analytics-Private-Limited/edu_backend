# ADR-0003: Keycloak for authentication; authorization in our own access module

Status: Accepted
Date: 2026-09-28

## Context

The platform needs login for platform staff, institution staff, parents and students. It also needs password policies, reset flows, MFA for admins, brute-force protection, and later SSO (Google Workspace / Microsoft 365 for institutions) and mobile apps. Writing this ourselves is a large security risk for a two-person team.

Authorization, meaning which role can do what in which scope, is core business logic tied to modules and entitlements.

## Decision

- **Authentication:** Keycloak (open source, OpenID Connect / OAuth 2.0).
  - Realm `platform` for platform staff.
  - Realm `tenants` for all tenant users, using Keycloak Organizations to associate users with tenants.
  - Tokens carry only identity (`sub`, `org`, session). They don't carry permissions.
  - The web apps use the Authorization Code flow with PKCE. The API validates tokens using Keycloak's public keys.
  - Parents and students log in with mobile number or email plus password; OTP login can be added later.
- **Authorization:** our own `access` module (doc 4). Permissions and scopes are resolved per request from Redis and invalidated by events.
- The `identity` module keeps our user records and links each to its Keycloak subject. Business code never talks to Keycloak directly except through `identity`.

## Consequences

- MFA, SSO, password policies and account lockout come for free and are maintained upstream.
- Keycloak is one more container to run and upgrade, and it needs its own database (a separate database on the same Postgres server is fine).
- Because our code depends only on standard OIDC, Keycloak can be replaced by another OIDC provider (e.g. Zitadel, Auth0, Cognito) without changing business modules.

## Alternatives considered

- **Own JWT auth:** simplest to start, but MFA, reset flows, lockout and SSO become our security burden. Rejected.
- **Hosted providers (Auth0, Clerk, Cognito):** less to operate, but per-user pricing is expensive with thousands of students and parents per tenant, and it adds vendor lock-in. Possible later through the OIDC boundary.
