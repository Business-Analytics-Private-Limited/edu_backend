-- =================================================================================================
-- Where a role applies, and names in the audit log (ADR-0018).
--
--   user_roles  + id, institution_id, campus_id: a role now applies to the whole organization
--               (both empty), one institution, or one campus. The same user can have the same
--               role at several places (e.g. Senior faculty at two campuses), so the primary key
--               becomes a plain id.
--   audit_logs  + actor_name, institution_id, campus_id: who made the change (by name) and where.
--
-- Existing role assignments keep applying to the whole organization.
-- =================================================================================================

SELECT set_config('app.bypass_rls', 'on', false);

-- --- user_roles ----------------------------------------------------------------------------------

ALTER TABLE "user_roles" ADD COLUMN "id" UUID;
UPDATE "user_roles" SET "id" = uuidv7();  -- PostgreSQL 18: time-ordered UUIDs, like the app's ids
ALTER TABLE "user_roles" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_pkey";
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");

ALTER TABLE "user_roles" ADD COLUMN "institution_id" UUID;
ALTER TABLE "user_roles" ADD COLUMN "campus_id" UUID;

CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");
CREATE INDEX "user_roles_institution_id_idx" ON "user_roles"("institution_id");
CREATE INDEX "user_roles_campus_id_idx" ON "user_roles"("campus_id");

-- A campus or institution that staff are still assigned to can't be deleted.
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- audit_logs ----------------------------------------------------------------------------------

ALTER TABLE "audit_logs" ADD COLUMN "actor_name" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "institution_id" UUID;
ALTER TABLE "audit_logs" ADD COLUMN "campus_id" UUID;

-- Fill in names for what is already in the log.
UPDATE "audit_logs" a SET "actor_name" = u."name"
FROM "users" u WHERE a."actor_type" = 'user' AND u."id" = a."actor_id";
UPDATE "audit_logs" a SET "actor_name" = s."name"
FROM "super_admins" s WHERE a."actor_type" = 'super_admin' AND s."id" = a."actor_id";

SELECT set_config('app.bypass_rls', 'off', false);
