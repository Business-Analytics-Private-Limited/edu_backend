# Module: identity

| | |
|---|---|
| Schema | `identity` |
| Phase | 2 |
| Depends on | platform |
| Code | `services/identity/` |

## Purpose

Our record of every person who can log in, linked to their Keycloak account. It is the only module that talks to Keycloak (ADR-0003).

## Responsibilities

- User accounts for staff, guardians and students; their status and memberships in institutions.
- Creating, inviting, disabling and resetting users in Keycloak through its Admin API.
- Resolving a verified token (`sub`, `org`) to our user.
- `GET /me/bootstrap`, which the web app calls after login.

Not this module: student and guardian profiles (`students`), roles and permissions (`access`), staff HR profiles (v2 `staff`).

## Manifest

- Always enabled.
- Settings (organization level): `login.identifiers` (`email`, `phone`, both), `invitation.expiryHours` (default 72).

## Permissions

User management permissions are named under `access` in doc 4 and reused here:

| Permission | Allows |
|---|---|
| `access.user.view` | List and view staff users within scope |
| `access.user.manage` | Invite, edit, deactivate and reactivate users; trigger password reset |

## Data model

```
identity.users                                                                               [std][sd]
  id, tenant_id
  keycloak_sub    text not null         unique (tenant_id, keycloak_sub)
  user_type       text check (staff | guardian | student)
  display_name    text not null  [P]
  email           text           [P]   unique (tenant_id, lower(email)) where email is not null and deleted_at is null
  phone           text           [P]   E.164; unique (tenant_id, phone) where phone is not null and deleted_at is null
  status          text check (invited | active | suspended | deactivated)
  locale          text
  last_login_at   timestamptz
  check (email is not null or phone is not null)

identity.memberships                    institutions a user belongs to                      [std]
  id, tenant_id
  user_id         uuid not null         fk (tenant_id, user_id) → users
  institution_id  uuid not null         → platform.institutions
  is_default      boolean not null default false
  status          text check (active | inactive)
  unique (tenant_id, user_id, institution_id)
  unique (tenant_id, user_id) where is_default
```

One Keycloak account may belong to several tenants, so `keycloak_sub` is unique per tenant, not globally.

## API

| Method | Path | operationId | Permission | Description |
|---|---|---|---|---|
| GET | `/me/bootstrap` | `identity.me.bootstrap` | authenticated | User, tenant, active institution, branding, effective modules and variants, resolved settings, permissions with scopes (doc 5 §5.6) |
| PATCH | `/me` | `identity.me.update` | authenticated | Own display name and locale |
| GET | `/identity/users` | `identity.user.list` | `access.user.view` | Search users (`?q&userType&status&institutionId`) |
| POST | `/identity/users` | `identity.user.invite` | `access.user.manage` | Invite a staff user (email or phone); creates the Keycloak account and sends the invitation |
| GET | `/identity/users/{userId}` | `identity.user.get` | `access.user.view` | One user with memberships |
| PATCH | `/identity/users/{userId}` | `identity.user.update` | `access.user.manage` | Edit name, email, phone |
| POST | `/identity/users/{userId}/deactivate` | `identity.user.deactivate` | `access.user.manage` | Deactivate with reason; ends sessions |
| POST | `/identity/users/{userId}/reactivate` | `identity.user.reactivate` | `access.user.manage` | Reactivate |
| POST | `/identity/users/{userId}/password-reset` | `identity.user.reset_password` | `access.user.manage` | Send a password reset link |
| PUT | `/identity/users/{userId}/memberships` | `identity.membership.put` | `access.user.manage` | Set the institutions a user belongs to |

## Events

Published:

| Type | When | Data |
|---|---|---|
| `identity.user.created` | User created (invited, or portal login created) | `userId, userType` |
| `identity.user.updated` | Name, email or phone changed | `userId, fields` |
| `identity.user.deactivated` | Deactivated | `userId, reason` |
| `identity.user.reactivated` | Reactivated | `userId` |
| `identity.membership.changed` | Memberships set | `userId, institutionIds` |

Consumed: `platform.tenant.status_changed` (suspension disables sessions in Keycloak).

## Public facade

```ts
interface IdentityFacade {
  getUser(userId): Promise<User | null>;
  resolveFromToken(keycloakSub): Promise<User | null>;               // under the token's tenant
  createPortalUser(input: { userType: 'guardian' | 'student'; displayName; email?; phone? }): Promise<User>;
  deactivate(userId, reason): Promise<void>;
  getMemberships(userId): Promise<Membership[]>;
}
```

## Business rules

1. A request is authenticated only if the token is valid, `org` matches an active tenant, and `(org, sub)` is an active user of that tenant.
2. Invitations expire after `invitation.expiryHours`; an expired invitation can be resent.
3. Deactivation ends the user's Keycloak sessions immediately.
4. A user can't deactivate themselves if they are the last user with `access.role.manage` (rule owned by `access`, checked through its facade).

## Tests

- A token whose `org` is tenant B can't resolve a user of tenant A with the same `sub`.
- A deactivated user's token is rejected even before it expires.
- Inviting a user whose email already exists in the tenant returns `409 conflict`.

## Open questions

- Phone-only logins for parents need Keycloak to accept a phone number as the username. Confirm during Phase 2 setup; OTP login is a later addition.
