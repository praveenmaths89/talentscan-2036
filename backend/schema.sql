-- KhelTara screening store
-- Free to run: Supabase free project, or any Postgres you already have.
-- Feature summaries only. There is no column for video, frames, or raw PPG.
-- Screening for referral, not selection. Norms stay provisional until a new study.

create extension if not exists pgcrypto;

create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('school', 'club', 'federation')),
  parent_id uuid references public.organisations (id) on delete set null,
  region text,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key,
  display_name text not null,
  phone text,
  email text,
  language text not null default 'en',
  mode text not null default 'casual' check (mode in ('casual', 'athlete')),
  invite_code text not null unique,
  invited_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.guardians (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade
);

create table if not exists public.athletes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  display_name text not null,
  sex text check (sex in ('F', 'M', 'X')),
  age_years numeric,
  height_cm numeric,
  weight_kg numeric,
  sitting_height_cm numeric,
  maturity_offset numeric,
  sport text,
  verification text not null default 'self-tested' check (verification in ('self-tested', 'centre-verified')),
  organisation_id uuid references public.organisations (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.guardian_athletes (
  guardian_id uuid not null references public.guardians (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  consent_at timestamptz not null,
  consent_statement text not null,
  consent_method text not null default 'in_app_checkbox',
  primary key (guardian_id, athlete_id)
);

create table if not exists public.org_members (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null check (role in (
    'federation_admin', 'club_admin', 'school_admin', 'coach', 'teacher', 'athlete', 'guardian'
  )),
  primary key (organisation_id, user_id)
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  mode text not null check (mode in ('casual', 'athlete')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  qc_summary jsonb not null default '{}'::jsonb
);

create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  test_code text not null,
  metrics jsonb not null default '{}'::jsonb,
  qc jsonb not null default '{}'::jsonb,
  percentile numeric,
  norms_label text not null default 'provisional norms, not validated',
  created_at timestamptz not null default now()
);

create table if not exists public.trials (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  trial_index int not null,
  features jsonb not null default '{}'::jsonb,
  qc_pass boolean not null default false
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.users (id) on delete cascade,
  code text not null,
  invitee_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table if not exists public.nominations (
  id uuid primary key default gen_random_uuid(),
  nominator_id uuid not null references public.users (id) on delete cascade,
  nominee_name text not null,
  contact text,
  under_18 boolean not null default false,
  consent_attested boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'joined', 'qc', 'declined')),
  created_at timestamptz not null default now(),
  check (consent_attested)
);

create table if not exists public.badges (
  user_id uuid not null references public.users (id) on delete cascade,
  badge_code text not null,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_code)
);

create index if not exists sessions_athlete_idx on public.sessions (athlete_id, started_at desc);
create index if not exists invites_code_idx on public.invites (code);
create index if not exists tests_session_idx on public.tests (session_id);

alter table public.organisations enable row level security;
alter table public.users enable row level security;
alter table public.guardians enable row level security;
alter table public.athletes enable row level security;
alter table public.guardian_athletes enable row level security;
alter table public.org_members enable row level security;
alter table public.sessions enable row level security;
alter table public.tests enable row level security;
alter table public.trials enable row level security;
alter table public.invites enable row level security;
alter table public.nominations enable row level security;
alter table public.badges enable row level security;

create or replace function public.is_org_staff(org uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.org_members m
    where m.organisation_id = org
      and m.user_id = auth.uid()
      and m.role in ('federation_admin', 'club_admin', 'school_admin', 'coach', 'teacher')
  );
$$;

create or replace function public.can_see_athlete(athlete uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.athletes a
    where a.id = athlete
      and (
        a.user_id = auth.uid()
        or (a.organisation_id is not null and public.is_org_staff(a.organisation_id))
        or exists (
          select 1
          from public.guardian_athletes ga
          join public.guardians g on g.id = ga.guardian_id
          where ga.athlete_id = a.id and g.user_id = auth.uid()
        )
      )
  );
$$;

drop policy if exists users_self on public.users;
create policy users_self on public.users
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists guardians_self on public.guardians;
create policy guardians_self on public.guardians
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists athletes_visible on public.athletes;
create policy athletes_visible on public.athletes
  for select using (public.can_see_athlete(id));

drop policy if exists athletes_insert_self on public.athletes;
create policy athletes_insert_self on public.athletes
  for insert with check (user_id = auth.uid() or user_id is null);

drop policy if exists athletes_update_self on public.athletes;
create policy athletes_update_self on public.athletes
  for update using (user_id = auth.uid() or public.can_see_athlete(id));

drop policy if exists guardian_link_self on public.guardian_athletes;
create policy guardian_link_self on public.guardian_athletes
  for all using (
    exists (
      select 1 from public.guardians g
      where g.id = guardian_id and g.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.guardians g
      where g.id = guardian_id and g.user_id = auth.uid()
    )
  );

drop policy if exists org_member_read on public.org_members;
create policy org_member_read on public.org_members
  for select using (user_id = auth.uid() or public.is_org_staff(organisation_id));

drop policy if exists sessions_rw on public.sessions;
create policy sessions_rw on public.sessions
  for all using (public.can_see_athlete(athlete_id))
  with check (public.can_see_athlete(athlete_id));

drop policy if exists tests_rw on public.tests;
create policy tests_rw on public.tests
  for all using (
    exists (
      select 1 from public.sessions s
      where s.id = session_id and public.can_see_athlete(s.athlete_id)
    )
  ) with check (
    exists (
      select 1 from public.sessions s
      where s.id = session_id and public.can_see_athlete(s.athlete_id)
    )
  );

drop policy if exists trials_rw on public.trials;
create policy trials_rw on public.trials
  for all using (
    exists (
      select 1 from public.tests t
      join public.sessions s on s.id = t.session_id
      where t.id = test_id and public.can_see_athlete(s.athlete_id)
    )
  ) with check (
    exists (
      select 1 from public.tests t
      join public.sessions s on s.id = t.session_id
      where t.id = test_id and public.can_see_athlete(s.athlete_id)
    )
  );

drop policy if exists invites_own on public.invites;
create policy invites_own on public.invites
  for all using (inviter_id = auth.uid() or invitee_id = auth.uid())
  with check (inviter_id = auth.uid());

drop policy if exists nominations_own on public.nominations;
create policy nominations_own on public.nominations
  for all using (nominator_id = auth.uid())
  with check (nominator_id = auth.uid() and consent_attested);

drop policy if exists badges_own on public.badges;
create policy badges_own on public.badges
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists org_read on public.organisations;
create policy org_read on public.organisations
  for select using (
    public.is_org_staff(id)
    or exists (
      select 1 from public.org_members m
      where m.organisation_id = id and m.user_id = auth.uid()
    )
  );
