# Module: files (file storage)

| | |
|---|---|
| Status | **Built:** storage for uploaded files (used by student documents) |
| Code | `src/modules/files/files.service.ts` |
| Table | `stored_files` |
| Decisions | ADR-0023 |

## In plain words

Uploaded files are kept in a folder on the server (`STORAGE_DIR`, default `./storage` in the backend folder), never inside the website and never in git. Each organization has its own sub-folder; files are named by a random id. The database keeps the original name, type, size and a SHA-256 fingerprint. Files are only reachable through API endpoints that check permissions.

## Rules

1. Only PDF, JPEG and PNG, at most 5 MB; the file's content is checked, not just its name.
2. File names from users are cleaned (no folders, no odd characters).
3. A file is written before its database row and removed again if saving fails; on delete, the row goes first and the file after.
4. Back up `STORAGE_DIR` together with the database.

## How to use it in a module

```ts
const file = await this.files.save(db, organizationId, upload, actor);  // checks + stores
const { file, stream } = await this.files.open(db, fileId);             // to send it back
await this.files.removeLater([file.storageKey]);                        // after the DB change
```

## Later

Cloud storage (S3 / MinIO) behind the same service, virus scanning, previews.
