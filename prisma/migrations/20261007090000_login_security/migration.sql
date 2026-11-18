-- Login security (ADR-0028): sessions that can be ended, account lockout after failed logins,
-- a forced change of temporary passwords, and two-step login for super admins.

-- Every account starts with a password someone else chose (the seed, an admin): it must be
-- changed at the next login. This also applies to the accounts that exist today.
ALTER TABLE "super_admins"
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "failed_logins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMPTZ,
  ADD COLUMN "totp_secret" TEXT,
  ADD COLUMN "totp_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users"
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "failed_logins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMPTZ;

-- One row per login. A token is only valid while its session hasn't ended: logging out ends it,
-- a password change ends the account's other sessions.
CREATE TABLE "login_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "super_admin_id" UUID,
    "user_id" UUID,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,

    CONSTRAINT "login_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "login_sessions_one_account" CHECK (("super_admin_id" IS NULL) <> ("user_id" IS NULL))
);
CREATE INDEX "login_sessions_super_admin_id_idx" ON "login_sessions"("super_admin_id");
CREATE INDEX "login_sessions_user_id_idx" ON "login_sessions"("user_id");
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_super_admin_id_fkey" FOREIGN KEY ("super_admin_id") REFERENCES "super_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
