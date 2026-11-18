-- The audit log is mandatory and add-only (ADR-0027).

-- A failed login with an unknown email has no person behind it.
ALTER TABLE "audit_logs" ALTER COLUMN "actor_id" DROP NOT NULL;

-- The app may add entries and read them, never change or remove them. (Only the database owner,
-- used for migrations, still could; that is an administrator's action outside the app.)
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM edu_app;

-- The super admin's log page lists every organization's entries, newest first.
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
