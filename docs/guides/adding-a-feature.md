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
npm run db:migration -- add_subjects
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

Then `npm run db:migrate`.

## 3. The permission: `src/modules/roles/permissions.ts`

Permissions are listed per resource, with its actions:

```ts
{ key: 'academic.subject', module: 'academic', group: 'Academic', label: 'Subjects', actions: CRUD },
```

This gives `academic.subject.view`, `.create`, `.update` and `.delete` (this one already exists). `module: 'academic'` means they only work when the Academic module is switched on. The Organization admin gets new permissions automatically; for other predefined roles, add them in `predefined-roles.ts` (new organizations) or ask the super admin to tick them (existing ones).

## 4. The feature folder: `src/modules/subjects/`

```
subjects/
  dto/subject.dto.ts        CreateSubjectDto with @IsString(), @Length(...)
  subjects.service.ts       list / create / update / delete
  subjects.controller.ts    the routes
  subjects.module.ts        @Module({ controllers: [...], providers: [...] })
```

The service always works inside the organization, checks the permission **at the record's place** (if the record belongs to an institution or campus), and writes the audit log with that place:

```ts
create(organizationId: string, dto: CreateSubjectDto, actor: CurrentUser) {
  const place = { institutionId: dto.institutionId };
  if (!can(actor, 'academic.subject.create', place)) {       // src/common/scope.ts
    throw new ForbiddenException('Your roles don\'t allow this for this institution');
  }
  return this.prisma.forOrganization(organizationId, async (db) => {
    const subject = await db.subject.create({ data: { ...dto, organizationId } });
    await this.audit.log(db, actor, {
      action: 'create', entity: 'subject', entityId: subject.id, ...place,
    });
    return subject;
  });
}
```

Lists are filtered to what the user may see with `reachOf(actor, 'academic.subject.view')` (see `src/modules/organization/organization.service.ts`).

Every controller method says who may call it:

```ts
@Post('subjects')
@RequirePermission('academic.subject.create')   // has it somewhere; the service checks the place
create(@OrganizationId() organizationId: string, @Body() body: CreateSubjectDto,
       @CurrentUser() user: CurrentUserType) {
  return this.subjects.create(organizationId, body, user);
}
```

## 5. Register it: `src/app.module.ts`

Add `SubjectsModule` to `imports`.

## 6. Test it: `test/subjects.e2e-spec.ts`

At least: the happy path, a user without the permission gets 403, **organization B can't see organization A's subjects** (404 / empty list), and **a campus / institution admin can't touch another campus / institution**. Copy the patterns from `test/organization.e2e-spec.ts` and `test/places.e2e-spec.ts`.

## 7. Check

```sh
npm run lint && npm run typecheck && npm run test && npm run test:e2e
```

Swagger (`/api/docs`) shows the new routes automatically.
