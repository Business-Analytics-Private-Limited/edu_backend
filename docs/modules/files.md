# Module: files

> **Status: design, not built yet.** Written before the backend was simplified; the purpose, data and rules still apply, the technical details (schemas, paths, `.manage` permissions, events) will follow today's conventions when it is built. See [README.md](README.md#reading-the-design-documents).

| | |
|---|---|
| Schema | `files` |
| Phase | 2 (service), used from Phase 4 |
| Depends on | none |
| Code | `services/files/` |

## Purpose

Stores file metadata and gives other modules safe upload and download links. The file contents live in S3-compatible object storage (MinIO locally).

## Responsibilities

- Issuing short-lived signed upload URLs and download URLs.
- Checking uploads: size, content type (by inspecting the bytes, not the extension), malware scan, removal of image metadata such as location.
- Keeping one metadata row per file with its owner.

Not this module: deciding **who** may see a file. The owning module (e.g. `students` for documents) checks permissions, then asks `files` for a download link.

## Manifest

- Always enabled.
- Limits: `storage.maxGb` per tenant (default 20).

## Permissions

None of its own. No public endpoints: uploads and downloads go through the owning module's endpoints, which apply that module's permissions.

## Data model

```
files.files                                                                                  [std][sd]
  id, tenant_id
  bucket          text not null
  object_key      text not null         '{tenant_id}/{owner_module}/{id}', never the original name
  original_name   text not null  [P]
  content_type    text not null
  size_bytes      bigint not null
  sha256          text
  status          text check (pending_upload | pending_scan | clean | rejected)
  rejected_reason text
  scanned_at      timestamptz
  owner_module    text not null         'students'
  owner_type      text                  'students.document'
  owner_id        uuid
  index (tenant_id, owner_type, owner_id)
```

Buckets are private. Object keys start with the tenant id, and signed URLs are valid for 5 minutes.

## API

None public. See the owning modules (e.g. `students` documents and photo endpoints).

## Events

Published: `files.file.uploaded` (`fileId, ownerModule, ownerType, ownerId, status`) after the scan passes or fails.

## Public facade

```ts
interface FilesFacade {
  createUpload(input: { ownerModule; ownerType; ownerId?; originalName; contentType; sizeBytes }):
    Promise<{ fileId; uploadUrl; expiresAt }>;
  completeUpload(fileId): Promise<FileInfo>;       // verifies size and hash, queues the scan
  getDownloadUrl(fileId): Promise<{ url; expiresAt }>;   // only for status 'clean'
  getFile(fileId): Promise<FileInfo | null>;
  delete(fileId): Promise<void>;                   // soft delete; object removed after 30 days
}
```

## Business rules

1. Allowed content types and maximum size come from the owning module (e.g. document types in `students`).
2. Downloads are allowed only for `clean` files.
3. Storage use counts against the tenant's `storage.maxGb` limit.

## Tests

- A download URL for a tenant A file can't be requested from tenant B (RLS makes the file invisible).
- A file claiming `image/png` whose bytes are a PDF is rejected.

## Open questions

- Malware scanning: ClamAV container in the worker (proposed) or the cloud provider's scanner. Decide with hosting (Phase 7); ClamAV locally until then.
