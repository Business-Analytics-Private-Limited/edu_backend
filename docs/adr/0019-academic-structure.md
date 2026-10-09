# ADR-0019: Academic structure — configurable class levels, classes per campus, batches

Status: Superseded

> Superseded by ADR-0030: the levels come from the organization's type, sections belong to a branch, batches are gone.

Date: 2026-09-30

Refines doc 3 §3.3 (academic structure engine) and docs/modules/academic.md.

## Context

EduPlatform must serve many kinds of institutions from one codebase. One existing customer organizes classes as Branch → Type → Group → Stream → Section and, separately, groups students in batches with a stage (Junior, Senior, Long term, Outgoing). A typical junior college uses Year → Group → Section; a school uses Class → Section. Hard-coding any one of these would force a rewrite for the next customer. The owner asked for a centralized platform that fits all of them.

## Decision

- **Branch = campus.** A physical location is a campus (already built).
- **Class levels are data, per institution** (`class_levels`, 1–6 levels, top to bottom). A new institution gets defaults by type (`src/modules/academic/default-levels.ts`); it can rename them any time and change their number while it has no classes. The last level is where students are placed ("section").
- **Classes are a tree per campus** (`classes`: parent, level, name, code). A class sits one level below its parent; nothing below the last level; codes unique among siblings; a class with children can't be deleted; `isActive` keeps history.
- **Academic years per institution** (`academic_years`), no overlapping dates, at most one ACTIVE (enforced by a partial unique index too); activating a year closes the previous one; only PLANNED years can be deleted.
- **Batches per institution** (`batches`): students who joined together, with a `stage` in the institution's own words and an ACTIVE / COMPLETED status. Promotion (Students module) moves batches on.
- **Places** (ADR-0018): years, levels and batches are managed for the institution; classes at their campus. People working at one campus may view their institution's years, levels and batches (`canSomewhereIn`).
- **Module switch:** all of it works only when the Academic module is on (`academic.*` permissions).
- **Predefined roles** that change defaults can be reset by the super admin to EduPlatform's starting permissions (`POST /super-admin/predefined-roles/:key/reset`), because saved role permissions are never overwritten automatically.

## Consequences

- Each customer's structure is configuration, not code: the existing customer sets levels Type → Group → Stream → Section; others keep the defaults.
- Students, attendance and exams only need to know "a student is in a class (last level) of a campus, in a batch, in an academic year".
- Part 2 (2026-10-01): **subjects** per institution, attached to classes at any level and inherited downwards (`class_subjects`); **calendar** with weekly off days per institution and holidays for an institution or one campus.
- Later in this module: batch sections if a customer needs groupings that differ from class sections, and a "copy structure from another campus" helper.
