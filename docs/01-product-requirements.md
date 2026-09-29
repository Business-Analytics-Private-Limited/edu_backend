# 1. Product requirements

## 1.1 Problem

Institutions run on disconnected spreadsheets or single-institute software that can't adapt to how each one works. For example, one institute takes attendance by hand and another uses biometric devices. Groups that run several institutions (a junior college, a degree college and a school under one society or trust) end up with separate systems and separate logins.

## 1.2 Product goal

One platform, operated by us, that:

- serves many organizations with strict data isolation between them;
- lets the platform super admin decide which modules and tool variants each organization gets;
- lets each organization adapt the enabled modules to its own process (academic structure, attendance method, roles);
- gives staff, parents and students their own access, limited to what they are allowed to see.

## 1.3 Personas

| Persona | Level | Main goals |
|---|---|---|
| **Platform super admin** | Platform (us) | Onboard organizations, assign plans, modules and variants, set limits, support and impersonate (audited), monitor usage |
| **Organization admin** (chairman / correspondent / group IT) | Organization | Manage institutions and campuses, organization-wide roles, cross-institution reports |
| **Institution admin** (principal / dean / office admin) | Institution | Academic structure, admissions, staff accounts, module settings, reports |
| **Teacher / lecturer** | Assigned sections or subjects | Mark attendance, view class lists, later enter marks |
| **Accountant** (v2) | Institution or campus | Fees, receipts, dues |
| **Parent** | Own children, possibly in different institutions of the same organization | View profile, attendance, later results and fees |
| **Student** | Self | View own profile, attendance, later results, timetable, fees |

## 1.4 Institution types (priority order)

| Priority | Type | Academic shape |
|---|---|---|
| 1 | Junior / intermediate college | Academic year → Year (1st / 2nd) → Group (MPC, BiPC, CEC, MEC, HEC …) → Section; batch and student categories (day scholar / residential, regular / long-term) |
| 2 | Degree and engineering college | Program (B.Tech, B.Sc, B.Com …) → Branch / specialization → Semester → Section; credits, electives, CGPA |
| 3 | School | Class (Nursery–10) → Section |

These are handled by **academic structure templates** (see [doc 3](03-tenancy-and-academic-structure.md)), not by separate code.

## 1.5 Release scope

### v1: foundation and core

| Area | Included |
|---|---|
| Platform | Super admin console; organizations, institutions, campuses; plans; module and variant entitlements; limits (students, campuses); feature flags; impersonation with audit |
| Identity and access | Login (Keycloak, OIDC), MFA for admins, password reset; tenant-defined roles from templates; scoped role assignment; audit log |
| Academic | Structure engine with the **junior college template**; academic years; subjects (basic); section/batch management |
| Students | Admission (single + bulk CSV import), profile with documents and photo, guardian links, categories, promote / shuffle between sections, status (active, transferred, discontinued, alumni) |
| Attendance | **Manual** (daily or period-wise per institution setting) and **biometric** (device registry, punch ingestion, rules for late / half-day, exceptions and corrections); reports |
| Portal | Parent and student login; view profile and attendance; parent with several children switches between them |
| Import | Tenant onboarding importer (CSV/Excel templates) for institutions moving from other systems |

### v2

Exams and results (grading schemes, marks entry, report cards) · Fees (structures, concessions, collection, receipts, dues; cash + one online gateway) · Staff / HR basics (profiles, departments, staff attendance using the same attendance module) · Notifications (SMS, WhatsApp, email, templates, credits) · Timetable.

### v3

Degree / engineering template (semesters, credits, electives, CGPA) · School template · Transport · Library · Hostel · Payroll · Mobile app · Analytics dashboards · Online admissions with payment.

## 1.6 Non-functional requirements

| Requirement | Target |
|---|---|
| Tenant isolation | Enforced by the database (Row-Level Security) **and** the application; covered by automated tests for every module |
| Security | OWASP ASVS level 2 as the reference; MFA for admin roles; all admin actions audited; secrets never in code |
| Privacy | India DPDP Act 2023: consent capture for minors via guardians, data minimization, export and deletion on request, retention rules per tenant |
| Availability | 99.5% in v1 on single-region hosting; architecture must allow multi-zone later |
| Performance | p95 < 300 ms for normal API calls at 100 concurrent users per tenant; bulk import of 5,000 students < 2 minutes |
| Scale path | Pooled tenants on shared databases; a large tenant can move to a dedicated database with no code change |
| Localization | English first; UI strings externalized for Telugu / Hindi later; time zone, currency and date format per institution |
| Backups | Daily full + point-in-time recovery; per-tenant export on demand |
| Observability | Structured logs, traces and metrics tagged with `tenant_id`; error alerts |
| Maintainability | Modules extractable to separate services without a rewrite; ADRs for every significant decision |

## 1.7 Out of scope for v1

Payments of any kind · SMS/WhatsApp sending · mobile apps · LMS / online classes · custom domains per tenant · billing of tenants (the super admin assigns plans manually).

## 1.8 Definition of done for v1

A super admin onboards a junior-college organization with two campuses. The organization's admin imports 1,000 students from CSV and configures manual attendance for one campus and biometric for the other. A teacher marks attendance. A biometric device's punches appear as attendance. A parent logs in and sees their child's attendance. Tests prove that a second organization sees none of this data.
