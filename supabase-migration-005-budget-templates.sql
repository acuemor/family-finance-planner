-- Family Finance Planner · migración 005
-- Plantillas de gastos, fondos acumulativos y asignaciones de ahorro.
-- Ejecutar UNA VEZ después de la migración 004.

create table if not exists public.budget_templates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  item_type text not null check (item_type in ('fixed_expense','variable_expense','sinking_fund','common_saving','individual_saving','additional_allocation')),
  default_amount numeric(12,2) not null check (default_amount > 0),
  destination_account_id uuid,
  target_amount numeric(12,2) check (target_amount is null or target_amount > 0),
  target_date date,
  start_month date not null default date_trunc('month', current_date)::date check (extract(day from start_month) = 1),
  end_month date check (end_month is null or (extract(day from end_month) = 1 and end_month >= start_month)),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, destination_account_id) references public.accounts(household_id, id),
  check ((target_amount is null and target_date is null) or (item_type = 'sinking_fund' and target_amount is not null and target_date is not null))
);

alter table public.monthly_plan_items
  add column if not exists template_id uuid,
  add column if not exists target_amount numeric(12,2),
  add column if not exists target_date date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'monthly_plan_items_template_fk' and conrelid = 'public.monthly_plan_items'::regclass) then
    alter table public.monthly_plan_items add constraint monthly_plan_items_template_fk
      foreign key (household_id, template_id) references public.budget_templates(household_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'monthly_plan_items_target_amount_check' and conrelid = 'public.monthly_plan_items'::regclass) then
    alter table public.monthly_plan_items add constraint monthly_plan_items_target_amount_check check (target_amount is null or target_amount > 0);
  end if;
end $$;

create unique index if not exists monthly_plan_item_template_once
  on public.monthly_plan_items(household_id, monthly_plan_id, template_id) where template_id is not null;
create index if not exists budget_templates_household_active_idx
  on public.budget_templates(household_id, is_active, start_month, end_month);

alter table public.budget_templates enable row level security;
drop policy if exists budget_templates_select on public.budget_templates;
drop policy if exists budget_templates_insert on public.budget_templates;
drop policy if exists budget_templates_update on public.budget_templates;
drop policy if exists budget_templates_delete on public.budget_templates;
create policy budget_templates_select on public.budget_templates
  for select to authenticated using (public.is_household_member(household_id));
create policy budget_templates_insert on public.budget_templates
  for insert to authenticated with check (
    public.is_household_member(household_id) and
    (destination_account_id is null or exists (select 1 from public.accounts a where a.id = destination_account_id and a.household_id = budget_templates.household_id))
  );
create policy budget_templates_update on public.budget_templates
  for update to authenticated using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id) and
    (destination_account_id is null or exists (select 1 from public.accounts a where a.id = destination_account_id and a.household_id = budget_templates.household_id)));
create policy budget_templates_delete on public.budget_templates
  for delete to authenticated using (public.is_household_member(household_id));
grant select, insert, update, delete on public.budget_templates to authenticated;

create or replace function public.prepare_monthly_budget_plan(p_household_id uuid, p_month date)
returns void language plpgsql security definer set search_path = '' as $$
declare plan_id uuid;
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) then
    raise exception 'No tienes acceso a este hogar.';
  end if;
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'El mes debe corresponder al primer día.';
  end if;
  insert into public.monthly_plans(household_id, month, status)
    values (p_household_id, p_month, 'open') on conflict (household_id, month) do nothing;
  select mp.id into plan_id from public.monthly_plans mp
    where mp.household_id = p_household_id and mp.month = p_month;
  if exists (select 1 from public.monthly_plans mp where mp.id = plan_id and mp.status = 'closed') then
    return;
  end if;
  insert into public.monthly_plan_items(
    household_id, monthly_plan_id, month, name, item_type, planned_amount,
    destination_account_id, template_id, target_amount, target_date
  )
  select bt.household_id, plan_id, p_month, bt.name, bt.item_type, bt.default_amount,
    bt.destination_account_id, bt.id, bt.target_amount, bt.target_date
  from public.budget_templates bt
  where bt.household_id = p_household_id and bt.is_active
    and bt.start_month <= p_month and (bt.end_month is null or bt.end_month >= p_month)
  on conflict (household_id, monthly_plan_id, template_id) where template_id is not null do nothing;
end;
$$;

revoke all on function public.prepare_monthly_budget_plan(uuid, date) from public;
grant execute on function public.prepare_monthly_budget_plan(uuid, date) to authenticated;
