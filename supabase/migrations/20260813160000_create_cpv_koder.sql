-- CPV-nomenklaturen (Common Procurement Vocabulary) på dansk — 9.454 koder.
--
-- HVORFOR: en ordregiver skal angive CPV-koder for sit udbud, og teksten skal
-- være den officielle. Indtil nu havde appen fire hardkodede koder med
-- OPDIGTEDE betegnelser: 64212000 stod som "SMS gateway og beskedtjenester",
-- men hedder i virkeligheden "Mobiltelefontjeneste" (sms er 64212100). En
-- opdigtet betegnelse i udbudsmaterialet ville være direkte forkert.
--
-- HVORFOR I DATABASEN OG IKKE I BUNDLEN: de danske betegnelser fylder 315 KB
-- rå. Lagt i JavaScript-bundlen ville de mere end fordoble den (72 KB gzipped
-- i dag) for en liste, de fleste brugere kun rører nogle få gange. Søgningen
-- er i forvejen et debounced fjernopslag i UI'et, præcis som firmanavne.
--
-- KILDE: eForms-SDK'ets codelists/cpv.gc (GenericCode-XML, alle EU-sprog).
-- Se scripts/indlaes-cpv.mjs. Nomenklaturen er stabil — CPV 2008 har været
-- uændret siden 2008 — så en genindlæsning er kun nødvendig ved en ny udgave.

create table public.cpv_koder (
  kode text primary key,
  tekst text not null,
  -- 1 = hovedgruppe (45000000), 5 = mest specifik. Bruges til at vise
  -- hierarkiet og til at rangere brede koder over smalle i søgeresultatet:
  -- en ordregiver leder typisk efter kategorien, ikke den dybeste variant.
  niveau smallint not null,
  -- Forælderkoden, fundet ved at nulstille sidste ikke-nul-ciffer. Gør det
  -- muligt at vise "hører under" uden at parse koden i UI'et.
  overordnet text references public.cpv_koder(kode)
);

create extension if not exists pg_trgm;

create index cpv_tekst_trgm on public.cpv_koder using gin (lower(tekst) gin_trgm_ops);
create index cpv_overordnet on public.cpv_koder (overordnet);
create index cpv_niveau on public.cpv_koder (niveau);

alter table public.cpv_koder enable row level security;
revoke all on public.cpv_koder from anon, authenticated;


-- Søgning på både kode og tekst i ét felt, fordi brugeren kan have begge dele
-- i hovedet. Rangering, vigtigst først:
--   0  koden begynder med søgeteksten (man skriver et kodepræfiks)
--   1  betegnelsen begynder med søgeteksten
--   2  søgeteksten indgår i betegnelsen
--   3  ingen tekstmatch, men trigram-lighed (fanger stavefejl)
-- Inden for samme rang vægtes BREDE koder først: leder man efter "bygge",
-- er 45000000 Bygge- og anlægsarbejder et mere sandsynligt valg end en af de
-- hundredvis af underkoder, der også indeholder ordet.
create or replace function public.soeg_cpv(soegetekst text, maks int default 20)
returns table (kode text, tekst text, niveau smallint, overordnet text, overordnet_tekst text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with q as (select lower(trim(soegetekst)) as t)
  select c.kode, c.tekst, c.niveau, c.overordnet, o.tekst as overordnet_tekst
  from public.cpv_koder c
  left join public.cpv_koder o on o.kode = c.overordnet, q
  where q.t <> ''
    and (c.kode like q.t || '%'
         or lower(c.tekst) like '%' || q.t || '%'
         or lower(c.tekst) % q.t)
  order by
    case
      when c.kode like q.t || '%' then 0
      when lower(c.tekst) like q.t || '%' then 1
      when lower(c.tekst) like '%' || q.t || '%' then 2
      else 3
    end,
    c.niveau,
    similarity(lower(c.tekst), q.t) desc,
    c.kode
  limit greatest(1, least(maks, 50));
$$;

revoke all on function public.soeg_cpv(text, int) from public, anon, authenticated;
