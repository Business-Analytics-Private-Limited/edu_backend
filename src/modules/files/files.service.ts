/**
 * FILE STORAGE (ADR-0023): keeps uploaded files and their details.
 *
 *   const file = await files.save(db, organizationId, upload, actor);   // checks and stores
 *   const { stream, file } = await files.open(db, fileId);              // to send it back
 *   await files.removeLater([storageKey])                                // after the DB change
 *
 * The bytes go to a folder on the server (STORAGE_DIR, default ./storage), one sub-folder per
 * organization, named by a random id: never the uploaded name, never inside the website. The
 * database row (stored_files) keeps the original name, type, size and SHA-256.
 * Only PDF, JPEG and PNG up to 5 MB are accepted, and the CONTENT is checked (not just the name).
 * To move to cloud storage later (S3, MinIO), only this file changes.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CurrentUser } from '../../common/current-user';
import type { Db } from '../../prisma/prisma.service';

/** An uploaded file as the upload handler gives it (multer, kept in memory). */
export interface Upload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** The kinds of file accepted, recognised by their first bytes. */
const KINDS = [
  { mime: 'application/pdf', ext: 'pdf', starts: Buffer.from('%PDF') },
  { mime: 'image/jpeg', ext: 'jpg', starts: Buffer.from([0xff, 0xd8, 0xff]) },
  { mime: 'image/png', ext: 'png', starts: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
];

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('STORAGE_DIR') ?? './storage');
  }

  /** Checks an upload, writes it to the storage and records it. Returns the stored_files row. */
  async save(db: Db, organizationId: string, upload: Upload | undefined, actor: CurrentUser) {
    if (!upload || upload.size === 0) throw new BadRequestException('Choose a file');
    if (upload.size > MAX_FILE_BYTES) throw new BadRequestException('The file is bigger than 5 MB');
    const kind = KINDS.find((k) => upload.buffer.subarray(0, k.starts.length).equals(k.starts));
    if (!kind) throw new BadRequestException('Only PDF, JPG or PNG files are accepted');

    const storageKey = `${organizationId}/${randomUUID()}.${kind.ext}`;
    const path = this.pathOf(storageKey);
    await mkdir(join(this.root, organizationId), { recursive: true });
    await writeFile(path, upload.buffer, { flag: 'wx' });
    try {
      return await db.storedFile.create({
        data: {
          organizationId,
          originalName: cleanName(upload.originalname, kind.ext),
          mimeType: kind.mime,
          sizeBytes: upload.size,
          sha256: createHash('sha256').update(upload.buffer).digest('hex'),
          storageKey,
          createdBy: actor.id,
        },
      });
    } catch (error) {
      await unlink(path).catch(() => undefined); // don't leave a file the database doesn't know
      throw error;
    }
  }

  /** The file's details and a stream of its bytes. */
  async open(db: Db, fileId: string) {
    const file = await db.storedFile.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found');
    return { file, stream: createReadStream(this.pathOf(file.storageKey)) };
  }

  /**
   * Deletes stored bytes. Call it AFTER the database change is saved, so a failed transaction
   * never loses a file; a leftover file is harmless and only logged.
   */
  async removeLater(storageKeys: string[]) {
    for (const key of storageKeys) {
      await unlink(this.pathOf(key)).catch((error: Error) =>
        this.logger.warn(`Could not delete stored file ${key}: ${error.message}`),
      );
    }
  }

  /** The disk path for a key, refusing anything that would point outside the storage folder. */
  private pathOf(storageKey: string): string {
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(this.root)) throw new BadRequestException('Bad file path');
    return path;
  }
}

/** A safe display name: no folders, no odd characters, the right extension. */
function cleanName(name: string, ext: string): string {
  const base = (name.split(/[\\/]/).pop() ?? 'file').replace(/[^\w.\- ()]/g, '_').slice(0, 100);
  return base.toLowerCase().endsWith(`.${ext}`) || (ext === 'jpg' && /\.jpe?g$/i.test(base))
    ? base
    : `${base}.${ext}`;
}
