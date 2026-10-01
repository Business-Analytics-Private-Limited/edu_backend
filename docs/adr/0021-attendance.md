# ADR-0021: Attendance — daily records per section, versions instead of overwrites, a correction window

Status: Accepted
Date: 2026-10-02

Builds on ADR-0018 (places), ADR-0019 (academic structure and calendar), ADR-0020 (students and sections). Simplifies docs/modules/attendance.md (written before ADR-0015).

## Context

Teachers mark attendance per section every day; mistakes are fixed the same day; leave letters and disputes change past days. Parents, principals and auditors must be able to trust the history. Biometric devices are planned but not needed first.

## Decision

- **One record per student, day and period** (`attendance_records`; period 0 = whole day). Statuses: present, absent, late, half day, on leave.
- **Never overwrite:** a change creates a new record (`is_current`) pointing to the old one (`corrected_from_id`) with a reason; a partial unique index keeps one current record per student / day / period.
- **Marking** a section's day needs `attendance.record.mark` at the section's campus; the first marking covers every student of the section. Changing **today** needs `mark`; changing a **past** day is a correction: `attendance.record.correct` and a reason.
- **Which days:** only working days (weekly off days and holidays from the Academic calendar are refused), never the future, inside an academic year that isn't closed, and not further back than the institution's **correction window** (`institutions.attendance_correction_days`, default 7; `attendance.policy.update` may go further).
- **"Today"** is the date in the institution's **time zone** (`institutions.time_zone`, default Asia/Kolkata).
- **Percentage:** present and late count fully, half day as half; leave doesn't count against the student.
- Reports and the campus daily overview read the current records; the audit log keeps who marked or corrected, with the reason.

## Consequences

- History is explainable: every change is a version with who, when and why.
- Part 2: period-wise marking (bell schedule, periods 1..n), biometric devices through a separate gateway (raw punches → rules → records), late / half-day rules by time, parents seeing attendance in the portal.
