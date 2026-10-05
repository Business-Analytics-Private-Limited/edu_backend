/**
 * Adding and deleting an institution. Only the super admin does this (ADR-0025): when creating an
 * organization, and later from the organization's page in the console. The organization's own
 * users can view and rename institutions and manage their campuses (organization.service.ts).
 *
 * Both functions take the transaction (`db`) of the caller, so the change and its audit entry
 * are saved together.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Db } from '../../prisma/prisma.service';
import { DEFAULT_LEVELS } from '../academic/default-levels';
import type { CreateInstitutionDto } from './dto/institution.dto';

/** Creates the institution with the starting class levels (Class -> Section), renameable. */
export async function addInstitution(db: Db, organizationId: string, dto: CreateInstitutionDto) {
  if (await db.institution.findFirst({ where: { organizationId, code: dto.code } })) {
    throw new BadRequestException(
      `This organization already has an institution with code ${dto.code}`,
    );
  }
  const institution = await db.institution.create({
    data: { organizationId, name: dto.name, code: dto.code },
  });
  await db.classLevel.createMany({
    data: DEFAULT_LEVELS.map((name, index) => ({
      organizationId,
      institutionId: institution.id,
      position: index + 1,
      name,
    })),
  });
  return institution;
}

/**
 * Deletes an institution that is still empty: no campuses, no roles given there, and no
 * academic data (years, batches, subjects, ...). Anything else is refused with the reason.
 */
export async function deleteEmptyInstitution(db: Db, organizationId: string, id: string) {
  const institution = await db.institution.findFirst({ where: { id, organizationId } });
  if (!institution) throw new NotFoundException('Institution not found');
  if ((await db.campus.count({ where: { institutionId: id } })) > 0) {
    throw new BadRequestException(
      'This institution has campuses; it can only be deleted while empty',
    );
  }
  if ((await db.userRole.count({ where: { institutionId: id } })) > 0) {
    throw new BadRequestException(
      'Some users still have roles in this institution; take those roles away first',
    );
  }
  await db.classLevel.deleteMany({ where: { institutionId: id } });
  try {
    await db.institution.delete({ where: { id } });
  } catch (error) {
    // A foreign key still points here: academic years, batches, subjects, document types, ...
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new BadRequestException(
        'This institution still has data (academic years, batches, subjects, ...); it can only be deleted while empty',
      );
    }
    throw error;
  }
  return institution;
}
