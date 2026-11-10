# Module: attendance (daily attendance per section, corrections, reports)

| | |
|---|---|
| Status | **Built (part 1):** daily marking per section, same-day changes, corrections with reasons, correction window, branch daily overview, section and student reports, settings. **Part 2 (design):** period-wise marking, biometric devices, late / half-day rules by time |
| Code | `src/modules/attendance/` |
| Tables | `attendance_records`; `organizations.time_zone`, `organizations.attendance_correction_days` |
| Decisions | ADR-0021 (and ADR-0018 places, ADR-0019 calendar, ADR-0020 sections) |
| Switched on by | the super admin, per organization (module key `attendance`, needs `academic` and `students`) |

## In plain words

- A teacher opens a **section's register** for a day: every student, in roll number order, Present / Absent / Late / Half day / On leave, with an optional remark. Present is pre-selected.
- Mistakes are fixed **the same day** freely. Changing a **past** day is a **correction**: it needs the correct permission and a **reason**, and only within the organization's **correction window** (7 days by default).
- Nothing is overwritten: each change is a new version; the old one is kept.
- Only **working days**: not a weekly off day, not a holiday (Academic → Calendar), not in the future, inside the academic year.
- **A section's register on a day** = the students whose placement in that section covers that day: a student who changed section on 15 July is in the old register until 14 July (ADR-0030).
- **Moved on a day that was already marked:** the student keeps the mark from the old section. The new section's register shows it ("already marked in …"), and saving that register moves the record there as a new version. That alone is no correction; changing the status on a past day is.
- **Today's overview** per branch shows which sections are marked; **reports** give each student's counts and percentage over any period.

## Endpoints (`/api/v1`)

| Method | Path | Permission (at the section's / student's branch) |
|---|---|---|
| GET | `/attendance/roster?classId=&date=` | `attendance.record.view` — students, current status, whether the day can be marked (`blocked`) |
| POST | `/attendance/markings` | `attendance.record.mark` (+ `attendance.record.correct` and `reason` for a past day) — `{ classId, date, entries: [{ studentId, status, remark? }], reason? }` |
| GET | `/attendance/daily-summary?branchId=&date=` | `attendance.record.view` — each section: students, marked, counts |
| GET | `/attendance/section-report?classId=&from=&to=` | `attendance.report.view` — per student counts and %; working / marked / unmarked days |
| GET | `/students/:id/attendance?from=&to=` | `attendance.record.view` — counts, %, day by day |
| PUT | `/organization/attendance-settings` | `attendance.policy.update` for the whole organization — `{ timeZone?, correctionDays? }` |

## Rules (tested in `test/attendance.e2e-spec.ts`)

1. Nothing works unless the organization has the Attendance module.
2. The first marking of a day covers every student of the section.
3. Same-day changes: `mark`. Past days: `correct` + reason. Older than the correction window: refused (unless `attendance.policy.update`).
4. Only working days; never the future; inside an academic year that isn't closed.
5. One current record per student, day and period (also a database index); changes are versions. A student moved to another section that day keeps their record: the new register shows it (`markedIn`) and takes it over when saved.
6. Percentage = (present + late + ½ half day) ÷ (present + late + half day + absent); leave doesn't count.
7. Teachers and branch admins work only at their own branch; another organization sees nothing.

## Screens (web app → Attendance)

Attendance (a branch's day: sections marked / not marked, counts, previous / next day) · a section's register (mark, change, correction reason) · Reports (section over a period, % below 75 in red) · Attendance settings (time zone, correction window) · on a student's page: the last 30 days.

## Part 2 (design)

- **Period-wise marking:** a bell schedule per organization; records with period 1..n; the day's status derived from the periods.
- **Biometric devices:** a separate gateway receives punches (e.g. ZKTeco "iclock" protocol), keeps them as raw events, maps device user ids to students / staff, and rules turn them into records (late after a time, half day under a minimum). Unknown punches wait in an "unmapped" list. The earlier full design is in git history of this file (before 2026-10-02).
- **Parent portal:** parents see their children's attendance.
