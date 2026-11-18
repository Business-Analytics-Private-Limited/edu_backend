# ADR-0023: Files on the server's disk behind the API; student documents with types and review

Status: Accepted
Date: 2026-10-02

## Context

Schools collect certificates and ID copies for every student. Files must never be public, must be checked (type, size), and must be easy to move to cloud storage later. The project runs on one server for now (no Docker, no object storage yet).

## Decision

- **File storage** (`src/modules/files`): bytes in a folder on the server (`STORAGE_DIR`, default `./storage`, outside the website, not in git), one sub-folder per organization, file names are random ids. Details in `stored_files` (original name, type, size, SHA-256). Only PDF, JPEG and PNG up to 5 MB; the **content** is checked by its first bytes, not by the name or the browser's claim. Files are only served through API endpoints that check permissions.
- **Order of operations:** a file is written before its database row (and removed if the transaction fails); on delete the row goes first and the file after the transaction, so the database never points to a missing file.
- **Document types** per institution (`document_types`): required (shown as missing until uploaded) and visible in the portal.
- **Student documents** (`student_documents`): type, file, status (uploaded / verified / rejected with a reason), who uploaded and who reviewed. Permissions at the student's campus: `students.document.view` (see, download), `.create` (upload), `.update` (verify / reject), `.delete`.
- **Portal:** parents and students see and download a linked student's documents whose type is visible in the portal.
- The web app never exposes the API token: downloads go through Next.js route handlers that stream the file.

## Consequences

- The storage folder must be **backed up with the database** (deployment guide).
- Moving to S3 / MinIO later changes only `FilesService`.
- Later: virus scanning, image previews, documents for staff, size / type settings per institution.
