-- Family Finance Planner · esquema inicial
-- Ejecutar en Supabase SQL Editor después de revisar el README.
create extension if not exists pgcrypto;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  unique (household_id, id),
  unique (household_id, auth_user_id),
  unique (auth_user_id)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  account_type text not null check (account_type in ('common','individual')),
  owner_member_id uuid,
  initial_balance numeric(12,2) not null default 0 check (initial_balance >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, owner_member_id) references public.family_members(household_id, id),
  check ((account_type = 'common' and owner_member_id is null) or (account_type = 'individual' and owner_member_id is not null))
);

create table public.monthly_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (household_id, month),
  unique (household_id, id),
  unique (household_id, id, month)
);

create table public.monthly_plan_incomes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  monthly_plan_id uuid not null,
  month date not null,
  description text not null check (char_length(trim(description)) between 1 and 100),
  member_name text not null check (char_length(trim(member_name)) between 1 and 80),
  planned_amount numeric(12,2) not null check (planned_amount > 0),
  actual_amount numeric(12,2),
  created_at timestamptz not null default now(),
  foreign key (household_id, monthly_plan_id, month) references public.monthly_plans(household_id, id, month) on delete cascade,
  check (actual_amount is null or actual_amount >= 0)
);

create table public.monthly_plan_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  monthly_plan_id uuid not null,
  month date not null,
  name text not null check (char_length(trim(name)) between 1 and 100),
  item_type text not null check (item_type in ('fixed_expense','variable_expense','sinking_fund','common_saving','individual_saving','additional_allocation')),
  planned_amount numeric(12,2) not null check (planned_amount > 0),
  actual_amount numeric(12,2),
  destination_account_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (household_id, monthly_plan_id, month) references public.monthly_plans(household_id, id, month) on delete cascade,
  foreign key (household_id, destination_account_id) references public.accounts(household_id, id),
  check (actual_amount is null or actual_amount >= 0)
);

create table public.account_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  account_id uuid not null,
  transaction_date date not null default current_date,
  transaction_type text not null check (transaction_type in ('income','expense','transfer_in','transfer_out','adjustment')),
  amount numeric(12,2) not null check (amount > 0),
  description text not null check (char_length(trim(description)) between 1 and 160),
  related_transaction_id uuid,
  created_at timestamptz not null default now(),
  foreign key (household_id, account_id) references public.accounts(household_id, id),
  foreign key (related_transaction_id) references public.account_transactions(id)
);

create index family_members_auth_user_idx on public.family_members(auth_user_id);
create index monthly_plan_items_plan_idx on public.monthly_plan_items(household_id, monthly_plan_id);
create index monthly_plan_incomes_plan_idx on public.monthly_plan_incomes(household_id, monthly_plan_id);
create index account_transactions_account_date_idx on public.account_transactions(household_id, account_id, transaction_date);

create or replace function public.is_household_member(p_household_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.family_members fm
    where fm.household_id = p_household_id and fm.auth_user_id = (select auth.uid())
  );
$$;

create or replace function public.is_household_owner(p_household_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.family_members fm
    where fm.household_id = p_household_id and fm.auth_user_id = (select auth.uid()) and fm.role = 'owner'
  );
$$;

create or replace function public.create_household(p_household_name text, p_member_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  new_household_id uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;
  if char_length(trim(coalesce(p_household_name, ''))) not between 1 and 80 then raise exception 'Nombre del hogar no válido.'; end if;
  if char_length(trim(coalesce(p_member_name, ''))) not between 1 and 80 then raise exception 'Nombre de usuario no válido.'; end if;
  if exists (select 1 from public.family_members where auth_user_id = auth.uid()) then raise exception 'Este usuario ya pertenece a un hogar.'; end if;
  insert into public.households(name) values (trim(p_household_name)) returning id into new_household_id;
  insert into public.family_members(household_id, auth_user_id, name, role)
  values (new_household_id, auth.uid(), trim(p_member_name), 'owner');
  return new_household_id;
end;
$$;

-- RLS: ningún dato financiero es accesible fuera del hogar del usuario.
alter table public.households enable row level security;
alter table public.family_members enable row level security;
alter table public.accounts enable row level security;
alter table public.monthly_plans enable row level security;
alter table public.monthly_plan_incomes enable row level security;
alter table public.monthly_plan_items enable row level security;
alter table public.account_transactions enable row level security;

create policy households_select on public.households for select to authenticated using (public.is_household_member(id));
create policy households_update on public.households for update to authenticated using (public.is_household_owner(id)) with check (public.is_household_owner(id));

create policy family_members_select on public.family_members for select to authenticated using (public.is_household_member(household_id));
-- No se habilita INSERT/UPDATE/DELETE de miembros desde el cliente. La invitación del segundo miembro
-- se implementará mediante un flujo controlado en una siguiente entrega.

create policy accounts_select on public.accounts for select to authenticated using (public.is_household_member(household_id));
create policy accounts_insert on public.accounts for insert to authenticated with check (public.is_household_member(household_id));
create policy accounts_update on public.accounts for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy accounts_delete on public.accounts for delete to authenticated using (public.is_household_member(household_id));

create policy monthly_plans_select on public.monthly_plans for select to authenticated using (public.is_household_member(household_id));
create policy monthly_plans_insert on public.monthly_plans for insert to authenticated with check (public.is_household_member(household_id));
create policy monthly_plans_update on public.monthly_plans for update to authenticated using (public.is_household_member(household_id) and status = 'open') with check (public.is_household_member(household_id));

create policy incomes_select on public.monthly_plan_incomes for select to authenticated using (public.is_household_member(household_id));
create policy incomes_insert on public.monthly_plan_incomes for insert to authenticated with check (public.is_household_member(household_id) and exists (select 1 from public.monthly_plans mp where mp.id = monthly_plan_id and mp.household_id = household_id and mp.status = 'open'));
create policy incomes_update on public.monthly_plan_incomes for update to authenticated using (public.is_household_member(household_id) and exists (select 1 from public.monthly_plans mp where mp.id = monthly_plan_id and mp.household_id = household_id and mp.status = 'open')) with check (public.is_household_member(household_id) and exists (select 1 from public.monthly_plans mp where mp.id = monthly_plan_id and mp.household_id = household_id and mp.status = 'open'));
create policy incomes_delete on public.monthly_plan_incomes for delete to authenticated using (public.is_household_member(household_id) and exists (select 1 from public.monthly_plans mp where mp.id = monthly_plan_id and mp.household_id = household_id and mp.status = 'open'));

create policy items_select on public.monthly_plan_items for select to authenticated using (public.is_household_member(household_id));
create policy items_insert on public.monthly_plan_items for insert to authenticated with check (public.is_household_member(household_id) and exists (select 1 from public.monthly_plans mp where mp.id = monthly_plan_id and mp.household_id = household_id and mp.status = 'open'));
create policy items_update on public.monthly_plan_items for update to authenticated using (public.is_household_member(household_id) and exists (select 1 from public.monthly_plans mp where mp.id = monthly_plan_id and mp.household_id = household_id and mp.status = 'open')) with check (public.is_household_member(household_id) and exists (select 1 from public.monthly_plans mp where mp.id = monthly_plan_id and mp.household_id = household_id and mp.status = 'open'));
create policy items_delete on public.monthly_plan_items for delete to authenticated using (public.is_household_member(household_id) and exists (select 1 from public.monthly_plans mp where mp.id = monthly_plan_id and mp.household_id = household_id and mp.status = 'open'));

create policy transactions_select on public.account_transactions for select to authenticated using (public.is_household_member(household_id));
create policy transactions_insert on public.account_transactions for insert to authenticated with check (public.is_household_member(household_id));
create policy transactions_update on public.account_transactions for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy transactions_delete on public.account_transactions for delete to authenticated using (public.is_household_member(household_id));

revoke all on function public.create_household(text, text) from public;
grant execute on function public.create_household(text, text) to authenticated;
revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.is_household_owner(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;

grant select, update on public.households to authenticated;
grant select on public.family_members to authenticated;
grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.monthly_plans to authenticated;
grant select, insert, update, delete on public.monthly_plan_incomes to authenticated;
grant select, insert, update, delete on public.monthly_plan_items to authenticated;
grant select, insert, update, delete on public.account_transactions to authenticated;
