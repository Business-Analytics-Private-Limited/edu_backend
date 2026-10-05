/**
 * The CLASS STRUCTURE: an institution's class levels, and each campus's tree of classes.
 *
 *   Levels (per institution, top to bottom)   e.g. Year -> Group -> Section
 *                                             or   Type -> Group -> Stream -> Section
 *   Classes (per campus, following the levels)
 *     1st year                  level 1
 *       MPC                     level 2
 *         Section A             level 3  (the last level: students are placed here)
 *
 * Rules:
 *   - levels: rename any time; change how many there are only while the institution has no
 *     classes (existing classes would no longer fit);
 *   - a class sits one level below its parent, on the same campus; the top level has no parent;
 *     nothing goes below the last level;
 *   - codes are unique among siblings; a class with classes under it can't be deleted;
 *   - classes are managed at their campus ("academic.structure.*" there): a Campus admin builds
 *     their own campus; levels need the permission for the institution.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, can, canSomewhereIn } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateClassDto, SetClassLevelsDto, UpdateClassDto } from './dto/academic.dto';
import { assertCampusInUse } from '../organization/places-in-use';

@Injectable()
export class ClassStructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Levels ----------------------------------------------------------------------------------

  getLevels(organizationId: string, institutionId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findInstitution(db, organizationId, institutionId);
      if (!canSomewhereIn(actor, 'academic.structure.view', institutionId)) {
        throw new NotFoundException('Institution not found');
      }
      return db.classLevel.findMany({
        where: { organizationId, institutionId },
        orderBy: { position: 'asc' },
      });
    });
  }

  setLevels(
    organizationId: string,
    institutionId: string,
    dto: SetClassLevelsDto,
    actor: CurrentUser,
  ) {
    const place = { institutionId };
    assertCan(actor, 'academic.structure.update', place);
    const names = dto.names.map((n) => n.trim());
    if (names.some((n) => n === '')) throw new BadRequestException('A level needs a name');

    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findInstitution(db, organizationId, institutionId);
      const existing = await db.classLevel.findMany({
        where: { institutionId },
        orderBy: { position: 'asc' },
      });
      const hasClasses = (await db.class.count({ where: { institutionId } })) > 0;
      if (hasClasses && names.length !== existing.length) {
        throw new BadRequestException(
          'This institution already has classes, so the number of levels can no longer change; you can still rename them',
        );
      }

      // Replace the list; positions are 1..n in the given order.
      await db.classLevel.deleteMany({ where: { institutionId } });
      await db.classLevel.createMany({
        data: names.map((name, index) => ({
          organizationId,
          institutionId,
          position: index + 1,
          name,
        })),
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'class_levels',
        entityId: institutionId,
        ...place,
        details: { before: existing.map((l) => l.name), after: names },
      });
      return db.classLevel.findMany({ where: { institutionId }, orderBy: { position: 'asc' } });
    });
  }

  // --- Classes ---------------------------------------------------------------------------------

  /** A campus's classes as a flat list (parentId links them); the screen draws the tree. */
  listClasses(organizationId: string, campusId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const campus = await this.findCampus(db, organizationId, campusId);
      if (
        !can(actor, 'academic.structure.view', { institutionId: campus.institutionId, campusId })
      ) {
        throw new NotFoundException('Campus not found');
      }
      const [levels, classes] = await Promise.all([
        db.classLevel.findMany({
          where: { institutionId: campus.institutionId },
          orderBy: { position: 'asc' },
        }),
        db.class.findMany({
          where: { campusId },
          orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        }),
      ]);
      return { campus, levels, classes };
    });
  }

  createClass(organizationId: string, campusId: string, dto: CreateClassDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const campus = await this.findCampus(db, organizationId, campusId);
      const place = { institutionId: campus.institutionId, campusId };
      assertCan(actor, 'academic.structure.create', place);
      await assertCampusInUse(db, campusId);

      const levelCount = await db.classLevel.count({
        where: { institutionId: campus.institutionId },
      });
      let level = 1;
      if (dto.parentId) {
        const parent = await db.class.findFirst({ where: { id: dto.parentId, campusId } });
        if (!parent) throw new BadRequestException('The parent class is not on this campus');
        level = parent.level + 1;
      }
      if (level > levelCount) {
        throw new BadRequestException(
          'Nothing can be added below the last level (that is where students are placed)',
        );
      }
      await this.checkCodeFree(db, campusId, dto.parentId ?? null, dto.code);

      const created = await db.class.create({
        data: {
          organizationId,
          institutionId: campus.institutionId,
          campusId,
          parentId: dto.parentId ?? null,
          level,
          name: dto.name,
          code: dto.code,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'class',
        entityId: created.id,
        ...place,
        details: { name: created.name, code: created.code, level },
      });
      return created;
    });
  }

  updateClass(organizationId: string, id: string, dto: UpdateClassDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findClass(db, organizationId, id);
      const place = { institutionId: existing.institutionId, campusId: existing.campusId };
      assertCan(actor, 'academic.structure.update', place);
      if (dto.code && dto.code !== existing.code) {
        await this.checkCodeFree(db, existing.campusId, existing.parentId, dto.code);
      }
      const updated = await db.class.update({ where: { id }, data: dto });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'class',
        entityId: id,
        ...place,
        details: { ...dto },
      });
      return updated;
    });
  }

  deleteClass(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findClass(db, organizationId, id);
      const place = { institutionId: existing.institutionId, campusId: existing.campusId };
      assertCan(actor, 'academic.structure.delete', place);
      if ((await db.class.count({ where: { parentId: id } })) > 0) {
        throw new BadRequestException('Delete the classes under this one first');
      }
      await db.class.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'class',
        entityId: id,
        ...place,
        details: { name: existing.name, code: existing.code },
      });
      return { deleted: true };
    });
  }

  // --- Helpers ---------------------------------------------------------------------------------

  private async findInstitution(db: Db, organizationId: string, id: string) {
    const institution = await db.institution.findFirst({ where: { id, organizationId } });
    if (!institution) throw new NotFoundException('Institution not found');
    return institution;
  }

  private async findCampus(db: Db, organizationId: string, id: string) {
    const campus = await db.campus.findFirst({
      where: { id, organizationId },
      include: { institution: { select: { id: true, name: true } } },
    });
    if (!campus) throw new NotFoundException('Campus not found');
    return campus;
  }

  private async findClass(db: Db, organizationId: string, id: string) {
    const found = await db.class.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Class not found');
    return found;
  }

  private async checkCodeFree(db: Db, campusId: string, parentId: string | null, code: string) {
    const taken = await db.class.findFirst({ where: { campusId, parentId, code } });
    if (taken) throw new ConflictException(`The code ${code} is already used here`);
  }
}
