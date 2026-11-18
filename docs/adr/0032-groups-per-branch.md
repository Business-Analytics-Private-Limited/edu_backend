# ADR-0032: Each branch runs some of the organization's groups

Status: Accepted
Date: 2026-10-13

Extends ADR-0030 (one academic engine; the structure above sections belongs to the organization).

## Context

In an Intermediate organization the groups (MPC, BiPC, CEC, HEC) are switched on once for the whole organization. Branches differ, though: NAD may run MPC and BiPC, Madhurawada only MPC. Until now a branch "ran" a group only implicitly, by having sections under it, and nothing stopped a section being made under a group the branch doesn't offer.

The project owner chose: the organization switches groups on, and **each branch ticks which of those it runs**. Streams stay organization-wide.

## Decision

- **`branch_groups (branch_id, group_code)`**: the groups a branch runs, by code. The same group exists under Junior, Senior and Long Term, so the code covers all of them.
- **Who:** `academic.structure.update` at the branch. The Organization admin sets every branch; a Branch admin sets their own.
- **Sections** at a branch can only be made under a group it runs. A group can't be taken off a branch while the branch has sections under it.
- **Defaults keep things as they were:**
  - existing branches run every group their organization has switched on (migration);
  - a new branch runs every group;
  - a group newly switched on for the organization goes to every branch;
  - a group switched off goes from every branch.
  - Saving the organization's groups again keeps each branch's own choice.
- `GET /academic-structure` returns `branchGroups: { branchId: [codes] }`; `PUT /branches/:id/groups { codes }` sets one branch.
- The screens: **Structure → Groups at each branch** (a grid: branches × groups), and the Sections page offers only the branch's groups and says which they are. The section picker, admission, import and filters already only offer places with sections, so they follow by themselves.

## Consequences

- A branch's offer is explicit and enforced; Branch admins manage their own branch.
- Only groups are per branch, not streams: a branch that runs MPC can use every MPC stream. Per-branch streams can be added later the same way if needed.
- School, Degree and Engineering organizations are unaffected.

## Alternatives considered

- **Keep it implicit** (a branch runs a group once it has a section there): no setup, but no control and no protection against a section in the wrong group.
- **Groups and streams per branch:** more control, but more setup for every branch; not needed now.
