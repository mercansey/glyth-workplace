-- External communications (Unipile) + devices. Personal, RLS owner-only.
-- Completely separate from Ask Glyth conversation_threads/messages.
create table if not exists public.communication_accounts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, unipile_account_id text not null,
  provider text not null check (provider in ('instagram','linkedin','whatsapp')), status text not null default 'connected',
  display_name text, connected_at timestamptz default now(), last_synced_at timestamptz, metadata_safe jsonb default '{}',
  created_at timestamptz default now(), updated_at timestamptz default now(), unique (user_id, unipile_account_id));
create table if not exists public.communication_threads (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, account_id uuid references public.communication_accounts(id) on delete cascade,
  provider text not null, provider_chat_id text not null, title text, avatar_url text, last_message_at timestamptz,
  last_inbound_at timestamptz, last_outbound_at timestamptz, unread_count int not null default 0, needs_reply boolean not null default false,
  original_url text, created_at timestamptz default now(), updated_at timestamptz default now(), unique (user_id, provider, provider_chat_id));
create table if not exists public.communication_messages (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, thread_id uuid references public.communication_threads(id) on delete cascade,
  provider_message_id text not null, direction text not null check (direction in ('inbound','outbound')), sender_name text, sender_provider_id text,
  body text, caption text, content_type text default 'text', attachment_metadata jsonb default '[]', sent_at timestamptz, received_at timestamptz default now(),
  reply_to_message_id text, original_url text, created_at timestamptz default now(), unique (user_id, thread_id, provider_message_id));
create table if not exists public.communication_attendees (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, thread_id uuid references public.communication_threads(id) on delete cascade,
  provider_attendee_id text, display_name text, created_at timestamptz default now());
create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, platform text not null default 'ios', token text not null,
  environment text not null default 'production', last_seen_at timestamptz default now(), active boolean not null default true,
  created_at timestamptz default now(), unique (user_id, token));
create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, platform text not null, device_identifier_hash text,
  app_version text, os_version text, push_enabled boolean default false, last_seen_at timestamptz default now(), unique (user_id, device_identifier_hash));
create index if not exists comm_threads_user_recent_idx on public.communication_threads(user_id, last_message_at desc);
create index if not exists comm_messages_thread_time_idx on public.communication_messages(thread_id, sent_at);
create index if not exists comm_messages_user_time_idx on public.communication_messages(user_id, sent_at desc);
do $$ declare t text; begin for t in select unnest(array['communication_accounts','communication_threads','communication_messages','communication_attendees','device_push_tokens','user_devices']) loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy "owner all" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
end loop; end $$;
