# ADR-0034: Promote chosen students or a whole section; add a missing next-year section from the promotion page

Status: Accepted
Date: 2026-11-10

Changes promotion in ADR-0030 (section 5 said "for all students at once"; section 6, the suggested target). Shuffle stays as ADR-0030 says: one student at a time, from the profile.

## Context

- The project owner asked for two separate things:
  - **Promote:** from one year to the next, a whole section at once or several students chosen by their profiles;
  - **Shuffle:** one student to another section or branch, from the student's page.
- At Ascent's Aslimetta branch, the next year (Senior) had no sections yet. Every card on the promotion page said "choose" and listed only Junior sections, and the form could not be sent. Nothing told the user to add the Senior sections first, on another page.
- A promoted student's old placement had no end date, so the timeline showed last year's placement as never ending.

## Decision

1. **A whole section, or only the chosen students.**
   - In the request, each section can carry `studentIds`; only those students move.
   - The others stay in the old year and can be promoted later.
   - On the page, all students are ticked at first.
2. **The targets are grouped by year.** The next year comes first, then the same year (to repeat it), then any others. **Complete** comes last.
3. **A missing next-year section can be added from the promotion page.**
   - The preview returns `nextPlace`: where the matching section would go (the next year's node, then the same codes below it).
   - The card offers **Add section**, pre-filled with the same name and code. Once added, it is the suggestion.
   - It uses the same API and permission as Academic → Sections (`academic.structure.create` at the branch). Users without that permission are told to ask someone who has it.
4. **The old placement ends** on the last day of the "from" year (or the day it began, if that is later). An undo makes it current again.
5. **Keeping roll numbers is a wish, not a rule.** A roll number already taken in the new section is left empty, instead of failing the whole promotion. Anywhere else, a clash says who has the number.

## Consequences

- A branch can be promoted in parts, for example holding back a few students. Each part is its own promotion record, and each can be undone.
- The promotion page can create sections, but with no new API or permission: it calls `POST /branches/:id/sections`.
- The old year's attendance registers still show promoted students for that year's dates, because registers follow each placement's dates.

## Alternatives considered

- **Add sections only in Academic → Sections:** rejected. Users got stuck on the promotion page with no hint.
- **Promote the whole branch only:** rejected by the owner, who needs to hold students back.
- **Create next-year sections automatically during promotion:** rejected. Sections are an admin's decision (names, codes), and an automatic copy would hide mistakes in the structure.
