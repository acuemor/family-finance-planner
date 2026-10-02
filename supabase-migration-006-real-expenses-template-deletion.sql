-- Family Finance Planner · migración 006
-- Gastos reales vinculados a partidas presupuestarias y eliminación segura de plantillas.
-- Ejecutar UNA VEZ después de la migración 005.

alter table public.account_transactions
  add column if not exists monthly_plan_item_id uuid references public.monthly_plan_items(id) on delete set null;

drop policy if exists transactions_insert on public.account_transactions;
create policy transactions_insert on public.account_transactions
  for insert to authenticated
  with check (public.is_household_member(household_id) and monthly_plan_item_id is null);

drop policy if exists transactions_update on public.account_transactions;
create policy transactions_update on public.account_transactions
  for update to authenticated
  using (public.is_household_member(household_id) and monthly_plan_item_id is null)
  with check (public.is_household_member(household_id) and monthly_plan_item_id is null);

drop policy if exists transactions_delete on public.account_transactions;
create policy transactions_delete on public.account_transactions
  for delete to authenticated
  using (public.is_household_member(household_id) and monthly_plan_item_id is null);

create index if not exists account_transactions_budget_item_idx
  on public.account_transactions(household_id, monthly_plan_item_id)
  where monthly_plan_item_id is not null;

create or replace function public.register_budget_expense(
  p_household_id uuid,
  p_item_id uuid,
  p_account_id uuid,
  p_description text,
  p_amount numeric,
  p_transaction_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.monthly_plan_items%rowtype;
  v_transaction_id uuid;
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) then
    raise exception 'No tienes acceso a este hogar.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El importe debe ser mayor que cero.';
  end if;
  if char_length(trim(coalesce(p_description, ''))) not between 1 and 160 then
    raise exception 'El concepto debe tener entre 1 y 160 caracteres.';
  end if;
  if p_transaction_date is null then
    raise exception 'Indica la fecha del gasto.';
  end if;

  select i.* into v_item
  from public.monthly_plan_items i
  join public.monthly_plans mp on mp.id = i.monthly_plan_id and mp.household_id = i.household_id
  where i.id = p_item_id
    and i.household_id = p_household_id
    and i.item_type in ('fixed_expense', 'variable_expense')
    and mp.status = 'open'
  for update of i, mp;

  if not found then
    raise exception 'La partida no existe, no es un gasto o pertenece a un mes cerrado.';
  end if;
  if date_trunc('month', p_transaction_date)::date <> v_item.month then
    raise exception 'La fecha del gasto debe pertenecer al mes de la partida seleccionada.';
  end if;
  if not exists (
    select 1 from public.accounts a
    where a.id = p_account_id and a.household_id = p_household_id and a.is_active
  ) then
    raise exception 'Selecciona una cuenta activa de este hogar.';
  end if;

  insert into public.account_transactions(
    household_id, account_id, transaction_type, description, amount,
    transaction_date, monthly_plan_item_id
  ) values (
    p_household_id, p_account_id, 'expense', trim(p_description), p_amount,
    p_transaction_date, p_item_id
  ) returning id into v_transaction_id;

  update public.monthly_plan_items
  set actual_amount = coalesce(actual_amount, 0) + p_amount
  where id = p_item_id and household_id = p_household_id;

  return v_transaction_id;
end;
$$;

create or replace function public.delete_budget_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;
  select bt.household_id into v_household_id
  from public.budget_templates bt
  where bt.id = p_template_id;
  if not found or not public.is_household_member(v_household_id) then
    raise exception 'No tienes acceso a esta plantilla.';
  end if;

  -- Desvincula la plantilla sin borrar las fotografías mensuales ya creadas.
  update public.monthly_plan_items
  set template_id = null
  where household_id = v_household_id and template_id = p_template_id;

  delete from public.budget_templates
  where id = p_template_id and household_id = v_household_id;
end;
$$;

revoke all on function public.register_budget_expense(uuid, uuid, uuid, text, numeric, date) from public;
revoke all on function public.delete_budget_template(uuid) from public;
grant execute on function public.register_budget_expense(uuid, uuid, uuid, text, numeric, date) to authenticated;
grant execute on function public.delete_budget_template(uuid) to authenticated;
