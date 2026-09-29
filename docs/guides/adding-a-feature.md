# Adding a feature, step by step

Example: a **Subjects** list for an organization (name + code). Copy the shape of `src/modules/users/` or `src/modules/roles/`.

## 1. The table: `prisma/schema.prisma`

```prisma
/// A subject taught in the organization, e.g. "Mathematics".
model Subject {
  id             String   @id @default(uuid(7)) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  name           String
  code           String
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz

  organization Organization @relation(fields: [organizationId], references: [id])

  @@unique([organizationId, code])
  @@map("subjects")
}
```

Also add `subjects Subject[]` to `model Organization`.

## 2. The migration

```sh
pnpm db:migration add_subjects
```

Open the new `prisma/migrations/<date>_add_subjects/migration.sql` and add the **row security** lines at the end (the table belongs to an organization):

```sql
ALTER TABLE "subjects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subjects" FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON "subjects"
  USING (current_setting('app.bypass_rls', true) = 'on'
         OR "organization_id"::text = current_setting('app.organization_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on'
         OR "organization_id"::text = current_setting('app.organization_id', true));
```

Then `pnpm db:migrate`.

## 3. The permission: `src/modules/roles/permissions.ts`

```ts
{ key: 'academic.subject.manage', module: 'academic', group: 'Academic', description: 'Manage subjects' },
```

(This one already exists. `module: 'academic'` means it only works when the Academic module is switched on.)

## 4. The feature folder: `src/modules/subjects/`

```
subjects/
  dto/subject.dto.ts        CreateSubjectDto with @IsString(), @Length(...)
  subjects.service.ts       list / create / update / delete
  subjects.controller.ts    the routes
  subjects.module.ts        @Module({ controllers: [...], providers: [...] })
```

The service always works inside the organization, and writes the audit log:

```ts
create(organizationId: string, dto: CreateSubjectDto, actor: CurrentUser) {
  return this.prisma.forOrganization(organizationId, async (db) => {
    const subject = await db.subject.create({ data: { ...dto, organizationId } });
    await this.audit.log(db, actor, { action: 'create', entity: 'subject', entityId: subject.id });
    return subject;
  });
}
```

Every controller method says who may call it:

```ts
@Post('subjects')
@RequirePermission('academic.subject.manage')
create(@OrganizationId() organizationId: string, @Body() body: CreateSubjectDto,
       @CurrentUser() user: CurrentUserType) {
  return this.subjects.create(organizationId, body, user);
}
```

## 5. Register it: `src/app.module.ts`

Add `SubjectsModule` to `imports`.

## 6. Test it: `test/subjects.e2e-spec.ts`

At least: the happy path, a user without the permission gets 403, and **organization B can't see organization A's subjects** (404 / empty list). Copy the pattern from `test/organization.e2e-spec.ts`.

## 7. Check

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```

Swagger (`/api/docs`) shows the new routes automatically.
