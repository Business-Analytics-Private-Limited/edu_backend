-- Institutions are added by the super admin, and they have no type any more (ADR-0025).
-- Every institution sets up its own class levels; every feature works the same for all of them.

ALTER TABLE "institutions" DROP COLUMN "type";
DROP TYPE "InstitutionType";

-- Organization users can no longer add or delete institutions: take those permissions out of
-- the predefined roles and every organization's roles. (roles has row security, so this session
-- may see every organization while it runs.)
SELECT set_config('app.bypass_rls', 'on', false);

UPDATE "role_templates"
SET "permissions" = array_remove(array_remove("permissions", 'platform.institution.create'), 'platform.institution.delete');

UPDATE "roles"
SET "permissions" = array_remove(array_remove("permissions", 'platform.institution.create'), 'platform.institution.delete');

SELECT set_config('app.bypass_rls', '', false);
