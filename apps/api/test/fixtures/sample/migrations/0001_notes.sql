-- Test-only module "sample": the reference shape of a tenant table and an outbox.
-- Copy this pattern for every module's tables (docs/07-database-design.md §7.4, §7.5).

create table sample.notes (
  id         uuid        primary key,
  tenant_id  uuid        not null,
  body       text        not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

alter table sample.notes enable row level security;
alter table sample.notes force row level security;
create policy tenant_isolation on sample.notes
  for all to edu_app
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));

create table sample.outbox (
  id           uuid        primary key,
  tenant_id    uuid        not null,
  type         text        not null,
  subject      text        not null,
  data_schema  text        not null,
  data         jsonb       not null,
  occurred_at  timestamptz not null default now(),
  published_at timestamptz,
  attempts     integer     not null default 0,
  last_error   text
);
create index outbox_tenant_idx on sample.outbox (tenant_id, id);
create index outbox_unsent_idx on sample.outbox (id) where published_at is null;

alter table sample.outbox enable row level security;
alter table sample.outbox force row level security;
create policy tenant_isolation on sample.outbox
  for all to edu_app
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));
create policy relay_read on sample.outbox for select to edu_relay using (true);
create policy relay_mark on sample.outbox for update to edu_relay using (true) with check (true);

grant usage on schema sample to edu_app, edu_relay;
grant select, insert, update, delete on sample.notes to edu_app;
grant insert on sample.outbox to edu_app;
grant select, update (published_at, attempts, last_error) on sample.outbox to edu_relay;
