# Module: imports

> **Status: design, not built yet.** Written before the backend was simplified; the purpose, data and rules still apply, the technical details (schemas, paths, `.manage` permissions, events) will follow today's conventions when it is built. See [README.md](README.md#reading-the-design-documents).

| | |
|---|---|
| Schema | `imports` |
| Phase | 4 (student CSV import, needed by the Phase 4 exit check), 7 (templates for onboarding, mappings from existing systems) |
| Depends on | students, academic, identity, files |
| Code | `services/imports/`, jobs in `apps/worker/` |

## Purpose

Brings data from files (CSV / Excel, or exports of an organization's previous system) into the platform through each module's public facade, with validation, a dry-run preview and a per-row error report (ADR-0007).

## Responsibilities

- Downloadable templates per import kind.
- Upload, column mapping, validation (dry run), commit, cancel.
- Row-level results and a downloadable error report.

Not this module: business rules for the data. Every row goes through the owning module's facade (e.g. `StudentsFacade.admitFromImport`), so imports can't bypass validation or audit.

## Manifest

- Variants: `csv`, `excel`.
- Settings: `duplicateStrategy` default (`skip` or `update`), `rowRetentionDays` (default 30).
- Limits: `rows.maxPerJob` (default 10,000).

## Permissions

| Permission | Allows |
|---|---|
| `imports.job.view` | See jobs and their results |
| Kind-specific permission | Required to create and commit a job of that kind, e.g. `students.student.import` for `students` |

## Data model

```
imports.jobs                                                                                 [std]
  id, tenant_id, branch_id
  kind            text check (students | guardians | enrolments | device_mappings)
  template_version text not null
  file_id         uuid not null
  mode            text check (dry_run | commit)
  duplicate_strategy text check (skip | update)
  mapping         jsonb not null default '{}'    source column → target field
  status          text check (uploaded | validating | validated | importing | completed | failed | cancelled)
  total_rows      integer
  valid_rows      integer
  error_rows      integer
  imported_rows   integer
  started_at      timestamptz
  finished_at     timestamptz

imports.job_rows
  id, tenant_id
  job_id          uuid not null         fk (tenant_id, job_id) → jobs
  row_no          integer not null      unique (tenant_id, job_id, row_no)
  raw             jsonb  [P]
  normalized      jsonb  [P]
  status          text check (valid | error | imported | skipped)
  errors          jsonb                 [{ field, code, message }]
  entity_id       uuid
```

`raw` and `normalized` are cleared `rowRetentionDays` after a job finishes.

## API

| Method | Path | operationId | Permission | Description |
|---|---|---|---|---|
| GET | `/imports/templates` | `imports.template.list` | `imports.job.view` | Available kinds, columns, rules |
| GET | `/imports/templates/{kind}/download` | `imports.template.download` | `imports.job.view` | CSV or Excel template with an example row |
| POST | `/imports/jobs/upload-url` | `imports.job.upload_url` | kind permission | Signed upload URL |
| POST | `/imports/jobs` | `imports.job.create` | kind permission | Create a job from the uploaded file |
| GET | `/imports/jobs` | `imports.job.list` | `imports.job.view` | Jobs |
| GET | `/imports/jobs/{jobId}` | `imports.job.get` | `imports.job.view` | Status and counts |
| PUT | `/imports/jobs/{jobId}/mapping` | `imports.job.set_mapping` | kind permission | Column mapping |
| POST | `/imports/jobs/{jobId}/validate` | `imports.job.validate` | kind permission | Dry run (202) |
| GET | `/imports/jobs/{jobId}/rows` | `imports.job.rows` | `imports.job.view` | `?status=error` |
| GET | `/imports/jobs/{jobId}/error-report` | `imports.job.error_report` | `imports.job.view` | CSV of failed rows with reasons |
| POST | `/imports/jobs/{jobId}/commit` | `imports.job.commit` | kind permission | Import valid rows (202) |
| POST | `/imports/jobs/{jobId}/cancel` | `imports.job.cancel` | kind permission | Cancel before or during commit |

## Events

Published: `imports.job.completed` (`jobId, kind, importedRows, errorRows`).

## Public facade

None.

## Business rules

1. Commit only after a successful validation of the same file and mapping.
2. Each row commits in its own transaction through the owning facade; a failing row doesn't stop the job.
3. Duplicates are detected by the kind's natural key (e.g. admission number for students) and skipped or updated per `duplicate_strategy`.
4. Performance target: 5,000 students in under 2 minutes (doc 1 §1.6).

## Tests

- A 1,000-row file with 10 bad rows imports 990 and reports the 10 with reasons (Phase 4 exit check).
- Re-running the same file with `skip` imports nothing new.
- Formula-like cells (`=HYPERLINK(...)`) are stored as text, and escaped in the error report.

## Open questions

- The mapping from the first organization's current system is written when that onboarding is planned (ADR-0007).
