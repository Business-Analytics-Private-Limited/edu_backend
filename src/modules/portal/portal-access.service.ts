/**
 * PORTAL LOGINS, managed by staff from a student's page.
 *
 *   - a STUDENT login is linked to the student's own record;
 *   - a PARENT login is linked to a GUARDIAN record, so the parent sees all of that guardian's
 *     children (siblings too) with one login.
 *
 * Rules: needs "students.student.update" at the student's branch and the portal module; one
 * login per student and per guardian; portal logins have no roles or permissions (ADR-0022).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { CurrentUser } from '../../common/current-user';
import { assertCan } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { findVisibleStudent, placeOf } from '../students/placement';
import { GrantPortalAccessDto } from './dto/portal.dto';

@Injectable()
export class PortalAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  grant(organizationId: string, studentId: string, dto: GrantPortalAccessDto, actor: CurrentUser) {
    this.checkPortalOn(actor);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, studentId, actor);
      const place = placeOf(student);
      assertCan(actor, 'students.student.update', place);
      if (student.status !== 'ACTIVE') {
        throw new BadRequestException('Outgoing students have no portal access');
      }

      let name = student.fullName;
      let link: { kind: 'STUDENT'; studentId: string } | { kind: 'PARENT'; guardianId: string };
      if (dto.for === 'STUDENT') {
        if (await db.user.findFirst({ where: { studentId } })) {
          throw new ConflictException('This student already has a login');
        }
        link = { kind: 'STUDENT', studentId };
      } else {
        if (!dto.guardianId) throw new BadRequestException('Choose the guardian');
        const relation = await db.studentGuardian.findFirst({
          where: { studentId, guardianId: dto.guardianId },
          include: { guardian: true },
        });
        if (!relation) throw new BadRequestException('That guardian is not linked to this student');
        if (await db.user.findFirst({ where: { guardianId: dto.guardianId } })) {
          throw new ConflictException(
            `${relation.guardian.fullName} already has a login (it covers all their children)`,
          );
        }
        name = relation.guardian.fullName;
        link = { kind: 'PARENT', guardianId: dto.guardianId };
      }

      const user = await db.user.create({
        data: {
          organizationId,
          name,
          email: dto.email.toLowerCase(),
          passwordHash: await bcrypt.hash(dto.password, 10),
          ...link,
        },
        select: { id: true, name: true, email: true, kind: true, status: true },
      });
      await this.audit.log(db, actor, {
        action: 'grant portal access',
        entity: 'student',
        entityId: studentId,
        ...place,
        details: { login: user.email, for: user.kind, name },
      });
      return user;
    });
  }

  /** Removes a portal login of this student or of one of their guardians. */
  revoke(organizationId: string, studentId: string, userId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, studentId, actor);
      const place = placeOf(student);
      assertCan(actor, 'students.student.update', place);
      const login = await this.findLogin(db, organizationId, studentId, userId);
      await db.user.delete({ where: { id: login.id } });
      await this.audit.log(db, actor, {
        action: 'remove portal access',
        entity: 'student',
        entityId: studentId,
        ...place,
        details: { login: login.email },
      });
      return { removed: true };
    });
  }

  /** The login must be the student's or one of their guardians'. */
  private async findLogin(db: Db, organizationId: string, studentId: string, userId: string) {
    const login = await db.user.findFirst({
      where: {
        id: userId,
        organizationId,
        OR: [{ studentId }, { guardian: { students: { some: { studentId } } } }],
      },
    });
    if (!login) throw new NotFoundException('Login not found for this student');
    return login;
  }

  private checkPortalOn(actor: CurrentUser) {
    if (!actor.enabledModules.includes('portal')) {
      throw new ForbiddenException('The parent and student portal is not switched on');
    }
  }
}
