# Event payload schemas

One JSON Schema per event type and version: `<type>.v<n>.schema.json`, for example
`students.student.admitted.v1.schema.json`. The envelope is defined in `src/events.ts` (CloudEvents 1.0, ADR-0006).

Rules:

- Add the schema **before** the producing code (CLAUDE.md rule 7).
- A breaking change creates a new version file; both versions are published during the transition.
- Payloads carry ids and the fields consumers need, never more personal data than necessary.
