-- Organizations may change the permissions of their copy of a predefined role (ADR-0029).
-- A changed copy is "customized": the super admin's later changes to that predefined role no
-- longer overwrite it, until the organization resets it to EduPlatform's version.
ALTER TABLE "roles" ADD COLUMN "customized" BOOLEAN NOT NULL DEFAULT false;
