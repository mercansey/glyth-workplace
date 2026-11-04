-- Fix: (1) organisations policy used an ambiguous unqualified `id`;
-- (2) organisation_members policy referenced its own table, which causes
-- infinite RLS recursion. A SECURITY DEFINER helper with a constrained
-- search_path performs the admin membership check without recursion.
create or replace function public.is_org_admin_for(org uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organisation_members m where m.organisation_id = org and m.user_id = uid and m.role in ('owner','admin'));
$$;
revoke all on function public.is_org_admin_for(uuid, uuid) from public;
grant execute on function public.is_org_admin_for(uuid, uuid) to authenticated;

drop policy if exists "org member read" on public.organisations;
create policy "org member read" on public.organisations for select
  using (exists (select 1 from public.organisation_members m where m.organisation_id = organisations.id and m.user_id = auth.uid()));

drop policy if exists "member read own membership" on public.organisation_members;
create policy "member read own membership" on public.organisation_members for select
  using (user_id = auth.uid() or public.is_org_admin_for(organisation_id, auth.uid()));
