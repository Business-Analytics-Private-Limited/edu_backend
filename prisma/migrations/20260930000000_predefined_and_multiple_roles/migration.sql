-- =================================================================================================
-- Predefined roles and several roles per user (ADR-0017).
--
--   role_templates  the predefined roles (Director, Principal, ...), managed by the super admin
--   roles           + template_key: set on an organization's copy of a predefined role
--   user_roles      which roles each user has (a user can now have several)
--
-- Permissions are also split into view / create / update / delete, so the permission keys stored
-- in existing roles are rewritten below. The other predefined roles are added to every
-- organization when the app starts (src/modules/roles/predefined-roles.service.ts).
-- =================================================================================================

-- This migration moves rows of every organization, so it looks past row security.
SELECT set_config('app.bypass_rls', 'on', false);

-- --- New tables ----------------------------------------------------------------------------------

CREATE TABLE "role_templates" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "permissions" TEXT[],
    "assignable" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "role_templates_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");
CREATE INDEX "user_roles_organization_id_idx" ON "user_roles"("organization_id");
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- Existing "Organization admin" roles become copies of the predefined role ---------------------

-- The app fills in the full permission list when it starts.
INSERT INTO "role_templates" ("key", "name", "description", "permissions", "assignable", "sort_order", "updated_at")
VALUES ('org_admin', 'Organization admin', 'Full access to everything in the organization', '{}', true, 1, now());

ALTER TABLE "roles" ADD COLUMN "template_key" TEXT;
UPDATE "roles" SET "template_key" = 'org_admin' WHERE "is_system";
ALTER TABLE "roles" DROP COLUMN "is_system";
CREATE UNIQUE INDEX "roles_organization_id_template_key_key" ON "roles"("organization_id", "template_key");
ALTER TABLE "roles" ADD CONSTRAINT "roles_template_key_fkey" FOREIGN KEY ("template_key") REFERENCES "role_templates"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- Each user's one role moves to user_roles --------------------------------------------------

INSERT INTO "user_roles" ("user_id", "role_id", "organization_id")
SELECT "id", "role_id", "organization_id" FROM "users";

ALTER TABLE "users" DROP CONSTRAINT "users_role_id_fkey";
ALTER TABLE "users" DROP COLUMN "role_id";

-- --- Old "manage" permissions become view / create / update / delete ---------------------------

CREATE TEMPORARY TABLE permission_renames (old_key TEXT, new_key TEXT);
INSERT INTO permission_renames VALUES
  ('platform.institution.view',   'platform.organization.view'),
  ('platform.institution.view',   'platform.institution.view'),
  ('platform.institution.manage', 'platform.institution.create'),
  ('platform.institution.manage', 'platform.institution.update'),
  ('platform.institution.manage', 'platform.institution.delete'),
  ('platform.campus.manage',      'platform.campus.create'),
  ('platform.campus.manage',      'platform.campus.update'),
  ('platform.campus.manage',      'platform.campus.delete'),
  ('platform.settings.manage',    'platform.organization.update'),
  ('access.user.view',            'access.user.view'),
  ('access.user.view',            'access.role.view'),
  ('access.user.manage',          'access.user.create'),
  ('access.user.manage',          'access.user.update'),
  ('access.role.manage',          'access.role.view'),
  ('access.role.manage',          'access.role.create'),
  ('access.role.manage',          'access.role.update'),
  ('access.role.manage',          'access.role.delete'),
  ('academic.structure.manage',   'academic.structure.create'),
  ('academic.structure.manage',   'academic.structure.update'),
  ('academic.structure.manage',   'academic.structure.delete'),
  ('academic.year.manage',        'academic.year.view'),
  ('academic.year.manage',        'academic.year.create'),
  ('academic.year.manage',        'academic.year.update'),
  ('academic.year.manage',        'academic.year.delete'),
  ('academic.subject.manage',     'academic.subject.view'),
  ('academic.subject.manage',     'academic.subject.create'),
  ('academic.subject.manage',     'academic.subject.update'),
  ('academic.subject.manage',     'academic.subject.delete'),
  ('academic.calendar.manage',    'academic.calendar.view'),
  ('academic.calendar.manage',    'academic.calendar.create'),
  ('academic.calendar.manage',    'academic.calendar.update'),
  ('academic.calendar.manage',    'academic.calendar.delete'),
  ('students.document.manage',    'students.document.create'),
  ('students.document.manage',    'students.document.update'),
  ('students.document.manage',    'students.document.delete'),
  ('students.settings.manage',    'students.settings.view'),
  ('students.settings.manage',    'students.settings.update'),
  ('attendance.policy.manage',    'attendance.policy.view'),
  ('attendance.policy.manage',    'attendance.policy.update'),
  ('attendance.device.manage',    'attendance.device.view'),
  ('attendance.device.manage',    'attendance.device.create'),
  ('attendance.device.manage',    'attendance.device.update'),
  ('attendance.device.manage',    'attendance.device.delete');

-- A key with a rename gets its new keys; any other key stays as it is.
UPDATE "roles" r
SET "permissions" = COALESCE((
  SELECT array_agg(DISTINCT k ORDER BY k)
  FROM (
    SELECT COALESCE(pr.new_key, p.key) AS k
    FROM unnest(r."permissions") AS p(key)
    LEFT JOIN permission_renames pr ON pr.old_key = p.key
  ) keys
), '{}');

DROP TABLE permission_renames;

-- --- Row security for the new organization table (same rule as the others) ---------------------

ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON "user_roles"
  USING (current_setting('app.bypass_rls', true) = 'on'
         OR "organization_id"::text = current_setting('app.organization_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on'
         OR "organization_id"::text = current_setting('app.organization_id', true));

SELECT set_config('app.bypass_rls', 'off', false);
