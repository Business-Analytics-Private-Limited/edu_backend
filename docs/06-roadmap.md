# 6. Roadmap

Each phase ends with something that runs and is tested. No phase starts until the previous one's exit check passes.

## Where we are (2026-11-27)

| Phase | Status |
|---|---|
| 0. Design | Done |
| 1. Foundation | Done, simplified (ADR-0015, ADR-0016): one NestJS app, Prisma, JWT login, local PostgreSQL, npm; no Docker / Redis / Keycloak yet |
| 2. Platform core | **Done.** Super admin console and web app; organizations (with a type and code) and their branches; modules; users with several roles at places (organization / branch); predefined roles managed by the super admin, customizable per organization; audit log, add-only, with logins and document downloads; login security: lockout, sessions, forced password change, two-step login for super admins (ADR-0017, ADR-0018, ADR-0027 to ADR-0029) |
| 3. Academic | **Done.** Academic years for the organization; one structure engine shaped by the organization's type (School / Intermediate / Degree / Engineering), sections per branch, groups per branch, courses with or without specializations, progression; subjects (inherited down the tree), calendar (ADR-0030, ADR-0032, ADR-0033) |
| 4. Students | **Done.** Admission (with lateral entry), profile with optional and sensitive details, guardians (shared by siblings), documents, placements as periods with a timeline, change section / branch, outgoing students and re-admission, promotion of a branch, a section or chosen students (with undo), CSV import into a chosen section with import records, automatic or typed admission numbers, top rankers (ADR-0020, ADR-0023, ADR-0030, ADR-0031, ADR-0034) |
| 5. Attendance | **In progress.** Part 1 done: daily marking per section, corrections with reasons, correction window, overview, reports; a student moved on a marked day keeps that mark (ADR-0021, ADR-0034). Next: period-wise marking, then biometric devices |
| 6. Portal | **In progress.** Part 1 done: parent and student logins linked to records, a parent sees all their children, details and attendance (ADR-0022). Later: phone login, consent, notices |
| Password reset | **Next.** Part of v1 (doc 1, section 1.5); built now in today's backend, not in M2 (ADR-0035) |
| 7. Importer and pilot | Not started |

### Order of work (ADR-0035)

1. **Password reset:** an admin sets a temporary password for a user they manage (the forced change already exists); "forgot password" by email once a mail provider is chosen.
2. **Period-wise attendance** (Phase 5, part 2). `attendance_records.period` already exists and is always 0 (the whole day) today.
3. **Biometric attendance** (Phase 5, part 3): needs the first institutions' device models (open decision below).
4. **Importer and pilot** (Phase 7).
5. **Architecture migration** ([ADR-0024](adr/0024-microservices-and-tenant-sharding.md), accepted): M0 Docker, gateway and logging → M1 tenant sharding (with a load test) → M2 Tenant and Identity services. Then Files, events and Audit, Attendance, Students and Academic, and Portal become services one by one.

Until M0 starts, ADR-0015 and ADR-0012 still describe how the backend is built.

The original plan per phase is below; where it names Docker, Redis, Keycloak or outbox, see ADR-0015.

| Phase | Goal | Exit check |
|---|---|---|
| **0. Design** (this folder) | Requirements, domain map, tenancy, permissions, module catalog, ADRs | Project owner has reviewed and accepted docs 1–5 and the ADRs |
| **1. Foundation** | Monorepo, Docker Compose (Postgres, Redis, Keycloak, MinIO), CI, shared libraries: tenant context, DB transaction with `app.tenant_id`, guards, outbox, audit, logging | `pnpm dev` starts everything; CI runs lint, type-check and tests; an RLS test proves isolation on a sample table |
| **2. Platform core (walking skeleton)** | platform, identity, access, audit modules; `/me/bootstrap`; super admin console (organizations, entitlements); web shell with dynamic sidebar | Super admin creates organization A with Students + Attendance → A's admin logs in and sees only those modules → creates a Teacher role → teacher sees less → organization B sees nothing of A |
| **3. Academic** | Structure engine + `junior_college_v1` template, academic years, subjects | Institution admin builds 1st/2nd year × MPC/BiPC/CEC × sections for two campuses |
| **4. Students** | Admission, profile, guardians, documents, categories, promote / shuffle, status history | 1,000 students imported from CSV; promotion to next year previewed and applied |
| **5. Attendance** | Manual (daily and period-wise), policies, corrections, reports; device-gateway + biometric ingestion | Teacher marks a section; punches from a real or simulated device become attendance; correction is audited |
| **6. Portal** | Parent and student login; profile and attendance views; multi-child switch | Parent with children in two institutions sees both, and nothing else |
| **7. Importer and pilot** | Import templates and the mapping from the first institution's existing data; staging deployment | First institution runs a parallel pilot |
| **8. v2 modules** | Exams, fees, staff, notifications, timetable | Per module, as defined when the phase starts |

## Open decisions (to settle before the phase that needs them)

| Decision | Needed by |
|---|---|
| Hosting provider (DigitalOcean or AWS) and region | Phase 7 |
| Product name and domain | Phase 7 |
| Biometric device brands and models used by the first institutions | Phase 5 |
| SMS / WhatsApp provider | v2 |
| Payment gateway | v2 |
