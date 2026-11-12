-- EquityMedQA-SG clinician annotation: database schema (Postgres; Neon free tier on Vercel).
-- Applied by scripts/admin.mjs init (idempotent).

create table if not exists annotators (
  id          serial primary key,
  name        text not null,
  email       text,
  role        text not null default 'clinician' check (role in ('clinician', 'admin')),
  token_hash  text not null unique,          -- sha256 of the personal access token; the token itself is never stored
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- one row per counterfactual set: the question versions, MedGemma's answers, the draft reference
create table if not exists sets (
  set_id     text primary key,
  base_id    text not null,
  axis       text not null,
  batch      text not null,
  payload    jsonb not null,
  loaded_at  timestamptz not null default now()
);

create table if not exists assignments (
  annotator_id  int  not null references annotators(id),
  set_id        text not null references sets(set_id),
  position      int  not null,                -- order shown to this annotator (calibration first)
  kind          text not null default 'main' check (kind in ('calibration', 'main', 'overlap')),
  primary key (annotator_id, set_id)
);

-- the latest state of each annotator's work on a set
create table if not exists annotations (
  annotator_id   int  not null references annotators(id),
  set_id         text not null references sets(set_id),
  data           jsonb not null default '{}',
  status         text not null default 'in_progress' check (status in ('in_progress', 'complete')),
  guide_version  text,
  started_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz,
  primary key (annotator_id, set_id)
);

-- every save, append-only (audit trail; nothing is ever overwritten here)
create table if not exists annotation_log (
  id             bigserial primary key,
  annotator_id   int  not null,
  set_id         text not null,
  data           jsonb not null,
  status         text not null,
  guide_version  text,
  saved_at       timestamptz not null default now()
);
create index if not exists annotation_log_by_set on annotation_log (annotator_id, set_id);

-- ---------- v2 (work item c, 1 Nov 2026): question review and new questions. Additive: a v1 database upgrades with init.

-- the 250 base questions exactly as the question-review page shows them (question only: built by prepare_data.py from a
-- whitelist, with no answer, reference, AI label or rationale)
create table if not exists questions (
  base_id    text primary key,
  position   int  not null,
  payload    jsonb not null,
  loaded_at  timestamptz not null default now()
);

-- the latest state of each doctor's review of a base question
create table if not exists reviews (
  annotator_id   int  not null references annotators(id),
  base_id        text not null references questions(base_id),
  data           jsonb not null default '{}',
  status         text not null default 'in_progress' check (status in ('in_progress', 'complete')),
  forms_version  text,
  started_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz,
  primary key (annotator_id, base_id)
);

-- every review save, append-only
create table if not exists review_log (
  id             bigserial primary key,
  annotator_id   int  not null,
  base_id        text not null,
  data           jsonb not null,
  status         text not null,
  forms_version  text,
  saved_at       timestamptz not null default now()
);
create index if not exists review_log_by_question on review_log (annotator_id, base_id);

-- questions written by doctors
create table if not exists new_questions (
  id             serial primary key,
  annotator_id   int  not null references annotators(id),
  data           jsonb not null default '{}',
  status         text not null default 'draft' check (status in ('draft', 'submitted', 'withdrawn')),
  forms_version  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  submitted_at   timestamptz
);
create index if not exists new_questions_by_annotator on new_questions (annotator_id);

-- every new-question save, append-only
create table if not exists new_question_log (
  id             bigserial primary key,
  question_id    int  not null,
  annotator_id   int  not null,
  data           jsonb not null,
  status         text not null,
  forms_version  text,
  saved_at       timestamptz not null default now()
);

-- every question a doctor opens (blind rule): 'review' shows the question only; 'rating' shows MedGemma's answers and
-- the AI reference, so after it that doctor is no longer blind for that base question (Phase 1A)
create table if not exists view_log (
  id            bigserial primary key,
  annotator_id  int  not null,
  mode          text not null check (mode in ('review', 'rating')),
  base_id       text not null,
  set_id        text,
  opened_at     timestamptz not null default now()
);
create index if not exists view_log_by_annotator on view_log (annotator_id, base_id);

-- ---------- Phase 1A (2 Nov 2026): blind references written by doctors. Additive: an earlier database upgrades with init.

-- 'reference' opens (the Phase 1A page) join 'review' and 'rating' in the log of what each doctor has seen
alter table view_log drop constraint if exists view_log_mode_check;
alter table view_log add constraint view_log_mode_check check (mode in ('review', 'rating', 'reference'));

-- which doctor writes a reference for which base question (scripts/admin.mjs assign-refs). Only 'blind' is offered in
-- this release; 'assisted' (the form pre-filled with the AI draft, design doc) is reserved for a later one.
create table if not exists ref_assignments (
  annotator_id  int  not null references annotators(id),
  base_id       text not null references questions(base_id),
  mode          text not null default 'blind' check (mode in ('blind', 'assisted')),
  position      int  not null,
  assigned_at   timestamptz not null default now(),
  primary key (annotator_id, base_id)
);

-- the latest state of each reference. Stage 1 is fixed once stage1_locked_at is set; Stage 2 is stored only after it.
-- active_s1 / active_s2: seconds the page was open and in use, per stage (for minutes per reference)
create table if not exists clinician_refs (
  annotator_id      int  not null,
  base_id           text not null,
  mode              text not null,
  data              jsonb not null default '{}',
  status            text not null default 'in_progress' check (status in ('in_progress', 'complete', 'declined')),
  stage1_locked_at  timestamptz,
  active_s1         int  not null default 0,
  active_s2         int  not null default 0,
  form_version      text,
  started_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz,
  primary key (annotator_id, base_id),
  foreign key (annotator_id, base_id) references ref_assignments (annotator_id, base_id)
);

-- every reference save, append-only
create table if not exists clinician_ref_log (
  id             bigserial primary key,
  annotator_id   int  not null,
  base_id        text not null,
  data           jsonb not null,
  status         text not null,
  action         text,
  stage1_locked  boolean not null,
  active_s       int  not null default 0,
  form_version   text,
  saved_at       timestamptz not null default now()
);
create index if not exists clinician_ref_log_by_question on clinician_ref_log (annotator_id, base_id);

-- ---------- 11 Nov 2026 (review fixes). Additive: an earlier database upgrades with init.

-- test accounts (for trying the site): their entries stay in the same tables but are left out of the exports unless
-- asked for, and every export row says whether it comes from one (scripts/admin.mjs add NAME --test, set-test)
alter table annotators add column if not exists is_test boolean not null default false;

-- how often the study team reopened a saved Stage 1 for the doctor (scripts/admin.mjs reopen-stage1). After a reopen
-- the doctor has seen the demographic versions before finishing Stage 1, so the exports carry this count.
alter table clinician_refs add column if not exists stage1_reopens int not null default 0;
