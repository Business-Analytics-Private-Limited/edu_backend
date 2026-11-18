-- ADR-0032: the groups (MPC, BiPC, CEC, HEC) each branch runs, out of the organization's.

-- CreateTable
CREATE TABLE "branch_groups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "group_code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_groups_organization_id_idx" ON "branch_groups"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_groups_branch_id_group_code_key" ON "branch_groups"("branch_id", "group_code");

-- AddForeignKey
ALTER TABLE "branch_groups" ADD CONSTRAINT "branch_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_groups" ADD CONSTRAINT "branch_groups_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- (by hand) Nothing changes for existing data: every branch of an Intermediate organization
-- runs every group its organization has switched on.
INSERT INTO "branch_groups" ("id", "organization_id", "branch_id", "group_code")
SELECT gen_random_uuid(), b."organization_id", b."id", g."code"
FROM "branches" b
JOIN "organizations" o ON o."id" = b."organization_id" AND o."type" = 'INTERMEDIATE'
JOIN (
  SELECT DISTINCT "organization_id", "code"
  FROM "classes"
  WHERE "level" = 2 AND "branch_id" IS NULL
) g ON g."organization_id" = b."organization_id";

-- (by hand) Row security: the same rule as every organization table
ALTER TABLE "branch_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branch_groups" FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON "branch_groups"
  USING (current_setting('app.bypass_rls', true) = 'on'
         OR "organization_id"::text = current_setting('app.organization_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on'
         OR "organization_id"::text = current_setting('app.organization_id', true));
