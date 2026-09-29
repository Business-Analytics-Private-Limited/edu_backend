# 5. Module catalog

## 5.1 The three control layers

```
LAYER 1  ENTITLEMENT    super admin   → which modules and which variants a tenant may use, limits, expiry
LAYER 2  CONFIGURATION  tenant admins → which of the allowed variants each institution / campus uses, plus module settings
LAYER 3  ACCESS         tenant admins → who can do what, where (doc 4)
```

Only the platform super admin can grant or revoke modules and variants. Tenants choose only within what they were given.

## 5.2 Module manifest

Every module ships a manifest. It is the single source for backend guards, the super admin screens, the tenant settings screens and the frontend navigation.

```ts
export const attendanceManifest: ModuleManifest = {
  key: "attendance",
  name: "Attendance",
  version: 1,
  category: "academics",
  dependsOn: ["academic", "students"],
  appliesTo: ["junior_college", "degree_college", "engineering_college", "school"],

  variants: [
    { key: "manual",    name: "Manual marking",        default: true },
    { key: "biometric", name: "Biometric devices",     settingsSchema: biometricSettings },
    { key: "rfid",      name: "RFID cards",            status: "planned" },
    { key: "qr",        name: "QR code scan",          status: "planned" },
    { key: "mobile_geo",name: "Mobile app, geo-fenced", status: "planned" },
  ],
  variantSelection: "multiple",           // a campus may use manual AND biometric together

  settingsSchema: attendanceSettings,     // JSON Schema; validated on save
  limits: [{ key: "devices.max", default: 5 }],

  permissions: [ "attendance.record.view", "attendance.record.mark", /* … */ ],
  events: { publishes: ["attendance.record.marked"], consumes: ["students.enrolment.changed"] },

  navigation: [
    { path: "/attendance",         label: "Attendance", permission: "attendance.record.view" },
    { path: "/attendance/mark",    label: "Mark",       permission: "attendance.record.mark", variant: "manual" },
    { path: "/attendance/devices", label: "Devices",    permission: "attendance.device.manage", variant: "biometric" },
  ],
};
```

## 5.3 Entitlement data (schema `platform`)

| Table | Purpose |
|---|---|
| `modules`, `module_variants` | Catalog, synced from manifests at deploy time |
| `plans`, `plan_modules`, `plan_module_variants` | Default bundles (e.g. Starter, Standard, Enterprise) |
| `tenant_entitlements` | `tenant_id, module_key, enabled, allowed_variants[], limits jsonb, starts_at, ends_at, source (plan / override)` |
| `module_settings` | `tenant_id, module_key, scope_type (organization / institution / campus), scope_id, enabled_variants[], settings jsonb, version` |
| `feature_flags`, `tenant_feature_flags` | Gradual rollout of new features |

**Rules the platform enforces:**

- Dependencies: enabling `attendance` requires `academic` and `students`. Disabling `students` is blocked while `attendance` is enabled.
- **Disabling a module never deletes data.** The module becomes read-only for 90 days (configurable), then hidden. Data is kept until the tenant requests deletion.
- Changing a variant never breaks history. Attendance marked manually last month keeps `source = manual` after the campus switches to biometric.
- Entitlement changes publish `platform.module.enabled` / `disabled`, and caches invalidate within seconds.

## 5.4 v1 module catalog

| Module | Variants / tools | Key settings | Depends on |
|---|---|---|---|
| **academic** | Structure template: `junior_college_v1` (v1), `degree_v1`, `engineering_v1`, `school_v1` (v3) | Section capacity, subject mapping | — |
| **students** | Admission-number mode: `manual` · `auto_pattern` (e.g. `{INST}{YY}{SEQ:4}`) | Required fields, custom fields, categories, document types | academic |
| **attendance** | `manual` · `biometric` (v1); `rfid` · `qr` · `mobile_geo` (planned) | Daily or period-wise; late-after time; half-day rule; working-day calendar; who can correct and for how many days back | academic, students |
| **portal** | Parent login · student login (each can be switched on separately) | Which sections are visible (profile, attendance, later results / fees) | students |
| **imports** | CSV · Excel templates | Duplicate handling (skip / update) | students, academic |

## 5.5 Attendance design

```
 Manual marking (teacher UI) ─┐
 Biometric device (push API) ─┤                     ┌──────────────────┐     ┌────────────────────┐
 RFID / QR / mobile (later) ──┴─► attendance_events ─► rules engine      ├────►│ attendance_records │──► reports, portal
                                 (raw, immutable:    │ policy per campus│     │ one per person per │
                                  who, when, source, │ late / half-day /│     │ day or period, with│
                                  device, payload)   │ in-out pairing   │     │ status + source    │
                                                     └──────────────────┘     └────────────────────┘
                                                              ▲
                                                 corrections (audited, reason required)
```

- **One records table for every source.** Reports and the portal don't need to know how attendance was captured.
- Raw events are immutable. A correction creates a new record version with a reason; it never overwrites.
- **Biometric ingestion** (`apps/device-gateway`):
  1. Devices are registered with their serial number to a tenant and campus (`attendance.devices`).
  2. Devices push punches over their vendor push protocol (e.g. the ZKTeco / eSSL "ADMS" style HTTP push). The gateway identifies the tenant from the device serial and a per-device secret.
  3. The device user id maps to a student or staff member (`attendance.device_person_map`), filled from enrolment on the device or from a mapping import.
  4. The gateway writes raw events and returns immediately. The worker applies rules.
  5. For institutes whose devices can't reach the internet: a small on-premise sync agent (later) pulls from the device and pushes to the gateway.
- Staff attendance (v2) reuses the same module with `person_type = staff`.

## 5.6 Frontend composition

After login, `GET /api/v1/me/bootstrap` returns the user, active tenant and institution, branding, **effective modules and variants**, resolved settings and the user's permissions with scopes.

- The sidebar is built from the manifests' `navigation`, filtered by entitlement, variant and permission.
- Route guards show "Module not available" or "No access" pages instead of broken screens.
- `<Can permission="…" scope={…}>` hides buttons the user can't use. The API still enforces every rule.
- Variant-specific screens live in `eduplatform-frontend/apps/web/src/modules/attendance/variants/{manual,biometric}` and load only when the variant is active.

## 5.7 Super admin console (eduplatform-frontend/apps/admin), v1 screens

1. **Organizations:** list, onboarding wizard (details → institutions → plan → modules and variants → first admin user), suspend / reactivate
2. **Entitlements:** a tenant × module matrix with variants, limits and expiry; shows dependency conflicts
3. **Plans:** module bundles; per-tenant overrides win
4. **Feature flags**
5. **Role templates:** the defaults new tenants receive
6. **Devices:** registry of biometric devices across tenants, last-seen status
7. **Impersonation:** with reason and time limit, audited, visible in the tenant's audit log
8. **Usage:** students, users and storage per tenant; errors per tenant
