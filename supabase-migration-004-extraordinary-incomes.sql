-- Family Finance Planner · migración 004
-- Añade la clasificación de ingresos habituales y extraordinarios.
-- Ejecutar UNA VEZ después de la migración 003.

alter table public.monthly_plan_incomes
  add column if not exists income_type text;

-- Conserva como habituales los ingresos que proceden de una plantilla.
-- Los registros antiguos sin plantilla se consideran extraordinarios/puntuales.
update public.monthly_plan_incomes
set income_type = case when template_id is not null then 'regular' else 'extraordinary' end
where income_type is null;

alter table public.monthly_plan_incomes
  alter column income_type set default 'extraordinary',
  alter column income_type set not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'monthly_plan_incomes_income_type_check'
      and conrelid = 'public.monthly_plan_incomes'::regclass
  ) then
    alter table public.monthly_plan_incomes
      add constraint monthly_plan_incomes_income_type_check
      check (income_type in ('regular', 'extraordinary'));
  end if;
end $$;

-- Actualiza la función que copia plantillas: las filas copiadas quedan marcadas
-- como habituales. No modifica importes de meses ya preparados.
create or replace function public.prepare_monthly_income_plan(p_household_id uuid, p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare plan_id uuid;
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) then
    raise exception 'No tienes acceso a este hogar.';
  end if;
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'El mes debe corresponder al primer día.';
  end if;

  insert into public.monthly_plans(household_id, month, status)
    values (p_household_id, p_month, 'open')
    on conflict (household_id, month) do nothing;

  select mp.id into plan_id
  from public.monthly_plans mp
  where mp.household_id = p_household_id and mp.month = p_month;

  if exists (
    select 1 from public.monthly_plans mp
    where mp.id = plan_id and mp.status = 'closed'
  ) then
    return;
  end if;

  insert into public.monthly_plan_incomes(
    household_id, monthly_plan_id, month, description, member_name,
    planned_amount, member_id, template_id, income_type
  )
  select it.household_id, plan_id, p_month, it.description, fm.name,
    it.default_amount, it.member_id, it.id, 'regular'
  from public.income_templates it
  join public.family_members fm
    on fm.id = it.member_id and fm.household_id = it.household_id
  where it.household_id = p_household_id
    and it.is_active
    and it.start_month <= p_month
    and (it.end_month is null or it.end_month >= p_month)
  on conflict (household_id, monthly_plan_id, template_id)
    where template_id is not null do nothing;
end;
$$;

revoke all on function public.prepare_monthly_income_plan(uuid, date) from public;
grant execute on function public.prepare_monthly_income_plan(uuid, date) to authenticated;
