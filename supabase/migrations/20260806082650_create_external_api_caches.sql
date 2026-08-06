-- Cache for eksterne datakilder. Tabellerne læses og skrives udelukkende af
-- Edge Functions med service-nøgle — aldrig direkte fra browseren. Derfor
-- aktiveres RLS uden en eneste policy: anon og authenticated får intet,
-- service_role går uden om RLS.
--
-- Formål:
--  * cvr_cache        — cvrapi.dk har et loft på 50 opslag/dag pr. IP
--  * regnskab_*_cache — Erhvervsstyrelsens kilder svarer op til ~120s

create table public.cvr_cache (
  search_term text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

create table public.regnskab_search_cache (
  query_hash text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

-- Regnskabsdokumenter er XBRL/XML og gemmes som tekst; de parses i browseren
-- (2s CPU-loftet i Edge Functions rækker ikke til at parse dem server-side).
create table public.regnskab_doc_cache (
  doc_path text primary key,
  body text not null,
  fetched_at timestamptz not null default now()
);

alter table public.cvr_cache enable row level security;
alter table public.regnskab_search_cache enable row level security;
alter table public.regnskab_doc_cache enable row level security;

revoke all on public.cvr_cache from anon, authenticated;
revoke all on public.regnskab_search_cache from anon, authenticated;
revoke all on public.regnskab_doc_cache from anon, authenticated;

-- Bruges til at udløbe gamle poster.
create index cvr_cache_fetched_at_idx on public.cvr_cache (fetched_at);
create index regnskab_search_cache_fetched_at_idx on public.regnskab_search_cache (fetched_at);
create index regnskab_doc_cache_fetched_at_idx on public.regnskab_doc_cache (fetched_at);
