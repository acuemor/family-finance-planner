-- Family Finance Planner · migración 003
-- Ejecutar UNA VEZ en Supabase SQL Editor sobre el proyecto ya existente.
-- Añade vinculación segura de miembros e ingresos habituales con copia mensual.

create table if not exists public.income_templates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null,
  description text not null check (char_length(trim(description)) between 1 and 100),
  default_amount numeric(12,2) not null check (default_amount > 0),
  start_month date not null default date_trunc('month', current_date)::date check (extract(day from start_month) = 1),
  end_month date check (end_month is null or (extract(day from end_month) = 1 and end_month >= start_month)),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, member_id) references public.family_members(household_id, id)
);

alter table public.monthly_plan_incomes
  add column if not exists member_id uuid,
  add column if not exists template_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'monthly_plan_incomes_member_fk') then
    alter table public.monthly_plan_incomes add constraint monthly_plan_incomes_member_fk
      foreign key (household_id, member_id) references public.family_members(household_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'monthly_plan_incomes_template_fk') then
    alter table public.monthly_plan_incomes add constraint monthly_plan_incomes_template_fk
      foreign key (household_id, template_id) references public.income_templates(household_id, id);
  end if;
end $$;

create unique index if not exists monthly_plan_income_template_once
  on public.monthly_plan_incomes(household_id, monthly_plan_id, template_id)
  where template_id is not null;
create index if not exists income_templates_household_active_idx
  on public.income_templates(household_id, is_active, start_month, end_month);

alter table public.income_templates enable row level security;
drop policy if exists income_templates_select on public.income_templates;
drop policy if exists income_templates_insert on public.income_templates;
drop policy if exists income_templates_update on public.income_templates;
drop policy if exists income_templates_delete on public.income_templates;
create policy income_templates_select on public.income_templates
  for select to authenticated using (public.is_household_member(household_id));
create policy income_templates_insert on public.income_templates
  for insert to authenticated with check (
    public.is_household_member(household_id)
    and exists (select 1 from public.family_members fm where fm.id = member_id and fm.household_id = income_templates.household_id)
  );
create policy income_templates_update on public.income_templates
  for update to authenticated using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id) and exists (
    select 1 from public.family_members fm where fm.id = member_id and fm.household_id = income_templates.household_id
  ));
create policy income_templates_delete on public.income_templates
  for delete to authenticated using (public.is_household_member(household_id));
grant select, insert, update, delete on public.income_templates to authenticated;

-- El administrador vincula un usuario que ya se ha registrado en Supabase Auth.
-- La búsqueda del correo se ejecuta en servidor: el navegador no recibe acceso a auth.users.
create or replace function public.add_existing_user_to_household(
  p_household_id uuid, p_email text, p_member_name text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target_user_id uuid; new_member_id uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  if not public.is_household_owner(p_household_id) then raise exception 'Solo el administrador puede añadir miembros.'; end if;
  if char_length(trim(coalesce(p_email, ''))) not between 3 and 254 or position('@' in p_email) < 2 then
    raise exception 'Introduce un correo electrónico válido.';
  end if;
  if char_length(trim(coalesce(p_member_name, ''))) not between 1 and 80 then
    raise exception 'Introduce un nombre válido.';
  end if;
  select u.id into target_user_id from auth.users u
    where lower(u.email) = lower(trim(p_email)) and u.deleted_at is null
      and u.email_confirmed_at is not null limit 1;
  if target_user_id is null then raise exception 'No existe una cuenta confirmada con ese correo. La persona debe registrarse y confirmar su email primero.'; end if;
  if target_user_id = auth.uid() then raise exception 'Tu usuario ya pertenece a este hogar.'; end if;
  if exists (select 1 from public.family_members fm where fm.auth_user_id = target_user_id) then
    raise exception 'Ese usuario ya pertenece a un hogar.';
  end if;
  insert into public.family_members(household_id, auth_user_id, name, role)
    values (p_household_id, target_user_id, trim(p_member_name), 'member') returning id into new_member_id;
  return new_member_id;
end;
$$;

-- Copia los ingresos habituales al mes solicitado sin sobrescribir importes ya ajustados.
create or replace function public.prepare_monthly_income_plan(p_household_id uuid, p_month date)
returns void language plpgsql security definer set search_path = '' as $$
declare plan_id uuid;
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) then
    raise exception 'No tienes acceso a este hogar.';
  end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'El mes debe corresponder al primer día.'; end if;
  insert into public.monthly_plans(household_id, month, status)
    values (p_household_id, p_month, 'open')
    on conflict (household_id, month) do nothing;
  select mp.id into plan_id from public.monthly_plans mp
    where mp.household_id = p_household_id and mp.month = p_month;
  if exists (select 1 from public.monthly_plans mp where mp.id = plan_id and mp.status = 'closed') then
    return;
  end if;
  insert into public.monthly_plan_incomes(
    household_id, monthly_plan_id, month, description, member_name,
    planned_amount, member_id, template_id
  )
  select it.household_id, plan_id, p_month, it.description, fm.name,
    it.default_amount, it.member_id, it.id
  from public.income_templates it
  join public.family_members fm on fm.id = it.member_id and fm.household_id = it.household_id
  where it.household_id = p_household_id and it.is_active
    and it.start_month <= p_month and (it.end_month is null or it.end_month >= p_month)
  on conflict (household_id, monthly_plan_id, template_id) where template_id is not null do nothing;
end;
$$;

revoke all on function public.add_existing_user_to_household(uuid, text, text) from public;
revoke all on function public.prepare_monthly_income_plan(uuid, date) from public;
grant execute on function public.add_existing_user_to_household(uuid, text, text) to authenticated;
grant execute on function public.prepare_monthly_income_plan(uuid, date) to authenticated;

-- Las plantillas se pueden consultar/gestionar desde la app; los meses ya generados
-- conservan su propia fotografía y no cambian al editar una plantilla.
