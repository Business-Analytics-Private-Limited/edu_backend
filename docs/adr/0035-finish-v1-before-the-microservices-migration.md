# ADR-0035: Finish v1 in today's backend before the microservices migration

Status: Accepted
Date: 2026-11-27

Accepts ADR-0024 (microservices and tenant sharding) as the target, and sets when it starts. Changes one part of ADR-0024: password reset is built now, in today's backend, instead of in M2.

## Context

ADR-0024 planned to move to microservices and tenant shards right after Phase 6, starting with M0 (Docker, gateway, logging). Since then the product grew a lot inside the single backend (ADR-0030 to ADR-0034), but the v1 definition of done (doc 1, section 1.8) still needs:

- period-wise attendance (the `attendance_records.period` column exists; today it's always 0, the whole day);
- biometric attendance (devices, punches, rules for late / half day);
- password reset (ADR-0024 placed it in M2, so it would wait for the Identity service);
- the importer and a pilot with the first institution (Phase 7).

No organization uses EduPlatform yet. M0 to M2 slow feature work for several weeks (ADR-0024, Consequences), and the load test in M1 is more useful with a real organization's numbers.

## Decision

1. **ADR-0024 is accepted as the direction.** No new code may make the split harder: features stay in their own `src/modules/<feature>/`, and modules don't read each other's tables in new code without a good reason written in a comment.
2. **Order of work:**
   1. Password reset (an admin sets a temporary password; "forgot password" by email when a mail provider is chosen).
   2. Period-wise attendance (Phase 5, part 2).
   3. Biometric attendance (Phase 5, part 3), once the first institutions' device models are known.
   4. Importer and pilot (Phase 7).
   5. Then the migration, M0 onwards, as ADR-0024 describes.
3. **ADR-0012 and ADR-0015 stay in force until M0 starts.** They are superseded by ADR-0024 at that point, not today.

## Consequences

- v1 can be finished and piloted without Docker or a gateway.
- Password reset is written once in today's `auth` / `users` modules, and moves to the Identity service in M2 with the rest of them.
- The migration starts later, with real usage numbers from the pilot for M1's load test.
- Until M1, every organization's data is still in one database, which the owner wanted to avoid. That's acceptable while there's no live customer.

## Alternatives considered

- **Start M0 now (ADR-0024 as written).** Rejected for now: no customer is waiting on the split, and v1 features would wait for several weeks.
- **Reject ADR-0024 and stay one backend.** Rejected: the owner wants no single database holding every organization (ADR-0024, Context).
