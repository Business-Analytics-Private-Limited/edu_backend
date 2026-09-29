-- audit.entries: append-only, partitioned by month (docs/modules/audit.md).
-- Schema "audit" is created by the migration runner.

create table audit.entries (
  id              uuid        not null,
  tenant_id       uuid        not null,
  occurred_at     timestamptz not null,
  actor_type      text        not null check (actor_type in ('user', 'platform_user', 'system', 'device')),
  actor_id        uuid,
  impersonator_id uuid,
  module_key      text        not null,
  entity_type     text        not null,
  entity_id       uuid        not null,
  action          text        not null,
  changes         jsonb,
  reason          text,
  request_id      text,
  ip              inet,
  user_agent      text,
  redacted_at     timestamptz,
  primary key (id, occurred_at)
) partition by range (occurred_at);

comment on column audit.entries.changes is '@pii';
comment on column audit.entries.ip is '@pii';

create index entries_entity_idx on audit.entries (tenant_id, entity_type, entity_id, occurred_at desc);
create index entries_actor_idx on audit.entries (tenant_id, actor_id, occurred_at desc);

alter table audit.entries enable row level security;
alter table audit.entries force row level security;
create policy tenant_isolation on audit.entries
  for all to edu_app
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));

-- Creates monthly partitions from this month up to `months_ahead` months ahead.
-- Partitions don't inherit RLS, so each gets it too; runtime roles have no grants on
-- partitions and can only reach rows through the parent table and its policy.
create function audit.ensure_partitions(months_ahead integer default 3) returns void
language plpgsql security definer set search_path = pg_catalog, audit
as $$
declare
  month_start date := date_trunc('month', now())::date;
  from_date   date;
  to_date     date;
  part_name   text;
begin
  for i in 0..months_ahead loop
    from_date := (month_start + make_interval(months => i))::date;
    to_date   := (from_date + interval '1 month')::date;
    part_name := format('entries_%s', to_char(from_date, 'YYYY_MM'));
    if to_regclass(format('audit.%I', part_name)) is null then
      execute format(
        'create table audit.%I partition of audit.entries for values from (%L) to (%L)',
        part_name, from_date, to_date);
      execute format('alter table audit.%I enable row level security', part_name);
      execute format('alter table audit.%I force row level security', part_name);
    end if;
  end loop;
end
$$;

-- Rows outside every monthly partition land here instead of failing the business write.
create table audit.entries_default partition of audit.entries default;
alter table audit.entries_default enable row level security;
alter table audit.entries_default force row level security;

select audit.ensure_partitions(3);

-- Append-only: insert and select, never update or delete (docs/modules/audit.md).
grant usage on schema audit to edu_app;
grant select, insert on audit.entries to edu_app;
revoke all on function audit.ensure_partitions(integer) from public;
grant execute on function audit.ensure_partitions(integer) to edu_app;
