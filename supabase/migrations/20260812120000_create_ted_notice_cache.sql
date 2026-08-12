-- Cache for de fulde eForms-XML-notices fra TED, samme mønster som
-- regnskab_doc_cache: XML'en parses i browseren, ikke i funktionen (2s
-- CPU-loftet i Edge Functions rækker ikke til at parse en flerhundrede-KB
-- rammeaftale med hundredvis af LotTender-elementer).
--
-- En publiceret TED-notice ændrer sig aldrig bagefter — en rettelse
-- offentliggøres som en NY notice med sit eget publication-number, ikke som
-- en ændring af den eksisterende. Cachen kan derfor stå længe.
create table public.ted_notice_cache (
  publication_number text primary key,
  body text not null,
  fetched_at timestamptz not null default now()
);

alter table public.ted_notice_cache enable row level security;

revoke all on public.ted_notice_cache from anon, authenticated;

create index ted_notice_cache_fetched_at_idx on public.ted_notice_cache (fetched_at);
