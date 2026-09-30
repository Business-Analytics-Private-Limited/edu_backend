# Module: attendance

> **Status: design, not built yet.** Written before the backend was simplified; the purpose, data and rules still apply, the technical details (schemas, paths, `.manage` permissions, events) will follow today's conventions when it is built. See [README.md](README.md#reading-the-design-documents).

| | |
|---|---|
| Schema | `attendance` |
| Phase | 5 |
| Depends on | academic, students, identity |
| Code | `services/attendance/`, `apps/device-gateway/`, rules jobs in `apps/worker/` |

## Purpose

Records who was present, from any source (teacher marking, biometric devices, later RFID, QR or mobile), through one pipeline: raw events → rules → one current record per person per day or period (doc 5 §5.5).

## Responsibilities

- Attendance policies (daily or period-wise, late and half-day rules, correction window), dated so that history stays explainable.
- Manual marking by section.
- Device registry, device user ↔ person mapping, punch ingestion.
- Rules engine that turns raw events into records.
- Corrections with reasons; records are never overwritten.
- Reports: daily summary, section register, person summary.

Not this module: holidays and working days (`academic`), who is in which section (`students`).

## Manifest

- Variants: `manual` (default), `biometric`; `rfid`, `qr`, `mobile_geo` planned. `variantSelection: multiple`.
- Settings (organization / institution / campus): which variants are active at the campus. Rules live in `attendance.policies` (doc 7 decision 3).
- Limits: `devices.max` (default 5).

## Permissions

| Permission | Allows |
|---|---|
| `attendance.record.view` | View records within scope |
| `attendance.record.mark` | Mark attendance for sections in scope |
| `attendance.record.correct` | Correct records within the correction window |
| `attendance.policy.manage` | Manage policies and period definitions |
| `attendance.device.manage` | Register devices, rotate secrets, manage mappings, resolve unmapped punches |
| `attendance.report.view` | View reports within scope |

## Data model

```
attendance.policies                                                                          [std]
  id, tenant_id, institution_id
  campus_id       uuid                  null = whole institution
  person_type     text check (student | staff)
  mode            text check (daily | period)
  late_after      time                  institution's local time
  half_day_rule   jsonb                 { "minPresentMinutes": 180 }
  in_out_pairing  jsonb                 { "strategy": "first_in_last_out", "minGapMinutes": 5 }
  correction_window_days smallint not null default 7
  effective_from  date not null
  effective_to    date
  exclude using gist (tenant_id with =, institution_id with =, campus_id with =, person_type with =,
                      daterange(effective_from, effective_to, '[)') with &&)

attendance.period_definitions                                                                [std]
  id, tenant_id
  policy_id       uuid not null         fk (tenant_id, policy_id) → policies
  period_no       smallint not null     unique (tenant_id, policy_id, period_no)
  name            text
  starts_at       time not null
  ends_at         time not null

attendance.devices                                                                           [std][sd]
  id, tenant_id, institution_id, campus_id
  serial_no       text not null         unique (serial_no) where deleted_at is null   -- across all tenants
  vendor          text not null         'zkteco', 'essl'
  model           text
  name            text not null
  location        text
  direction       text check (in | out | both)
  secret_hash     text                  argon2id; used when the device or sync agent can send a secret
  allowed_ips     cidr[]                optional source address allowlist
  status          text check (active | disabled)
  last_seen_at    timestamptz
  last_seen_ip    inet

attendance.device_person_mappings                                                            [std]
  id, tenant_id, campus_id
  device_id       uuid                  null = every device on the campus
  device_user_id  text not null         the id enrolled on the device
  person_type     text check (student | staff)
  person_id       uuid not null
  valid_from      date not null
  valid_to        date
  unique nulls not distinct (tenant_id, campus_id, device_id, device_user_id) where valid_to is null

attendance.raw_events                   immutable; partitioned monthly on occurred_at
  id              uuid not null
  tenant_id       uuid not null
  occurred_at     timestamptz not null
  received_at     timestamptz not null default now()
  source          text check (manual | biometric | rfid | qr | mobile_geo | import)
  device_id       uuid
  device_user_id  text
  person_type     text
  person_id       uuid                  null until mapped
  payload         jsonb not null
  dedupe_key      text not null         rejects replayed punches
  processing_status text check (pending | applied | unmapped | ignored)
  processed_at    timestamptz
  primary key (id, occurred_at)
  unique (tenant_id, dedupe_key, occurred_at)

attendance.records                      partitioned monthly on attendance_date
  id              uuid not null
  tenant_id       uuid not null
  institution_id  uuid not null
  campus_id       uuid not null
  person_type     text not null
  person_id       uuid not null
  academic_year_id uuid
  node_id         uuid                  section at the time (snapshot)
  attendance_date date not null
  period_no       smallint not null default 0     0 = whole day
  status          text check (present | absent | late | half_day | on_leave | excused | holiday)
  source          text not null
  first_in_at     timestamptz
  last_out_at     timestamptz
  minutes_late    smallint
  policy_id       uuid
  marked_by       uuid
  marked_at       timestamptz not null
  is_current      boolean not null default true
  corrected_from_id uuid
  correction_reason text
  primary key (id, attendance_date)
  unique (tenant_id, person_id, attendance_date, period_no) where is_current
  index (tenant_id, node_id, attendance_date) where is_current

attendance.person_directory             projection from students events; not the source of truth
  tenant_id, person_type, person_id
  display_name    text  [P]
  code            text                  admission number
  institution_id, campus_id, node_id uuid
  node_ancestor_ids uuid[]
  academic_year_id uuid
  status          text
  primary key (tenant_id, person_type, person_id)
```

`attendance.resolve_device(serial text)`: security-definer function; returns `tenant_id, device_id, campus_id, secret_hash, allowed_ips, status` for one serial. Only `edu_gateway` may execute it.

## API

| Method | Path | operationId | Permission | Description |
|---|---|---|---|---|
| GET | `/attendance/policies` | `attendance.policy.list` | `attendance.record.view` | `?institutionId&campusId&onDate` |
| POST | `/attendance/policies` | `attendance.policy.create` | `attendance.policy.manage` | New policy from a date; closes the previous one |
| GET | `/attendance/policies/{policyId}` | `attendance.policy.get` | `attendance.record.view` | With period definitions |
| PUT | `/attendance/policies/{policyId}/periods` | `attendance.period.put` | `attendance.policy.manage` | Bell schedule |
| GET | `/attendance/rosters` | `attendance.roster.get` | `attendance.record.mark` | Students of `?nodeId&date&periodNo` with their current status |
| POST | `/attendance/markings` | `attendance.record.mark` | `attendance.record.mark` | Mark a section: `{ nodeId, date, periodNo, entries: [{ personId, status }] }` (`Idempotency-Key`) |
| GET | `/attendance/records` | `attendance.record.list` | `attendance.record.view` | `?personId&nodeId&from&to&status` |
| POST | `/attendance/records/{recordId}/corrections` | `attendance.record.correct` | `attendance.record.correct` | `{ status, reason }`; creates a new version |
| GET | `/attendance/records/{recordId}/history` | `attendance.record.history` | `attendance.record.view` | All versions |
| GET | `/attendance/devices` | `attendance.device.list` | `attendance.device.manage` | Devices with last-seen |
| POST | `/attendance/devices` | `attendance.device.create` | `attendance.device.manage` | Register; returns the secret once |
| PATCH | `/attendance/devices/{deviceId}` | `attendance.device.update` | `attendance.device.manage` | Edit, disable |
| POST | `/attendance/devices/{deviceId}/rotate-secret` | `attendance.device.rotate_secret` | `attendance.device.manage` | New secret, returned once |
| DELETE | `/attendance/devices/{deviceId}` | `attendance.device.delete` | `attendance.device.manage` | Soft delete |
| GET, POST | `/attendance/device-mappings` | `attendance.mapping.list`, `.create` | `attendance.device.manage` | Device user ↔ person |
| DELETE | `/attendance/device-mappings/{mappingId}` | `attendance.mapping.end` | `attendance.device.manage` | Ends the mapping (`valid_to`) |
| GET | `/attendance/raw-events` | `attendance.raw_event.list` | `attendance.device.manage` | `?processingStatus=unmapped&deviceId&from&to` |
| POST | `/attendance/raw-events/reprocess` | `attendance.raw_event.reprocess` | `attendance.device.manage` | Re-run rules after mappings are fixed (202) |
| GET | `/attendance/reports/daily-summary` | `attendance.report.daily_summary` | `attendance.report.view` | Present / absent / late counts by section for `?campusId&date` |
| GET | `/attendance/reports/section-register` | `attendance.report.section_register` | `attendance.report.view` | Month grid for `?nodeId&month` |
| GET | `/attendance/reports/person-summary` | `attendance.report.person_summary` | `attendance.record.view` | Percentage and day list for `?personId&from&to` |
| POST | `/attendance/reports/exports` | `attendance.report.export` | `attendance.report.view` | Export any report (202) |

### Device gateway (`apps/device-gateway`, not under `/api/v1`)

Vendor push protocol (ZKTeco / eSSL "ADMS" style), documented in `device-gateway.yaml`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/iclock/cdata?SN=...` | Device handshake; returns configuration |
| POST | `/iclock/cdata?SN=...&table=ATTLOG` | Punch upload; lines of `userId, time, status, verify` |
| GET | `/iclock/getrequest?SN=...` | Device polls for commands |

## Events

Published:

| Type | When | Data |
|---|---|---|
| `attendance.record.marked` | Records created by marking or rules | `recordIds, personIds, date, periodNo, nodeId, source` (batched per section / run) |
| `attendance.record.corrected` | Correction | `recordId, previousRecordId, personId, date, from, to, reason` |
| `attendance.device.registered` | Device registered | `deviceId, campusId, serialNo` |

Consumed: `students.student.admitted`, `students.student.updated`, `students.student.status_changed`, `students.enrolment.changed` (update `person_directory`); `academic.calendar.changed` (re-evaluate `holiday` records).

## Public facade

```ts
interface AttendanceFacade {
  personSummary(personId, from, to): Promise<{ workingDays; present; absent; late; percentage }>;
  personRecords(personId, from, to): Promise<RecordView[]>;
}
```

## Business rules

1. Every source writes a raw event first. Manual marking runs the rules in the same transaction; device punches are processed by the worker.
2. Corrections never overwrite: the old record gets `is_current = false`, a new record points to it, a reason is required, and the change is audited. Allowed only within the policy's `correction_window_days` unless the user also has `attendance.policy.manage`.
3. Records keep their `source` forever, even after a campus switches variant.
4. Marking on a non-working day is rejected unless the day is overridden as `working_day`.
5. The gateway identifies the tenant from the device serial; unknown or disabled serials get an error and the punch is not stored. Punches for unmapped device users are stored as `unmapped` and appear in the resolution screen.
6. Duplicate punches (same device, user, time) are ignored by `dedupe_key`.

## Tests

- Teacher of section A marks 60 students; a second submission with the same `Idempotency-Key` changes nothing.
- A simulated device posts 1,000 punches; records appear with correct late flags for the campus policy.
- A correction produces two versions, one current, and an audit entry with the reason.
- A punch from a serial registered to tenant A never becomes visible in tenant B.

## Open questions

- **Device authentication:** many ADMS-style devices send only their serial number, not a secret. Then protection relies on registered serials, optional IP allowlists and anomaly checks; the on-premise sync agent can add proper authentication. Decide with the device brands (Phase 5 open decision).
