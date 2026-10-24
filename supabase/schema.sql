-- HostelSplit cloud schema for Supabase.
-- Run this whole file in the Supabase SQL Editor for the project you intend to use.
-- All public tables have RLS enabled; only authenticated group members can read group data.

create extension if not exists pgcrypto;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  created_by uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10)),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  monthly_budget numeric(12,2) not null default 0 check (monthly_budget >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Member' check (char_length(trim(display_name)) between 1 and 80),
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 180),
  amount numeric(12,2) not null check (amount > 0),
  paid_by uuid not null references auth.users(id),
  category text not null default 'Other' check (category in ('Food','Travel','Hotel','Shopping','Entertainment','Utilities','Supplies','Other')),
  split_type text not null default 'equal' check (split_type in ('equal','exact','percentage')),
  expense_date date not null default current_date,
  receipt_path text,
  receipt_text text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  share_amount numeric(12,2) not null check (share_amount >= 0),
  unique (expense_id, user_id)
);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  from_user uuid not null references auth.users(id),
  to_user uuid not null references auth.users(id),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'paid' check (status in ('pending','paid','cancelled')),
  paid_at timestamptz,
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  category text not null default 'All' check (category in ('All','Food','Travel','Hotel','Shopping','Entertainment','Utilities','Supplies','Other')),
  amount numeric(12,2) not null check (amount >= 0),
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (group_id, month, category)
);

create index if not exists idx_group_members_user on public.group_members(user_id, group_id);
create index if not exists idx_expenses_group_date on public.expenses(group_id, expense_date desc);
create index if not exists idx_expense_splits_user on public.expense_splits(user_id, expense_id);
create index if not exists idx_settlements_group_date on public.settlements(group_id, created_at desc);
create index if not exists idx_budgets_group_month on public.budgets(group_id, month);

create or replace function public.hostelsplit_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expenses_touch_updated_at on public.expenses;
create trigger expenses_touch_updated_at before update on public.expenses
for each row execute function public.hostelsplit_touch_updated_at();

drop trigger if exists budgets_touch_updated_at on public.budgets;
create trigger budgets_touch_updated_at before update on public.budgets
for each row execute function public.hostelsplit_touch_updated_at();

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;
alter table public.budgets enable row level security;

-- Keep RLS helpers in a non-exposed schema to avoid recursive group_members policies.
-- Do not add the private schema to the Supabase Data API exposed schemas list.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.hostelsplit_is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
  );
$$;

create or replace function private.hostelsplit_is_group_owner(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
      and gm.role = 'owner'
  );
$$;

create or replace function private.hostelsplit_can_share_with_user(p_group_id uuid, p_target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.group_members actor
      join public.group_members target on target.group_id = actor.group_id
      where actor.group_id = p_group_id
        and actor.user_id = (select auth.uid())
        and target.user_id = p_target_user_id
    );
$$;

revoke all on function private.hostelsplit_is_group_member(uuid) from public, anon;
revoke all on function private.hostelsplit_is_group_owner(uuid) from public, anon;
revoke all on function private.hostelsplit_can_share_with_user(uuid, uuid) from public, anon;
grant execute on function private.hostelsplit_is_group_member(uuid) to authenticated;
grant execute on function private.hostelsplit_is_group_owner(uuid) to authenticated;
grant execute on function private.hostelsplit_can_share_with_user(uuid, uuid) to authenticated;

-- Groups: creators see new groups; members see only their shared groups.
drop policy if exists "groups_read_members" on public.groups;
create policy "groups_read_members" on public.groups for select to authenticated
using (
  created_by = (select auth.uid())
  or (select private.hostelsplit_is_group_member(id))
);

drop policy if exists "groups_create_self" on public.groups;
create policy "groups_create_self" on public.groups for insert to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists "groups_update_owner" on public.groups;
create policy "groups_update_owner" on public.groups for update to authenticated
using ((select private.hostelsplit_is_group_owner(id)))
with check (
  created_by = (select auth.uid())
  and (select private.hostelsplit_is_group_owner(id))
);

drop policy if exists "groups_delete_owner" on public.groups;
create policy "groups_delete_owner" on public.groups for delete to authenticated
using ((select private.hostelsplit_is_group_owner(id)));

-- Group members: an authenticated member can see others in that same group.
drop policy if exists "members_read_group" on public.group_members;
create policy "members_read_group" on public.group_members for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.hostelsplit_is_group_member(group_id))
);

drop policy if exists "members_owner_add" on public.group_members;
create policy "members_owner_add" on public.group_members for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.groups g
    where g.id = group_members.group_id
      and g.created_by = (select auth.uid())
  )
);

drop policy if exists "members_self_leave_or_owner_manage" on public.group_members;
create policy "members_self_leave_or_owner_manage" on public.group_members for delete to authenticated
using (
  user_id = (select auth.uid())
  or (select private.hostelsplit_is_group_owner(group_id))
);

-- Joining uses a narrowly scoped invite-code function. The function checks auth.uid()
-- and only adds the caller to the exact group that owns the supplied valid code.
create or replace function public.join_hostelsplit_group(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_group_id uuid;
  v_display_name text;
begin
  if v_user_id is null then
    raise exception 'Sign in before joining a group.';
  end if;
  if p_invite_code is null or length(trim(p_invite_code)) < 6 then
    raise exception 'Enter a valid invite code.';
  end if;

  select g.id into v_group_id
  from public.groups g
  where g.invite_code = upper(trim(p_invite_code));

  if v_group_id is null then
    raise exception 'No group was found for that invite code.';
  end if;

  select coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
    split_part(u.email, '@', 1),
    'Member'
  )
  into v_display_name
  from auth.users u
  where u.id = v_user_id;

  insert into public.group_members(group_id, user_id, display_name, role)
  values (v_group_id, v_user_id, left(v_display_name, 80), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group_id;
end;
$$;

revoke all on function public.join_hostelsplit_group(text) from public, anon;
grant execute on function public.join_hostelsplit_group(text) to authenticated;

-- Expense rows are isolated by membership; the payer must belong to the same group.
drop policy if exists "expenses_read_group" on public.expenses;
create policy "expenses_read_group" on public.expenses for select to authenticated
using ((select private.hostelsplit_is_group_member(group_id)));

drop policy if exists "expenses_create_member" on public.expenses;
create policy "expenses_create_member" on public.expenses for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.hostelsplit_is_group_member(group_id))
  and (select private.hostelsplit_can_share_with_user(group_id, paid_by))
);

drop policy if exists "expenses_update_member" on public.expenses;
create policy "expenses_update_member" on public.expenses for update to authenticated
using ((select private.hostelsplit_is_group_member(group_id)))
with check (
  (select private.hostelsplit_is_group_member(group_id))
  and (select private.hostelsplit_can_share_with_user(group_id, paid_by))
);

drop policy if exists "expenses_delete_member" on public.expenses;
create policy "expenses_delete_member" on public.expenses for delete to authenticated
using ((select private.hostelsplit_is_group_member(group_id)));

-- Splits can only refer to users who belong to the same expense group.
drop policy if exists "splits_read_group" on public.expense_splits;
create policy "splits_read_group" on public.expense_splits for select to authenticated
using (exists (
  select 1 from public.expenses e
  where e.id = expense_splits.expense_id
    and (select private.hostelsplit_is_group_member(e.group_id))
));

drop policy if exists "splits_add_member" on public.expense_splits;
create policy "splits_add_member" on public.expense_splits for insert to authenticated
with check (exists (
  select 1 from public.expenses e
  where e.id = expense_splits.expense_id
    and (select private.hostelsplit_can_share_with_user(e.group_id, expense_splits.user_id))
));

drop policy if exists "splits_update_member" on public.expense_splits;
create policy "splits_update_member" on public.expense_splits for update to authenticated
using (exists (
  select 1 from public.expenses e
  where e.id = expense_splits.expense_id
    and (select private.hostelsplit_is_group_member(e.group_id))
))
with check (exists (
  select 1 from public.expenses e
  where e.id = expense_splits.expense_id
    and (select private.hostelsplit_can_share_with_user(e.group_id, expense_splits.user_id))
));

drop policy if exists "splits_delete_member" on public.expense_splits;
create policy "splits_delete_member" on public.expense_splits for delete to authenticated
using (exists (
  select 1 from public.expenses e
  where e.id = expense_splits.expense_id
    and (select private.hostelsplit_is_group_member(e.group_id))
));

-- Settlements: both endpoints must be members of the corresponding group.
drop policy if exists "settlements_read_group" on public.settlements;
create policy "settlements_read_group" on public.settlements for select to authenticated
using ((select private.hostelsplit_is_group_member(group_id)));

drop policy if exists "settlements_add_member" on public.settlements;
create policy "settlements_add_member" on public.settlements for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.hostelsplit_is_group_member(group_id))
  and (select private.hostelsplit_can_share_with_user(group_id, from_user))
  and (select private.hostelsplit_can_share_with_user(group_id, to_user))
);

drop policy if exists "settlements_update_member" on public.settlements;
create policy "settlements_update_member" on public.settlements for update to authenticated
using ((select private.hostelsplit_is_group_member(group_id)))
with check (
  (select private.hostelsplit_is_group_member(group_id))
  and (select private.hostelsplit_can_share_with_user(group_id, from_user))
  and (select private.hostelsplit_can_share_with_user(group_id, to_user))
);

drop policy if exists "settlements_delete_member" on public.settlements;
create policy "settlements_delete_member" on public.settlements for delete to authenticated
using ((select private.hostelsplit_is_group_member(group_id)));

-- Only the group owner may change budgets.
drop policy if exists "budgets_read_group" on public.budgets;
create policy "budgets_read_group" on public.budgets for select to authenticated
using ((select private.hostelsplit_is_group_member(group_id)));

drop policy if exists "budgets_owner_write" on public.budgets;
create policy "budgets_owner_write" on public.budgets for all to authenticated
using ((select private.hostelsplit_is_group_owner(group_id)))
with check (
  created_by = (select auth.uid())
  and (select private.hostelsplit_is_group_owner(group_id))
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.groups, public.group_members, public.expenses, public.expense_splits, public.settlements, public.budgets to authenticated;

-- Receipt storage is private. Paths must be: <auth-user-uuid>/<group-uuid>/<filename>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 12582912, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 12582912, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "receipt_read_group_members" on storage.objects;
create policy "receipt_read_group_members" on storage.objects for select to authenticated
using (
  bucket_id = 'receipts'
  and exists (
    select 1 from public.group_members gm
    where gm.group_id::text = (storage.foldername(name))[2]
      and gm.user_id = (select auth.uid())
  )
);

drop policy if exists "receipt_upload_own_path" on storage.objects;
create policy "receipt_upload_own_path" on storage.objects for insert to authenticated
with check (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.group_members gm
    where gm.group_id::text = (storage.foldername(name))[2]
      and gm.user_id = (select auth.uid())
  )
);

drop policy if exists "receipt_update_own_path" on storage.objects;
create policy "receipt_update_own_path" on storage.objects for update to authenticated
using (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.group_members gm
    where gm.group_id::text = (storage.foldername(name))[2]
      and gm.user_id = (select auth.uid())
  )
);

drop policy if exists "receipt_delete_own_path" on storage.objects;
create policy "receipt_delete_own_path" on storage.objects for delete to authenticated
using (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

