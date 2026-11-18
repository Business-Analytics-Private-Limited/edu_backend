/**
 * THE ACADEMIC STRUCTURE (ADR-0030): one tree of classes per organization, following the levels
 * of its type (presets.ts):
 *
 *   School         Class 8 -> Section A
 *   Intermediate   Junior -> MPC -> JEE Mains -> JEE-A
 *   Degree / Eng.  B.Tech -> CSE -> 1st Year -> Section A
 *
 * Everything above Section belongs to the WHOLE ORGANIZATION and is managed with
 * "academic.structure.*" for the whole organization. SECTIONS belong to a branch and are managed
 * at that branch (a Branch admin builds the sections of their branch).
 *
 * How each type is built:
 *   - School: tick the built-in classes (Nursery ... Class 10) the organization runs
 *     (setSchoolClasses); each class's "next" is the next ticked one.
 *   - Intermediate: Junior, Senior and Long Term always exist (ensurePresets). Switch groups on
 *     (setGroups): each gets the built-in stream "Regular (IPE)" under Junior and Senior. Add
 *     the organization's own streams to a group (addStream): under Junior and Senior, or, for a
 *     long-term stream, under Long Term.
 *   - Degree / Engineering: add courses (addCourse) and their specializations with the number
 *     of years (addSpecialization): 1st Year -> 2nd Year -> ... -> the final year. A course
 *     WITHOUT specializations gives its own years and gets a hidden "whole course" level
 *     (ADR-0033: B.Com › 1st Year). Courses and specializations can be edited (name, code,
 *     years) and deleted while nothing has sections under them (updateProgramme,
 *     deleteProgramme).
 *
 * PROGRESSION: year-level classes have a `next` class (promotion moves students there); empty =
 * students complete after that year. The builders set it; updateClass can change it.
 *
 * Rules: codes are unique among siblings (per branch for sections); built-in classes keep their
 * code and are switched off rather than deleted; a class with classes or students under it can't
 * be deleted.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { Class, Organization } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, can, canSomewhere } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertBranchInUse, findBranch, findOrganization } from '../organization/places-in-use';
import { GROUP_LEVEL, groupCodeOf, organizationGroupCodes } from './branch-groups';
import { byOrder, ClassTree } from './class-tree';
import {
  AddCourseDto,
  AddSpecializationDto,
  UpdateProgrammeDto,
  AddStreamDto,
  CreateSectionDto,
  UpdateClassDto,
} from './dto/academic.dto';
import {
  INTERMEDIATE_GROUPS,
  INTERMEDIATE_YEARS,
  PRESETS,
  REGULAR_STREAM,
  SCHOOL_CLASSES,
  sectionLevel,
  yearOfStudy,
} from './presets';

const WHOLE_ORGANIZATION = {};

/**
 * Creates what the organization's type always has (Intermediate: Junior, Senior, Long Term).
 * Safe to repeat; used when an organization is created and when the app starts.
 */
export async function ensurePresets(db: Db, organization: Pick<Organization, 'id' | 'type'>) {
  if (organization.type !== 'INTERMEDIATE') return;
  const existing = await db.class.findMany({
    where: { organizationId: organization.id, level: 1, builtIn: true },
  });
  const ensure = async (
    year: { code: string; name: string },
    sortOrder: number,
    longTerm: boolean,
  ) =>
    existing.find((c) => c.code === year.code) ??
    (await db.class.create({
      data: {
        organizationId: organization.id,
        level: 1,
        name: year.name,
        code: year.code,
        sortOrder,
        builtIn: true,
        longTerm,
      },
    }));
  const junior = await ensure(INTERMEDIATE_YEARS.junior, 1, false);
  const senior = await ensure(INTERMEDIATE_YEARS.senior, 2, false);
  await ensure(INTERMEDIATE_YEARS.longTerm, 3, true);
  if (!existing.some((c) => c.code === INTERMEDIATE_YEARS.junior.code)) {
    await db.class.update({ where: { id: junior.id }, data: { nextClassId: senior.id } });
  }
}

@Injectable()
export class StructureService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StructureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    const organizations = await this.prisma.forAllOrganizations((db) =>
      db.organization.findMany({ select: { id: true, type: true } }),
    );
    for (const organization of organizations) {
      await this.prisma.forAllOrganizations((db) => ensurePresets(db, organization));
    }
    this.logger.log(`Academic presets are in place in ${organizations.length} organization(s)`);
  }

  // --- Reading ---------------------------------------------------------------------------------

  /**
   * The structure above sections (the whole organization's), with the type, the level names
   * and the built-in choices of the type (which school classes / groups are switched on).
   */
  get(organizationId: string, actor: CurrentUser) {
    this.assertCanView(actor);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const organization = await findOrganization(db, organizationId);
      const classes = (await db.class.findMany({ where: { organizationId, branchId: null } })).sort(
        (a, b) => a.level - b.level || byOrder(a, b),
      );
      const preset = PRESETS[organization.type];
      const topCodes = new Set(classes.filter((c) => c.level === 1).map((c) => c.code));
      const groupCodes = new Set(classes.filter((c) => c.level === 2).map((c) => c.code));
      // How many sections (in every branch) are under each class, for the screens' tables.
      const tree = await ClassTree.load(db, organizationId);
      const sectionCounts: Record<string, number> = {};
      for (const c of classes) {
        sectionCounts[c.id] = tree.below(c.id).filter((id) => tree.get(id)?.branchId).length;
      }
      // Intermediate: the groups each branch runs (ADR-0032), { branchId: ["MPC", ...] }.
      const branchGroups: Record<string, string[]> = {};
      if (organization.type === 'INTERMEDIATE') {
        for (const row of await db.branchGroup.findMany({ where: { organizationId } })) {
          (branchGroups[row.branchId] ??= []).push(row.groupCode);
        }
      }
      return {
        type: organization.type,
        levels: organization.levelNames,
        yearLevel: preset.yearLevel,
        sectionLevel: preset.levels.length,
        classes,
        builtIn:
          organization.type === 'SCHOOL'
            ? SCHOOL_CLASSES.map((c) => ({ ...c, enabled: topCodes.has(c.code) }))
            : organization.type === 'INTERMEDIATE'
              ? INTERMEDIATE_GROUPS.map((g) => ({ ...g, enabled: groupCodes.has(g.code) }))
              : [],
        branchGroups,
        sectionCounts,
      };
    });
  }

  /** A branch's sections, with each one's place in the structure ("Junior › MPC › JEE Mains"). */
  listSections(organizationId: string, branchId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const branch = await findBranch(db, organizationId, branchId);
      if (!can(actor, 'academic.structure.view', { branchId })) {
        throw new NotFoundException('Branch not found');
      }
      const tree = await ClassTree.load(db, organizationId);
      const sections = tree.classes
        .filter((c) => c.branchId === branchId)
        .map((c) => ({ ...c, path: tree.label(c.parentId!) }))
        .sort((a, b) => a.path.localeCompare(b.path) || byOrder(a, b));
      return { branch: { id: branch.id, name: branch.name, status: branch.status }, sections };
    });
  }

  // --- Level names -----------------------------------------------------------------------------

  setLevelNames(organizationId: string, names: string[], actor: CurrentUser) {
    assertCan(actor, 'academic.structure.update', WHOLE_ORGANIZATION);
    const trimmed = names.map((n) => n.trim());
    if (trimmed.some((n) => !n)) throw new BadRequestException('A level needs a name');
    return this.prisma.forOrganization(organizationId, async (db) => {
      const organization = await findOrganization(db, organizationId);
      if (trimmed.length !== organization.levelNames.length) {
        throw new BadRequestException(
          `This organization's structure has ${organization.levelNames.length} levels; you can rename them, not add or remove`,
        );
      }
      await db.organization.update({
        where: { id: organizationId },
        data: { levelNames: trimmed },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'level_names',
        entityId: organizationId,
        details: { before: organization.levelNames, after: trimmed },
      });
      return { levels: trimmed };
    });
  }

  // --- School ----------------------------------------------------------------------------------

  /** The built-in classes (Nursery ... Class 10) the school runs; each one's next = the next ticked. */
  setSchoolClasses(organizationId: string, codes: string[], actor: CurrentUser) {
    assertCan(actor, 'academic.structure.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.requireType(db, organizationId, 'SCHOOL');
      const unknown = codes.filter((code) => !SCHOOL_CLASSES.some((c) => c.code === code));
      if (unknown.length > 0)
        throw new BadRequestException(`Unknown classes: ${unknown.join(', ')}`);

      const existing = await db.class.findMany({
        where: { organizationId, level: 1, builtIn: true },
      });
      for (const c of existing.filter((c) => !codes.includes(c.code))) {
        await this.deleteIfEmpty(db, c, 'has sections; delete those first');
      }
      const kept: Class[] = [];
      for (const [index, item] of SCHOOL_CLASSES.entries()) {
        if (!codes.includes(item.code)) continue;
        kept.push(
          existing.find((c) => c.code === item.code) ??
            (await db.class.create({
              data: {
                organizationId,
                level: 1,
                name: item.name,
                code: item.code,
                sortOrder: index + 1,
                builtIn: true,
              },
            })),
        );
      }
      // Each class moves on to the next one the school runs; the last one completes.
      for (const [index, c] of kept.entries()) {
        await db.class.update({
          where: { id: c.id },
          data: { nextClassId: kept[index + 1]?.id ?? null },
        });
      }
      await this.audit.log(db, actor, {
        action: 'set classes',
        entity: 'academic_structure',
        entityId: organizationId,
        details: { classes: codes },
      });
      return kept.map((c) => c.code);
    });
  }

  // --- Intermediate ----------------------------------------------------------------------------

  /** The groups (MPC, BiPC, CEC, HEC) the college runs, each with "Regular (IPE)" under Junior and Senior. */
  setGroups(organizationId: string, codes: string[], actor: CurrentUser) {
    assertCan(actor, 'academic.structure.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.requireType(db, organizationId, 'INTERMEDIATE');
      const unknown = codes.filter((code) => !INTERMEDIATE_GROUPS.some((g) => g.code === code));
      if (unknown.length > 0)
        throw new BadRequestException(`Unknown groups: ${unknown.join(', ')}`);
      const { junior, senior } = await this.intermediateYears(db, organizationId);
      const previously = new Set(await organizationGroupCodes(db, organizationId));

      // Switched off: the group under every year, with its streams, if nothing is under them.
      const offGroups = await db.class.findMany({
        where: { organizationId, level: 2, code: { notIn: codes } },
      });
      for (const group of offGroups) {
        const streams = await db.class.findMany({ where: { parentId: group.id } });
        for (const stream of streams) {
          await this.deleteIfEmpty(db, stream, 'has sections; delete those first');
        }
        await db.class.delete({ where: { id: group.id } });
      }
      // Switched on: under Junior and Senior, with the Regular stream.
      for (const [index, item] of INTERMEDIATE_GROUPS.entries()) {
        if (!codes.includes(item.code)) continue;
        for (const year of [junior, senior]) {
          const group = await this.ensureChild(db, organizationId, year, {
            ...item,
            sortOrder: index + 1,
          });
          await this.ensureChild(db, organizationId, group, { ...REGULAR_STREAM, sortOrder: 0 });
        }
      }
      // Long Term gets a group only with a long-term stream (addStream).

      // Branches (ADR-0032): a NEWLY switched-on group is run by every branch (each can untick
      // it; groups a branch unticked stay unticked); a group switched off is run by none.
      const added = codes.filter((code) => !previously.has(code));
      await db.branchGroup.deleteMany({ where: { organizationId, groupCode: { notIn: codes } } });
      if (added.length > 0) {
        const branches = await db.branch.findMany({
          where: { organizationId },
          select: { id: true },
        });
        await db.branchGroup.createMany({
          data: branches.flatMap((b) =>
            added.map((groupCode) => ({ organizationId, branchId: b.id, groupCode })),
          ),
          skipDuplicates: true,
        });
      }
      await this.audit.log(db, actor, {
        action: 'set groups',
        entity: 'academic_structure',
        entityId: organizationId,
        details: { groups: codes },
      });
      return codes;
    });
  }

  /** One of the organization's streams, e.g. "JEE Mains" in MPC (or "NEET Long Term" in BiPC). */
  addStream(organizationId: string, dto: AddStreamDto, actor: CurrentUser) {
    assertCan(actor, 'academic.structure.create', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.requireType(db, organizationId, 'INTERMEDIATE');
      if (dto.code.toUpperCase() === REGULAR_STREAM.code) {
        throw new BadRequestException(`${REGULAR_STREAM.code} is the built-in Regular stream`);
      }
      const { junior, senior, longTerm } = await this.intermediateYears(db, organizationId);
      const juniorGroup = await db.class.findFirst({
        where: { parentId: junior.id, code: dto.groupCode },
      });
      if (!juniorGroup) {
        throw new BadRequestException(`Switch the group ${dto.groupCode} on first`);
      }
      const years = dto.longTerm ? [longTerm] : [junior, senior];
      const created: Class[] = [];
      for (const year of years) {
        const group = await this.ensureChild(db, organizationId, year, {
          code: juniorGroup.code,
          name: juniorGroup.name,
          sortOrder: juniorGroup.sortOrder,
        });
        await this.checkCodeFree(db, group.id, null, dto.code);
        created.push(
          await db.class.create({
            data: {
              organizationId,
              parentId: group.id,
              level: 3,
              name: dto.name.trim(),
              code: dto.code,
              longTerm: !!dto.longTerm,
              sortOrder: 1,
            },
          }),
        );
      }
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'stream',
        entityId: created[0].id,
        details: { group: dto.groupCode, name: dto.name, code: dto.code, longTerm: !!dto.longTerm },
      });
      return created;
    });
  }

  /** Renames a stream everywhere it appears (Junior and Senior, or Long Term). */
  renameStream(
    organizationId: string,
    groupCode: string,
    code: string,
    name: string,
    actor: CurrentUser,
  ) {
    assertCan(actor, 'academic.structure.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const streams = await this.findStreams(db, organizationId, groupCode, code);
      await db.class.updateMany({
        where: { id: { in: streams.map((s) => s.id) } },
        data: { name: name.trim() },
      });
      await this.audit.log(db, actor, {
        action: 'rename',
        entity: 'stream',
        entityId: streams[0].id,
        details: { group: groupCode, code, from: streams[0].name, to: name },
      });
      return { renamed: streams.length };
    });
  }

  /** Deletes a stream (everywhere it appears) that has no sections. */
  deleteStream(organizationId: string, groupCode: string, code: string, actor: CurrentUser) {
    assertCan(actor, 'academic.structure.delete', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const streams = await this.findStreams(db, organizationId, groupCode, code);
      for (const stream of streams) {
        await this.deleteIfEmpty(db, stream, 'has sections; delete those first');
      }
      // A Long Term group without streams goes too.
      const { longTerm } = await this.intermediateYears(db, organizationId);
      const longTermGroup = await db.class.findFirst({
        where: { parentId: longTerm.id, code: groupCode },
        include: { _count: { select: { children: true } } },
      });
      if (longTermGroup && longTermGroup._count.children === 0) {
        await db.class.delete({ where: { id: longTermGroup.id } });
      }
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'stream',
        entityId: streams[0].id,
        details: { group: groupCode, code, name: streams[0].name },
      });
      return { deleted: streams.length };
    });
  }

  // --- Degree / Engineering --------------------------------------------------------------------

  /**
   * A course (ADR-0033). With `years` it has no specializations: it gets a hidden "whole course"
   * level and its own 1st Year ... Nth Year (B.Com › 1st Year). Without, its specializations
   * (CSE, ECE ...) are added next, each with its own years.
   */
  addCourse(organizationId: string, dto: AddCourseDto, actor: CurrentUser) {
    assertCan(actor, 'academic.structure.create', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.requireType(db, organizationId, 'DEGREE', 'ENGINEERING');
      await this.checkCodeFree(db, null, null, dto.code, organizationId);
      const course = await db.class.create({
        data: { organizationId, level: 1, name: dto.name.trim(), code: dto.code },
      });
      if (dto.years) {
        const whole = await this.createWholeCourse(db, organizationId, course);
        await this.setYears(db, organizationId, whole, dto.years);
      }
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'course',
        entityId: course.id,
        details: { name: course.name, code: course.code, years: dto.years ?? null },
      });
      return course;
    });
  }

  /**
   * A specialization of a course, with its years of study (1st Year -> ... -> the final year).
   * A course that had its own years (no specializations) loses them here, while they have no
   * sections; with sections they stay, shown as "Whole course" next to the specializations.
   */
  addSpecialization(
    organizationId: string,
    courseId: string,
    dto: AddSpecializationDto,
    actor: CurrentUser,
  ) {
    assertCan(actor, 'academic.structure.create', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.requireType(db, organizationId, 'DEGREE', 'ENGINEERING');
      const course = await this.findClass(db, organizationId, courseId);
      if (course.level !== 1) throw new BadRequestException('Choose a course');
      await this.checkCodeFree(db, course.id, null, dto.code);
      const tree = await ClassTree.load(db, organizationId);
      const whole = tree.children(course.id).find((c) => c.placeholder);
      if (whole && !this.hasSections(tree, whole.id)) await this.removeSubtree(db, tree, whole.id);
      const specialization = await db.class.create({
        data: {
          organizationId,
          parentId: course.id,
          level: 2,
          name: dto.name.trim(),
          code: dto.code,
        },
      });
      await this.setYears(db, organizationId, specialization, dto.years);
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'specialization',
        entityId: specialization.id,
        details: { course: course.name, name: specialization.name, years: dto.years },
      });
      return specialization;
    });
  }

  /**
   * Edits a course or a specialization: name, code, and the number of years. A course's years
   * only while it has no specializations (each specialization has its own). More years are
   * added at the end; fewer remove the last years, only while they have no sections.
   */
  updateProgramme(organizationId: string, id: string, dto: UpdateProgrammeDto, actor: CurrentUser) {
    assertCan(actor, 'academic.structure.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.requireType(db, organizationId, 'DEGREE', 'ENGINEERING');
      const existing = await this.findProgramme(db, organizationId, id);
      if (dto.code !== undefined && dto.code !== existing.code) {
        await this.checkCodeFree(db, existing.parentId, null, dto.code, organizationId);
      }
      const updated = await db.class.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.code !== undefined && { code: dto.code }),
        },
      });
      if (dto.years !== undefined) {
        let target: Class = existing;
        if (existing.level === 1) {
          const tree = await ClassTree.load(db, organizationId);
          const children = tree.children(existing.id);
          if (children.some((c) => !c.placeholder)) {
            throw new BadRequestException(
              `${existing.name} has specializations: change the years of each specialization`,
            );
          }
          target =
            children.find((c) => c.placeholder) ??
            (await this.createWholeCourse(db, organizationId, existing));
        }
        await this.setYears(db, organizationId, target, dto.years);
      }
      await this.audit.log(db, actor, {
        action: 'update',
        entity: existing.level === 1 ? 'course' : 'specialization',
        entityId: id,
        details: { name: existing.name, ...dto },
      });
      return updated;
    });
  }

  /** Deletes a course or a specialization with its years, while nothing has sections under it. */
  deleteProgramme(organizationId: string, id: string, actor: CurrentUser) {
    assertCan(actor, 'academic.structure.delete', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.requireType(db, organizationId, 'DEGREE', 'ENGINEERING');
      const existing = await this.findProgramme(db, organizationId, id);
      const tree = await ClassTree.load(db, organizationId);
      const sections = tree.below(id).filter((c) => tree.get(c)?.branchId);
      if (sections.length > 0) {
        throw new BadRequestException(
          `${existing.name} has ${sections.length} section(s), e.g. ${tree.label(sections[0])}; delete them first`,
        );
      }
      await this.removeSubtree(db, tree, id);
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: existing.level === 1 ? 'course' : 'specialization',
        entityId: id,
        details: { name: existing.name, code: existing.code },
      });
      return { deleted: true };
    });
  }

  /** A course (level 1) or a real specialization (level 2) of this organization. */
  private async findProgramme(db: Db, organizationId: string, id: string) {
    const existing = await this.findClass(db, organizationId, id);
    if (existing.branchId || existing.placeholder || existing.level > 2) {
      throw new BadRequestException('Choose a course or a specialization');
    }
    return existing;
  }

  /** The hidden "whole course" level of a course without specializations (ADR-0033). */
  private createWholeCourse(db: Db, organizationId: string, course: Class) {
    return db.class.create({
      data: {
        organizationId,
        parentId: course.id,
        level: 2,
        name: 'Whole course',
        code: 'ALL',
        builtIn: true,
        placeholder: true,
      },
    });
  }

  /**
   * Gives `parent` (a specialization, or a course's "whole course") exactly `count` years:
   * 1st Year ... Nth Year, each moving on to the next and the last completing. Years are added
   * at the end, and removed from the end only while they have no sections.
   */
  private async setYears(db: Db, organizationId: string, parent: Class, count: number) {
    const tree = await ClassTree.load(db, organizationId);
    const years = tree.children(parent.id);
    for (const year of years.slice(count).reverse()) {
      if (this.hasSections(tree, year.id)) {
        throw new BadRequestException(
          `${tree.label(year.id)} has sections; delete them first to have ${count} year(s)`,
        );
      }
      await this.removeSubtree(db, tree, year.id);
    }
    const kept = years.slice(0, count);
    for (let n = kept.length + 1; n <= count; n++) {
      kept.push(
        await db.class.create({
          data: {
            organizationId,
            parentId: parent.id,
            level: 3,
            ...yearOfStudy(n),
            sortOrder: n,
            builtIn: true,
          },
        }),
      );
    }
    for (const [index, year] of kept.entries()) {
      await db.class.update({
        where: { id: year.id },
        data: { nextClassId: kept[index + 1]?.id ?? null },
      });
    }
  }

  private hasSections(tree: ClassTree, id: string): boolean {
    return tree.below(id).some((c) => tree.get(c)?.branchId);
  }

  /**
   * Deletes a class and everything under it (no sections there: checked by the caller), with
   * their subject links, and clears any "next year" that pointed to them.
   */
  private async removeSubtree(db: Db, tree: ClassTree, id: string) {
    const ids = tree.below(id);
    await db.classSubject.deleteMany({ where: { classId: { in: ids } } });
    await db.class.updateMany({ where: { nextClassId: { in: ids } }, data: { nextClassId: null } });
    const deepestFirst = ids
      .map((c) => tree.get(c)!)
      .sort((a, b) => b.level - a.level)
      .map((c) => c.id);
    for (const classId of deepestFirst) await db.class.delete({ where: { id: classId } });
  }

  // --- Sections (per branch) -------------------------------------------------------------------

  createSection(
    organizationId: string,
    branchId: string,
    dto: CreateSectionDto,
    actor: CurrentUser,
  ) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const branch = await findBranch(db, organizationId, branchId);
      const place = { branchId };
      assertCan(actor, 'academic.structure.create', place);
      await assertBranchInUse(db, branchId);
      const organization = await findOrganization(db, organizationId);
      const parent = await this.findClass(db, organizationId, dto.parentId);
      const level = sectionLevel(organization.type);
      if (parent.branchId || parent.level !== level - 1) {
        throw new BadRequestException(
          `A section sits under a ${organization.levelNames[level - 2]}`,
        );
      }
      if (!parent.isActive) throw new BadRequestException(`${parent.name} is not in use`);
      if (organization.type === 'INTERMEDIATE') {
        // Only under a group this branch runs (ADR-0032).
        const tree = await ClassTree.load(db, organizationId);
        const groupCode = groupCodeOf(tree, parent.id);
        const runs =
          groupCode &&
          (await db.branchGroup.findUnique({
            where: { branchId_groupCode: { branchId, groupCode } },
          }));
        if (!runs) {
          const group = tree.atLevel(parent.id, GROUP_LEVEL)?.name ?? 'this group';
          throw new BadRequestException(
            `${branch.name} doesn't run ${group}: tick it for the branch under Structure → Groups at each branch`,
          );
        }
      }
      await this.checkCodeFree(db, parent.id, branchId, dto.code);
      const section = await db.class.create({
        data: {
          organizationId,
          branchId,
          parentId: parent.id,
          level,
          name: dto.name.trim(),
          code: dto.code,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'section',
        entityId: section.id,
        ...place,
        details: { name: section.name, code: section.code, under: parent.name },
      });
      return section;
    });
  }

  /**
   * Intermediate: the groups a branch runs, out of the organization's (ADR-0032). A group can't
   * be taken off while the branch has sections under it.
   */
  setBranchGroups(organizationId: string, branchId: string, codes: string[], actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const branch = await findBranch(db, organizationId, branchId);
      const place = { branchId };
      assertCan(actor, 'academic.structure.update', place);
      await this.requireType(db, organizationId, 'INTERMEDIATE');
      await assertBranchInUse(db, branchId);
      const available = await organizationGroupCodes(db, organizationId);
      const unknown = codes.filter((code) => !available.includes(code));
      if (unknown.length > 0) {
        throw new BadRequestException(
          `Not switched on for the organization: ${unknown.join(', ')} (Structure → Groups)`,
        );
      }
      const current = (
        await db.branchGroup.findMany({ where: { branchId }, select: { groupCode: true } })
      ).map((r) => r.groupCode);
      const removed = current.filter((code) => !codes.includes(code));
      if (removed.length > 0) {
        const tree = await ClassTree.load(db, organizationId);
        const blocking = tree.classes.filter(
          (c) => c.branchId === branchId && removed.includes(groupCodeOf(tree, c.id) ?? ''),
        );
        if (blocking.length > 0) {
          throw new BadRequestException(
            `${branch.name} still has sections under ${[...new Set(blocking.map((c) => tree.atLevel(c.id, GROUP_LEVEL)!.name))].join(', ')} (e.g. ${tree.label(blocking[0].id)}); delete them first`,
          );
        }
      }
      await db.branchGroup.deleteMany({ where: { branchId, groupCode: { in: removed } } });
      await db.branchGroup.createMany({
        data: codes
          .filter((code) => !current.includes(code))
          .map((groupCode) => ({ organizationId, branchId, groupCode })),
        skipDuplicates: true,
      });
      await this.audit.log(db, actor, {
        action: 'set branch groups',
        entity: 'branch',
        entityId: branchId,
        ...place,
        details: { branch: branch.name, before: current, after: codes },
      });
      return { branchId, groups: codes };
    });
  }

  // --- Any class -------------------------------------------------------------------------------

  /** Rename, reorder, switch off / on, or (year level) change where students go next. */
  updateClass(organizationId: string, id: string, dto: UpdateClassDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findClass(db, organizationId, id);
      const place = { branchId: existing.branchId };
      assertCan(actor, 'academic.structure.update', place);
      if (dto.code !== undefined && dto.code !== existing.code) {
        if (existing.builtIn) throw new BadRequestException('A built-in class keeps its code');
        await this.checkCodeFree(
          db,
          existing.parentId,
          existing.branchId,
          dto.code,
          organizationId,
        );
      }
      if (dto.nextClassId !== undefined) {
        const organization = await findOrganization(db, organizationId);
        const yearLevel = PRESETS[organization.type].yearLevel;
        if (existing.level !== yearLevel || existing.branchId) {
          throw new BadRequestException(
            `Only a ${organization.levelNames[yearLevel - 1]} has a next one`,
          );
        }
        if (dto.nextClassId) {
          const next = await this.findClass(db, organizationId, dto.nextClassId);
          if (next.id === id || next.level !== yearLevel || next.branchId) {
            throw new BadRequestException(
              `Students move on to another ${organization.levelNames[yearLevel - 1]}`,
            );
          }
          if (existing.longTerm || next.longTerm) {
            throw new BadRequestException('Long Term students complete after one year');
          }
        }
      }
      const updated = await db.class.update({ where: { id }, data: dto });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: existing.branchId ? 'section' : 'class',
        entityId: id,
        ...place,
        details: { name: existing.name, ...dto },
      });
      return updated;
    });
  }

  /**
   * Deletes a class without classes or students under it. Built-in classes are switched off
   * instead (school classes and groups are untick-ed on their own screens).
   */
  deleteClass(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findClass(db, organizationId, id);
      const place = { branchId: existing.branchId };
      assertCan(actor, 'academic.structure.delete', place);
      if (existing.builtIn) {
        throw new BadRequestException(
          `${existing.name} comes with the structure; switch it off instead`,
        );
      }
      await this.deleteIfEmpty(db, existing, 'has classes under it; delete those first');
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: existing.branchId ? 'section' : 'class',
        entityId: id,
        ...place,
        details: { name: existing.name, code: existing.code },
      });
      return { deleted: true };
    });
  }

  // --- Helpers ---------------------------------------------------------------------------------

  /** Seeing the structure: "academic.structure.view" anywhere (it is the organization's). */
  private assertCanView(actor: CurrentUser) {
    if (!canSomewhere(actor, 'academic.structure.view')) {
      throw new NotFoundException('Not found');
    }
  }

  private async requireType(db: Db, organizationId: string, ...types: Organization['type'][]) {
    const organization = await findOrganization(db, organizationId);
    if (!types.includes(organization.type)) {
      throw new BadRequestException(
        `This is for ${types.map((t) => t.toLowerCase()).join(' / ')} organizations`,
      );
    }
    return organization;
  }

  private async intermediateYears(db: Db, organizationId: string) {
    const years = await db.class.findMany({
      where: { organizationId, level: 1, builtIn: true },
    });
    const find = (code: string) => {
      const year = years.find((y) => y.code === code);
      if (!year) throw new BadRequestException('The Intermediate years are missing');
      return year;
    };
    return {
      junior: find(INTERMEDIATE_YEARS.junior.code),
      senior: find(INTERMEDIATE_YEARS.senior.code),
      longTerm: find(INTERMEDIATE_YEARS.longTerm.code),
    };
  }

  /** The child of `parent` with this code, created (built-in) if missing. */
  private async ensureChild(
    db: Db,
    organizationId: string,
    parent: Class,
    item: { code: string; name: string; sortOrder: number },
  ) {
    const found = await db.class.findFirst({ where: { parentId: parent.id, code: item.code } });
    if (found) return found;
    return db.class.create({
      data: {
        organizationId,
        parentId: parent.id,
        level: parent.level + 1,
        name: item.name,
        code: item.code,
        sortOrder: item.sortOrder,
        builtIn: true,
        longTerm: parent.longTerm,
      },
    });
  }

  private async findStreams(db: Db, organizationId: string, groupCode: string, code: string) {
    const streams = await db.class.findMany({
      where: { organizationId, level: 3, code, parent: { code: groupCode }, builtIn: false },
    });
    if (streams.length === 0) throw new NotFoundException('Stream not found');
    return streams;
  }

  private async findClass(db: Db, organizationId: string, id: string) {
    const found = await db.class.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Class not found');
    return found;
  }

  /**
   * Deletes the class if nothing is under it (no classes, no students ever placed there);
   * otherwise "<name> <hasChildren>", e.g. "JEE Mains has sections; delete those first".
   */
  private async deleteIfEmpty(db: Db, c: Class, hasChildren: string) {
    const [children, enrolments] = await Promise.all([
      db.class.count({ where: { parentId: c.id } }),
      db.enrolment.count({ where: { classId: c.id } }),
    ]);
    if (children > 0) throw new BadRequestException(`${c.name} ${hasChildren}`);
    if (enrolments > 0) {
      throw new BadRequestException(
        `${c.name} has students (now or in the past); switch it off instead`,
      );
    }
    await db.class.delete({ where: { id: c.id } });
  }

  /**
   * Codes are unique among siblings: under the same parent (and, for sections, in the same
   * branch). For the top level, pass the organization id.
   */
  private async checkCodeFree(
    db: Db,
    parentId: string | null,
    branchId: string | null,
    code: string,
    organizationId?: string,
  ) {
    const taken = await db.class.findFirst({
      where: { parentId, branchId, code, ...(organizationId && { organizationId }) },
    });
    if (taken) throw new ConflictException(`The code ${code} is already used here`);
  }
}
