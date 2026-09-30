/**
 * The predefined roles (Organization admin, Director, Principal, ...).
 *
 * How they work:
 *   - role_templates holds ONE row per predefined role, with its permissions. Only the super
 *     admin changes them (updateTemplate).
 *   - every organization has its own COPY of each (a row in roles with templateKey set), because
 *     users are linked to roles of their own organization. Copies always follow the template:
 *     a change by the super admin is written to every organization's copy at once.
 *   - organization admins can assign the copies to users, but can't change or delete them.
 *
 * When the app starts (onApplicationBootstrap), this service makes sure every template exists,
 * the Organization admin has every permission (also ones added in a new version), and every
 * organization has an up-to-date copy of every template.
 */
import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ALL_PERMISSION_KEYS, isKnownPermission } from './permissions';
import { ORG_ADMIN, PREDEFINED_ROLES } from './predefined-roles';

@Injectable()
export class PredefinedRolesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PredefinedRolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    await this.prisma.forAllOrganizations((db) => this.ensureTemplates(db));
    const organizations = await this.prisma.forAllOrganizations((db) =>
      db.organization.findMany({ select: { id: true } }),
    );
    // One transaction per organization, so many organizations don't make one huge transaction.
    for (const { id } of organizations) {
      await this.prisma.forAllOrganizations((db) => this.copyToOrganization(db, id));
    }
    this.logger.log(`Predefined roles are up to date in ${organizations.length} organization(s)`);
  }

  /** The predefined roles, in display order (super admin console). */
  listTemplates() {
    return this.prisma.forAllOrganizations((db) =>
      db.roleTemplate.findMany({ orderBy: { sortOrder: 'asc' } }),
    );
  }

  /** The super admin changes a predefined role's permissions, for every organization at once. */
  updateTemplate(key: string, permissions: string[], actor: CurrentUser) {
    if (key === ORG_ADMIN) {
      throw new BadRequestException('The Organization admin always has every permission');
    }
    const unknown = permissions.filter((p) => !isKnownPermission(p));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}`);
    }
    return this.prisma.forAllOrganizations(async (db) => {
      const before = await db.roleTemplate.findUnique({ where: { key } });
      if (!before) throw new BadRequestException(`No predefined role "${key}"`);

      const template = await db.roleTemplate.update({ where: { key }, data: { permissions } });
      const copies = await db.role.updateMany({
        where: { templateKey: key },
        data: { permissions },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'predefined_role',
        entityId: key,
        organizationId: null,
        details: { before: before.permissions, after: permissions, organizations: copies.count },
      });
      return template;
    });
  }

  /**
   * Gives an organization an up-to-date copy of every predefined role (used for a new
   * organization, and at startup). Returns the copies by template key.
   */
  async copyToOrganization(db: Db, organizationId: string) {
    const templates = await db.roleTemplate.findMany({ orderBy: { sortOrder: 'asc' } });
    const copies: Record<string, string> = {};

    for (const template of templates) {
      const data = {
        name: template.name,
        description: template.description,
        permissions: template.permissions,
      };
      const copy = await db.role.findFirst({
        where: { organizationId, templateKey: template.key },
      });
      if (copy) {
        await db.role.update({ where: { id: copy.id }, data });
        copies[template.key] = copy.id;
        continue;
      }

      // The organization may already have its own role with this name: keep it, renamed.
      const sameName = await db.role.findFirst({
        where: { organizationId, name: template.name, templateKey: null },
      });
      if (sameName) {
        await db.role.update({
          where: { id: sameName.id },
          data: { name: `${sameName.name} (own)` },
        });
      }
      const created = await db.role.create({
        data: { ...data, organizationId, templateKey: template.key },
      });
      copies[template.key] = created.id;
    }
    return copies;
  }

  /**
   * Creates missing templates from predefined-roles.ts. Existing templates keep the permissions
   * the super admin gave them (minus any that no longer exist); the Organization admin always
   * gets the full list.
   */
  private async ensureTemplates(db: Db) {
    for (const [index, role] of PREDEFINED_ROLES.entries()) {
      const fixed = {
        name: role.name,
        description: role.description,
        assignable: role.assignable,
        sortOrder: index + 1,
      };
      const existing = await db.roleTemplate.findUnique({ where: { key: role.key } });
      if (!existing) {
        await db.roleTemplate.create({
          data: {
            key: role.key,
            ...fixed,
            permissions: role.permissions.filter(isKnownPermission),
          },
        });
        continue;
      }
      const permissions =
        role.key === ORG_ADMIN
          ? ALL_PERMISSION_KEYS
          : existing.permissions.filter(isKnownPermission);
      await db.roleTemplate.update({ where: { key: role.key }, data: { ...fixed, permissions } });
    }
  }
}
