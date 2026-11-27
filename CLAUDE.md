# Working agreement for this repository

Read this first in every session. The design lives in `docs/`, and decisions live in `docs/adr/` (start with ADR-0015).
If a change conflicts with an accepted ADR, write a new ADR that supersedes it. Don't silently diverge.

## Team

Two developers: the project owner and Claude, with interns and freshers joining. There is no separate reviewer, so automated tests are the safety net.

## Project context (decided with the owner, 2026-09-28)

- This is a **greenfield** build. The owner's earlier single-institute MySQL application is only a requirements reference. Don't port its code or schema (ADR-0007).
- A tenant is an **organization of one type** (School, Intermediate, Degree, Engineering) with one or more **branches** (organization → branch, ADR-0030). The type shapes its academic structure.
- Institution priority: (1) junior / intermediate colleges (11th–12th, MPC/BiPC/CEC groups; the owner calls these "K12"), (2) degree and engineering colleges, (3) schools.
- Only the **platform super admin** switches modules on for organizations. Organizations choose among what was granted.
- Parent and student logins are in v1.
- Hosting is undecided (DigitalOcean or AWS). Keep everything provider-neutral.
- The v1 / v2 / v3 scope in `docs/01-product-requirements.md` has been accepted.

## Current status

- Phase 0 (design) and Phase 1 (foundation) done.
- **2026-09-29: backend rebuilt as one simple NestJS app** (ADR-0015): login (super admin and organization users), super admin area (organizations, modules), tenant admin area (organization, institutions, campuses, users, roles, audit log). Tests pass.
- **2026-10-09: organization → branches and one academic engine by organization type** (ADR-0030): branches replace institutions / campuses; structure presets per type; placements as periods; outgoing students; import into a section; automatic / manual admission numbers; promotion along progression links. 120 e2e tests pass.
- **2026-10-13: student details, sensitive details, import records, top rankers** (ADR-0031): optional details with one set of strict rules (`students/student-rules.ts`) for the form, editing and import; `students.sensitive.view`; imports save the valid rows and record the excluded ones (IMP-0001 …, no file kept, no undo); top rankers with learner levels.
- **2026-10-13: groups per branch** (ADR-0032): each branch of an Intermediate organization runs some of the organization's groups (`branch_groups`); sections only under those.
- **2026-10-14: courses without specializations** (ADR-0033): a hidden "whole course" level (`classes.placeholder`), never shown in names; edit / delete courses and specializations (`/academic-structure/programmes/:id`).
- **2026-11-10: promotion of chosen students or a whole section** (ADR-0034): `studentIds` per section; targets grouped by year; a missing next-year section is added from the promotion page (`nextPlace` in the preview); old placements end on the year's last day; roll-number clashes say who has the number. Also: a student moved on a day already marked keeps that mark (the new register takes it over, `markedIn`); duplicate names, emails and codes say what is taken although row security hides the column; audit-coverage exceptions for the course helpers. 127 e2e and 17 unit tests pass.
- **2026-11-25: Evaluation module, part 1** (ADR-0035): exam types; exams for a part of the structure at one branch or every branch, with subjects and their maximum / pass marks; marks by hand and by CSV upload (check first, valid rows saved, MKS-0001 records); results with ranks; lock / unlock. Other modules' records are plain ids, ready for its own service. Later the same day: each section has its own subjects (the New exam form offers the chosen part's subjects, with fallbacks for sections not set up), and a portion note per subject. 136 e2e and 17 unit tests pass.
- **2026-11-27: Evaluation part 1 checked**: more tests (numbers in uploads, CLEAR, decimals, subject dates, branch and organization separation, audit, a student moved before the exam) and unit tests of `readMark`, `resultOf`, `rank`. Fixed: an upload with numbers instead of text, the cleared count, subject dates outside the exam. 142 e2e and 25 unit tests pass.
- **2026-11-27: Evaluation part 2** (ADR-0037): syllabus chapters per subject (Academic), ticked per exam subject (plain ids); grading schemes (bands from a percentage up, default scheme, grade per subject, overall grade, GPA); report card settings with a logo and PDFs with pdfkit (one student, or in bulk per section / branch); overviews per exam (branch, group, section, subjects, toppers, weak subjects, grade spread) and per year; results and report cards of LOCKED exams in the portal. 151 e2e and 25 unit tests pass.
- **2026-11-27: admin-issued password reset** (ADR-0036): `POST /users/:id/reset-password` (same reach rule as name / status) and, for an organization's admins, `POST /super-admin/organizations/:id/admins/:userId/reset-password`; the API generates a temporary password, shown once, never logged; the person must change it at the next login, their sessions end and a lockout is lifted. 138 e2e and 17 unit tests pass.
- Update this section at the end of every working session.

## Keep it simple

The code must be easy for a fresher to read and change:
- Follow the NestJS documentation's patterns: `src/modules/<feature>/` with `<feature>.controller.ts`, `<feature>.service.ts`, `dto/`, `<feature>.module.ts`.
- No extra layers (facades, ports, injection tokens, packages) unless the owner asks for them.
- Every file starts with a short comment saying what it is for. Comments explain *why*.
- Build only the features in scope now.

## Non-negotiable rules

1. **Every table that belongs to an organization has `organization_id`** and a row-security policy in its migration (copy the pattern from the first migration). Services filter by `organizationId` and run queries inside `prisma.forOrganization(...)`; `prisma.forAllOrganizations(...)` is only for super admin screens and login.
2. **Every endpoint declares who may call it:** `@Public`, `@LoggedIn`, `@SuperAdminOnly`, `@OrganizationUser` or `@RequirePermission('module.resource.action')`. The AccessGuard refuses endpoints without one.
3. **Every feature ships with an isolation test**: data created in organization A is invisible from organization B.
4. **IDs are UUIDv7. Timestamps are `timestamptz` in UTC.** Time zone, currency and locale come from organization settings.
5. **Schema changes only through Prisma migrations** (`npm run db:migration -- <name>`, then `npm run db:migrate`). Never edit a production database by hand.
6. **Every create, update and delete of business data is written to the audit log** (`AuditService.log`, in the same transaction).
7. **Request bodies are DTO classes with class-validator rules**, so they are checked and documented in Swagger automatically.
8. **Records that belong to a branch store `branch_id`, and services check permissions at that place** (`can`, `reachOf` in `src/common/scope.ts`, ADR-0030). Things above sections (years, structure, subjects, settings) belong to the whole organization. The isolation tests also prove a branch admin can't see or change another branch's records.
9. Don't reuse the previous single-institute product's name anywhere in this repository. "EduPlatform" is a working name until the product is named.

## Naming

- Permissions: `module.resource.action`, lowercase, dot-separated (for example `attendance.record.mark`). The list is in `src/modules/roles/permissions.ts`.
- Database: snake_case tables and columns, plural table names (Prisma `@@map` / `@map`).
- API: `/api/v1/<resource>`, kebab-case paths, JSON bodies in camelCase. Super admin routes under `/api/v1/super-admin/...`.

## Stack

NestJS 11 + TypeScript, PostgreSQL 18 with Prisma 6, JWT login (`@nestjs/jwt`, passport-jwt, bcryptjs), class-validator, `@nestjs/swagger`, Jest. One package, npm. Local PostgreSQL, no Docker for now (ADR-0012).

This is the backend repository. The Next.js web and admin apps live in the separate `eduplatform-frontend` repository (ADR-0013); they call this API over HTTP.
