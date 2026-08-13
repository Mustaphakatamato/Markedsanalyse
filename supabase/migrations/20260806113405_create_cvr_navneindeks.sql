-- Navneindeks over aktive danske virksomheder, indlæst fra Datafordelerens
-- CVR-fildownload (se scripts/indlaes-cvr-indeks.mjs).
--
-- Findes fordi Datafordelerens GraphQL-tjeneste KUN kan filtrere strenge med
-- "eq" og "in" — der er ingen "contains". Fritekstsøgning på firmanavn er
-- derfor umulig direkte mod kilden, og appens vigtigste indgang er netop at
-- skrive et firmanavn.

create table public.cvr_virksomhed_indeks (
  cvr bigint primary key,
  navn text not null,
  status text,
  ophoert boolean not null default false,
  opdateret timestamptz not null default now()
);

create extension if not exists pg_trgm;

create index cvr_indeks_navn_trgm on public.cvr_virksomhed_indeks
  using gin (lower(navn) gin_trgm_ops);

create index cvr_indeks_aktive on public.cvr_virksomhed_indeks (cvr)
  where ophoert = false;

alter table public.cvr_virksomhed_indeks enable row level security;
revoke all on public.cvr_virksomhed_indeks from anon, authenticated;
