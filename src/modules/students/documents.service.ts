/**
 * STUDENT DOCUMENTS (ADR-0023): document types per institution, and each student's documents.
 *
 * Document types ("Transfer certificate", "Aadhaar copy", ...): per institution, managed with
 * "students.settings.update" there. A type can be REQUIRED (shown as missing until uploaded) and
 * VISIBLE IN THE PORTAL (parents / students may see and download it).
 *
 * A student's documents, at the student's campus:
 *   view / download   students.document.view
 *   upload            students.document.create
 *   verify / reject   students.document.update
 *   delete            students.document.delete
 * Files are kept by FilesService (PDF, JPG, PNG up to 5 MB, content checked).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, can, canSomewhereIn } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService, Upload } from '../files/files.service';
import { CreateDocumentTypeDto, ReviewDocumentDto, UpdateDocumentTypeDto } from './dto/student.dto';
import { findVisibleStudent, placeOf } from './placement';

const DOCUMENT_FIELDS = {
  id: true,
  status: true,
  note: true,
  uploadedByName: true,
  verifiedByName: true,
  verifiedAt: true,
  createdAt: true,
  documentType: { select: { id: true, name: true, visibleInPortal: true } },
  file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
} as const;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  // --- Document types ----------------------------------------------------------------------------

  listTypes(organizationId: string, actor: CurrentUser, institutionId?: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const types = await db.documentType.findMany({
        where: { organizationId, ...(institutionId && { institutionId }) },
        orderBy: { name: 'asc' },
        include: {
          institution: { select: { id: true, name: true } },
          _count: { select: { documents: true } },
        },
      });
      return types.filter(
        (t) =>
          canSomewhereIn(actor, 'students.document.view', t.institutionId) ||
          canSomewhereIn(actor, 'students.settings.update', t.institutionId),
      );
    });
  }

  createType(organizationId: string, dto: CreateDocumentTypeDto, actor: CurrentUser) {
    const place = { institutionId: dto.institutionId };
    assertCan(actor, 'students.settings.update', place);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const institution = await db.institution.findFirst({
        where: { id: dto.institutionId, organizationId },
      });
      if (!institution) throw new NotFoundException('Institution not found');
      const type = await db.documentType.create({
        data: { ...dto, name: dto.name.trim(), organizationId },
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'document_type',
        entityId: type.id,
        ...place,
        details: { name: type.name },
      });
      return type;
    });
  }

  updateType(organizationId: string, id: string, dto: UpdateDocumentTypeDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findType(db, organizationId, id);
      const place = { institutionId: existing.institutionId };
      assertCan(actor, 'students.settings.update', place);
      const type = await db.documentType.update({
        where: { id },
        data: { ...dto, name: dto.name?.trim() },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'document_type',
        entityId: id,
        ...place,
        details: { ...dto },
      });
      return type;
    });
  }

  deleteType(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findType(db, organizationId, id);
      const place = { institutionId: existing.institutionId };
      assertCan(actor, 'students.settings.update', place);
      if ((await db.studentDocument.count({ where: { documentTypeId: id } })) > 0) {
        throw new BadRequestException(
          'Students have documents of this type; mark it "not in use" instead',
        );
      }
      await db.documentType.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'document_type',
        entityId: id,
        ...place,
        details: { name: existing.name },
      });
      return { deleted: true };
    });
  }

  // --- A student's documents -----------------------------------------------------------------------

  /** The student's documents, and the required types still missing. */
  list(organizationId: string, studentId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, studentId, actor);
      if (!can(actor, 'students.document.view', placeOf(student))) {
        throw new NotFoundException('Student not found');
      }
      const [documents, required] = await Promise.all([
        db.studentDocument.findMany({
          where: { studentId },
          select: DOCUMENT_FIELDS,
          orderBy: { createdAt: 'desc' },
        }),
        db.documentType.findMany({
          where: { institutionId: student.institutionId, isRequired: true, isActive: true },
          select: { id: true, name: true },
        }),
      ]);
      const have = new Set(
        documents.filter((d) => d.status !== 'REJECTED').map((d) => d.documentType.id),
      );
      return { documents, missing: required.filter((t) => !have.has(t.id)) };
    });
  }

  async upload(
    organizationId: string,
    studentId: string,
    documentTypeId: string,
    upload: Upload | undefined,
    actor: CurrentUser,
  ) {
    let savedKey: string | undefined;
    try {
      return await this.prisma.forOrganization(organizationId, async (db) => {
        const student = await findVisibleStudent(db, organizationId, studentId, actor);
        const place = placeOf(student);
        assertCan(actor, 'students.document.create', place);
        const type = await db.documentType.findFirst({
          where: { id: documentTypeId, institutionId: student.institutionId },
        });
        if (!type) throw new BadRequestException("Choose one of the institution's document types");
        if (!type.isActive) throw new BadRequestException(`${type.name} is not in use any more`);

        const file = await this.files.save(db, organizationId, upload, actor);
        savedKey = file.storageKey;
        const document = await db.studentDocument.create({
          data: {
            organizationId,
            studentId,
            documentTypeId,
            fileId: file.id,
            uploadedBy: actor.id,
            uploadedByName: actor.name,
          },
          select: DOCUMENT_FIELDS,
        });
        await this.audit.log(db, actor, {
          action: 'upload document',
          entity: 'student',
          entityId: studentId,
          ...place,
          details: { type: type.name, file: file.originalName, size: file.sizeBytes },
        });
        return document;
      });
    } catch (error) {
      // The transaction failed after the file was written: remove the orphan.
      if (savedKey) await this.files.removeLater([savedKey]);
      throw error;
    }
  }

  review(
    organizationId: string,
    studentId: string,
    documentId: string,
    dto: ReviewDocumentDto,
    actor: CurrentUser,
  ) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, studentId, actor);
      const place = placeOf(student);
      assertCan(actor, 'students.document.update', place);
      const existing = await this.findDocument(db, studentId, documentId);
      if (dto.status === 'REJECTED' && !dto.note?.trim()) {
        throw new BadRequestException('Say why the document is rejected');
      }
      const document = await db.studentDocument.update({
        where: { id: documentId },
        data: {
          status: dto.status,
          note: dto.note?.trim() || null,
          verifiedBy: actor.id,
          verifiedByName: actor.name,
          verifiedAt: new Date(),
        },
        select: DOCUMENT_FIELDS,
      });
      await this.audit.log(db, actor, {
        action: dto.status === 'VERIFIED' ? 'verify document' : 'reject document',
        entity: 'student',
        entityId: studentId,
        ...place,
        details: { type: existing.documentType.name, note: dto.note },
      });
      return document;
    });
  }

  async delete(organizationId: string, studentId: string, documentId: string, actor: CurrentUser) {
    const storageKey = await this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, studentId, actor);
      const place = placeOf(student);
      assertCan(actor, 'students.document.delete', place);
      const existing = await this.findDocument(db, studentId, documentId);
      await db.studentDocument.delete({ where: { id: documentId } });
      await db.storedFile.delete({ where: { id: existing.fileId } });
      await this.audit.log(db, actor, {
        action: 'delete document',
        entity: 'student',
        entityId: studentId,
        ...place,
        details: { type: existing.documentType.name, file: existing.file.originalName },
      });
      return existing.file.storageKey;
    });
    await this.files.removeLater([storageKey]); // only once the database change is saved
    return { deleted: true };
  }

  /** The file of a student's document, for downloading. */
  download(organizationId: string, studentId: string, documentId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, studentId, actor);
      if (!can(actor, 'students.document.view', placeOf(student))) {
        throw new NotFoundException('Document not found');
      }
      const document = await this.findDocument(db, studentId, documentId);
      // Who looked at which document is recorded too (ADR-0027): ID copies are sensitive.
      await this.audit.log(db, actor, {
        action: 'download document',
        entity: 'student',
        entityId: studentId,
        ...placeOf(student),
        details: { documentId },
      });
      return this.files.open(db, document.fileId);
    });
  }

  // --- Portal (parents and students) ----------------------------------------------------------

  /** Documents of a linked student whose type is visible in the portal. */
  portalList(actor: CurrentUser, studentId: string) {
    this.checkLinked(actor, studentId);
    return this.prisma.forOrganization(actor.organizationId!, (db) =>
      db.studentDocument.findMany({
        where: { studentId, documentType: { visibleInPortal: true } },
        select: DOCUMENT_FIELDS,
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  portalDownload(actor: CurrentUser, studentId: string, documentId: string) {
    this.checkLinked(actor, studentId);
    return this.prisma.forOrganization(actor.organizationId!, async (db) => {
      const document = await db.studentDocument.findFirst({
        where: { id: documentId, studentId, documentType: { visibleInPortal: true } },
      });
      if (!document) throw new NotFoundException('Document not found');
      const student = await db.student.findUniqueOrThrow({ where: { id: studentId } });
      await this.audit.log(db, actor, {
        action: 'download document',
        entity: 'student',
        entityId: studentId,
        ...placeOf(student),
        details: { documentId, viaPortal: true },
      });
      return this.files.open(db, document.fileId);
    });
  }

  // --- Helpers ---------------------------------------------------------------------------------

  private checkLinked(actor: CurrentUser, studentId: string) {
    if (!actor.studentIds.includes(studentId)) throw new NotFoundException('Student not found');
  }

  private async findType(db: Db, organizationId: string, id: string) {
    const type = await db.documentType.findFirst({ where: { id, organizationId } });
    if (!type) throw new NotFoundException('Document type not found');
    return type;
  }

  private async findDocument(db: Db, studentId: string, documentId: string) {
    const document = await db.studentDocument.findFirst({
      where: { id: documentId, studentId },
      include: { documentType: true, file: true },
    });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }
}
