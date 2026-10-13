# ADR-0033: Courses without specializations; editing and deleting courses

Status: Accepted
Date: 2026-10-14

Extends ADR-0030 (Degree / Engineering: Course → Specialization → Year → Section).

## Context

The project owner found the Degree / Engineering setup confusing:

- Many courses have **no specializations** (B.Com, BBA), yet the structure always has four levels. A course added alone got no years, so nothing could be placed in it (the screen promised a "General" specialization that was never made).
- Courses and specializations could not be **edited or deleted** on screen.
- They were shown only as a tree; the owner wanted a **table** to manage them.

## Decision

1. **A course either has its own years, or specializations with theirs.** "Add course" asks *Specializations? No / Yes*. With **No** the course gets its years straight away (1st … Nth Year).
2. Behind the scenes, such a course keeps the four levels through a hidden **"whole course" level** (`classes.placeholder = true`, code `ALL`). It is **never shown**: names read "B.Com › 1st Year › A" (`ClassTree.label`), the section picker chooses it by itself, and the tree and filters skip it. One engine, no special cases for promotion, attendance, import or reports.
3. **Adding a specialization** to a course with its own years removes those years while they have no sections. With sections they stay, shown as "Whole course".
4. **Editing** (`PATCH /academic-structure/programmes/:id`): name, code, and years. More years are added at the end and linked for promotion. Fewer years remove the last years only while they are empty. A course's years can be changed only while it has no specializations.
5. **Deleting** (`DELETE /academic-structure/programmes/:id`): a course or specialization with its years and their subject links, only while nothing under it has sections.
6. `GET /academic-structure` returns `sectionCounts` (sections under each class) for the screens.
7. The web app shows **a table** (Course, Specialization, Years, Sections, Actions), with Add course, Edit and Add specialization in a slide-in panel, and Delete with a confirmation.

## Consequences

- B.Com-like courses work in two clicks; nothing else in the system needed to change.
- Year names are fixed (1st Year …); a course's years always move on to the next, and the last completes. "After each year" can still change that.

## Alternatives considered

- **A variable number of levels per course:** every screen and report would need to handle both shapes; the hidden level keeps one shape.
- **A visible "General" specialization:** it works, but it's what confused the owner in the first place.
