/**
 * STUDENT DOCUMENTS and their types (ADR-0023). Checked at the student's branch (types: the organization) in
 * DocumentsService.
 *
 *   GET    /api/v1/document-types                                students.document.view
 *   POST   /api/v1/document-types                                students.settings.update
 *   PATCH  /api/v1/document-types/:id                            students.settings.update
 *   DELETE /api/v1/document-types/:id                            students.settings.update
 *
 *   GET    /api/v1/students/:id/documents                        students.document.view
 *   POST   /api/v1/students/:id/documents  (multipart: file, documentTypeId)   students.document.create
 *   PATCH  /api/v1/students/:id/documents/:docId                 students.document.update (verify / reject)
 *   DELETE /api/v1/students/:id/documents/:docId                 students.document.delete
 *   GET    /api/v1/students/:id/documents/:docId/file            students.document.view (download)
 *
 *   GET    /api/v1/portal/students/:id/documents                 portal logins
 *   GET    /api/v1/portal/students/:id/documents/:docId/file     portal logins
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { PortalUser, RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser, OrganizationId } from '../../common/decorators/current-user.decorator';
import { MAX_FILE_BYTES, Upload } from '../files/files.service';
import { DocumentsService } from './documents.service';
import {
  CreateDocumentTypeDto,
  ReviewDocumentDto,
  UpdateDocumentTypeDto,
  UploadDocumentDto,
} from './dto/student.dto';

/** Sends a stored file back as a download. */
function sendFile(
  res: Response,
  opened: {
    file: { originalName: string; mimeType: string; sizeBytes: number };
    stream: NodeJS.ReadableStream;
  },
) {
  res.set({
    'Content-Type': opened.file.mimeType,
    'Content-Length': String(opened.file.sizeBytes),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(opened.file.originalName)}`,
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(opened.stream as never);
}

@ApiTags('Students: documents')
@ApiBearerAuth()
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  // --- Document types ----------------------------------------------------------------------------

  @Get('document-types')
  @RequirePermission('students.document.view')
  listTypes(@OrganizationId() organizationId: string, @CurrentUser() user: CurrentUserType) {
    return this.documents.listTypes(organizationId, user);
  }

  @Post('document-types')
  @RequirePermission('students.settings.update')
  createType(
    @OrganizationId() organizationId: string,
    @Body() body: CreateDocumentTypeDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documents.createType(organizationId, body, user);
  }

  @Patch('document-types/:id')
  @RequirePermission('students.settings.update')
  updateType(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDocumentTypeDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documents.updateType(organizationId, id, body, user);
  }

  @Delete('document-types/:id')
  @RequirePermission('students.settings.update')
  deleteType(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documents.deleteType(organizationId, id, user);
  }

  // --- A student's documents -----------------------------------------------------------------------

  @Get('students/:id/documents')
  @RequirePermission('students.document.view')
  list(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documents.list(organizationId, id, user);
  }

  @Post('students/:id/documents')
  @RequirePermission('students.document.create')
  @ApiConsumes('multipart/form-data')
  // Kept in memory (at most 5 MB, one file); FilesService checks and stores it.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  upload(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UploadDocumentDto,
    @UploadedFile() file: Upload | undefined,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documents.upload(organizationId, id, body.documentTypeId, file, user);
  }

  @Patch('students/:id/documents/:docId')
  @RequirePermission('students.document.update')
  review(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() body: ReviewDocumentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documents.review(organizationId, id, docId, body, user);
  }

  @Delete('students/:id/documents/:docId')
  @RequirePermission('students.document.delete')
  delete(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.documents.delete(organizationId, id, docId, user);
  }

  @Get('students/:id/documents/:docId/file')
  @RequirePermission('students.document.view')
  async download(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: CurrentUserType,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendFile(res, await this.documents.download(organizationId, id, docId, user));
  }

  // --- Portal ------------------------------------------------------------------------------------

  @Get('portal/students/:id/documents')
  @PortalUser()
  portalList(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserType) {
    return this.documents.portalList(user, id);
  }

  @Get('portal/students/:id/documents/:docId/file')
  @PortalUser()
  async portalDownload(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: CurrentUserType,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendFile(res, await this.documents.portalDownload(user, id, docId));
  }
}
