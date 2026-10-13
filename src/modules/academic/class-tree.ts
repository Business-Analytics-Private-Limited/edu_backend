/**
 * The organization's academic structure as an in-memory tree, for labels and lookups that many
 * modules need (students, attendance, promotion, import, portal):
 *
 *   const tree = await ClassTree.load(db, organizationId);
 *   tree.label(sectionId)          "Junior (1st Year) › MPC › JEE Mains › JEE-A" (B.Com › 1st Year
 *                                  › A for a course without specializations, ADR-0033)
 *   tree.path(sectionId)           [Junior, MPC, JEE Mains, JEE-A]
 *   tree.below(classId)            the class and every class under it, in every branch
 *
 * The structure is small (tens to a few hundred classes), so loading it whole is simpler and
 * faster than walking the tree with one query per step.
 */
import type { Class } from '@prisma/client';
import type { Db } from '../../prisma/prisma.service';

export class ClassTree {
  private readonly byId: Map<string, Class>;
  private readonly childrenOf = new Map<string, Class[]>();

  constructor(readonly classes: Class[]) {
    this.byId = new Map(classes.map((c) => [c.id, c]));
    for (const c of classes) {
      if (!c.parentId) continue;
      this.childrenOf.set(c.parentId, [...(this.childrenOf.get(c.parentId) ?? []), c]);
    }
  }

  static async load(db: Db, organizationId: string): Promise<ClassTree> {
    return new ClassTree(await db.class.findMany({ where: { organizationId } }));
  }

  get(id: string): Class | undefined {
    return this.byId.get(id);
  }

  /** From the top level down to the class itself. */
  path(id: string): Class[] {
    const c = this.byId.get(id);
    return c ? [...(c.parentId ? this.path(c.parentId) : []), c] : [];
  }

  /** The class's name with the names above it; the hidden "whole course" level is left out. */
  label(id: string): string {
    return this.path(id)
      .filter((c) => !c.placeholder)
      .map((c) => c.name)
      .join(' › ');
  }

  /** The class's children, in display order. */
  children(id: string): Class[] {
    return [...(this.childrenOf.get(id) ?? [])].sort(byOrder);
  }

  /** The class and every class below it (e.g. "MPC" -> its streams and all their sections). */
  below(id: string): string[] {
    return [id, ...this.children(id).flatMap((c) => this.below(c.id))];
  }

  /** The ancestor of a class at a level (1 = top), or the class itself if it is at that level. */
  atLevel(id: string, level: number): Class | undefined {
    return this.path(id).find((c) => c.level === level);
  }
}

/** Display order: sortOrder, then name. */
export function byOrder(
  a: { sortOrder: number; name: string },
  b: { sortOrder: number; name: string },
) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}
