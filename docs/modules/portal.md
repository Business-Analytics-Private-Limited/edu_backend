# Module: portal

> **Status: design, not built yet.** Written before the backend was simplified; the purpose, data and rules still apply, the technical details (schemas, paths, `.manage` permissions, events) will follow today's conventions when it is built. See [README.md](README.md#reading-the-design-documents).

| | |
|---|---|
| Schema | none (reads through other modules' facades) |
| Phase | 6 |
| Depends on | students; attendance for the attendance views |
| Code | `services/portal/`, `eduplatform-frontend/apps/web/src/modules/portal/` |

## Purpose

What parents and students see after they log in: their children (or themselves), profile and attendance. Later: results, fees, timetable.

## Responsibilities

- Read-only endpoints shaped for the portal screens.
- The child switcher for a parent with several children, possibly in different institutions of the same organization.

Not this module: creating parent or student logins (`students` grants portal access; `identity` creates the account).

## Manifest

- Variants: `parent_login`, `student_login` (each can be switched on separately).
- Settings (institution level): `sections`: which sections are visible (`profile`, `attendance`; later `results`, `fees`).

## Permissions

Uses `students.student.view`, `students.document.view` and `attendance.record.view`, always at `guardian` or `self` scope (doc 4 §4.6).

## Data model

None. It stores nothing.

## API

| Method | Path | operationId | Permission | Description |
|---|---|---|---|---|
| GET | `/portal/children` | `portal.child.list` | `students.student.view` | The guardian's linked children, or the student themself; with institution and current section |
| GET | `/portal/children/{studentId}/profile` | `portal.child.profile` | `students.student.view` | Profile fields the institution allows |
| GET | `/portal/children/{studentId}/attendance` | `portal.child.attendance` | `attendance.record.view` | Day-by-day records for `?from&to` |
| GET | `/portal/children/{studentId}/attendance/summary` | `portal.child.attendance_summary` | `attendance.record.view` | Percentage for the current month and year |
| GET | `/portal/children/{studentId}/documents` | `portal.child.documents` | `students.document.view` | Documents list and download links |

## Events

None.

## Public facade

None.

## Business rules

1. `studentId` must be in the user's `guardian` or `self` scope; otherwise `404`.
2. Only sections enabled in the institution's settings are returned; attendance views also need the attendance module enabled.
3. A parent's children in two institutions are both listed, each shown with its own institution's settings.

## Tests

- The phase 6 exit check: a parent with children in two institutions sees both, and requesting any other student id returns 404.
- With `sections` excluding attendance, the attendance endpoints return `403 module_not_enabled`.

## Open questions

- None.
