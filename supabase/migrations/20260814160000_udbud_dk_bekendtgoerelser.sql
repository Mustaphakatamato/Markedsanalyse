-- Søgbart indeks over samtlige bekendtgørelser på udbud.dk.
--
-- HVORFOR ET EGET INDEKS: udbud.dk's eksterne API kan ikke søges. Endepunktet
-- `fraKilde/{kilde}` tager præcis tre parametre — `page`, `size` og `since` —
-- og har hverken CPV-, ordregiver- eller fritekstfilter. Hver bekendtgørelse
-- kommer som base64-encoded eForms-XML, og de eneste strukturerede felter ved
-- siden af er noticeId, version, publikationsnummer og registreringstidspunkt.
-- Det er et bulk-synk-endpoint til systemer, der bygger deres eget indeks.
-- Præcis samme situation som Datafordelerens CVR-udtræk, og samme løsning.
--
-- OMFANG (målt mod PROD 14. august 2026): 23.660 bekendtgørelser i alt —
-- 22.491 fra TED og 1.169 fra DKUDBUD. DKUDBUD er den nye danske kilde med
-- udbud UNDER EU's tærskelværdi, altså præcis dem TED aldrig har kendt.
--
-- HVORFOR IKKE BARE TED-API'ET: fordi det er de 1.169 der er pointen. En
-- tilbudsgiver, der leder efter opgaver, skal kunne se de danske udbud der
-- ikke er store nok til at havne i TED.

create table public.udbud_bekendtgoerelse (
  -- noticeId er en UUID og findes altid. noticePublicationNumber er derimod
  -- TOM for alle DKUDBUD-bekendtgørelser (verificeret) og kan derfor ikke
  -- bruges som nøgle — kun til at linke videre til TED.
  notice_id text not null,
  notice_version text not null,
  publikationsnummer text,

  -- TED | DKUDBUD. Gemmes fordi det er den skarpeste skillelinje for en
  -- tilbudsgiver: DKUDBUD er dem, der ikke findes andre steder.
  kilde text not null,

  -- Tidspunktet udbud.dk lagde den i databasen. Det er dét, API'ets
  -- `since`-filter måler på, så det er også vores synk-vandmærke.
  registreringstidspunkt timestamptz not null,

  -- eForms-bekendtgørelsestypen: DKE0/DKE3 for de danske, 16/29/30/32 m.fl.
  -- for TED. Rodelementet oversættes til noget læsbart i 'art'.
  subtype text,
  -- udbud | forhaandsmeddelelse | tildeling | andet
  art text not null,

  titel text,
  beskrivelse text,
  -- works | services | supplies
  kontrakttype text,

  ordregiver text,
  ordregiver_cvr text,

  -- Hoved-CPV står først; 'cpv_koder' rummer både hoved og supplerende, uden
  -- dubletter. Begge dele gemmes: hoved-CPV er det, ordregiveren selv anser
  -- for opgavens kerne, og det bør veje tungest i en resultatliste.
  cpv_hoved text,
  cpv_koder text[] not null default '{}',

  frist timestamptz,
  anslaaet_vaerdi numeric,
  valuta text,
  nuts text,
  -- Link til udbudsmaterialet hos ordregiverens eget udbudssystem
  -- (ethics.dk, mercell m.fl.) — det er dér, en tilbudsgiver skal hen.
  dokument_url text,

  -- Fritekstsøgning på titel og beskrivelse. Genereret kolonne frem for et
  -- udtryksindeks, så vægtningen (titel over beskrivelse) står ét sted og
  -- ikke skal gentages i hver forespørgsel.
  soegetekst tsvector generated always as (
    setweight(to_tsvector('danish', coalesce(titel, '')), 'A') ||
    setweight(to_tsvector('danish', coalesce(beskrivelse, '')), 'B')
  ) stored,

  opdateret timestamptz not null default now(),

  primary key (notice_id, notice_version)
);

-- Resultatlisten sorteres på frist eller registreringstidspunkt; begge er
-- varme. Delvist indeks på fristen: rækker uden frist (tildelinger,
-- forhåndsmeddelelser) fylder kun indekset uden nogensinde at blive fundet
-- gennem det.
create index udbud_frist on public.udbud_bekendtgoerelse (frist) where frist is not null;
create index udbud_registreret on public.udbud_bekendtgoerelse (registreringstidspunkt desc);
create index udbud_kilde_art on public.udbud_bekendtgoerelse (kilde, art);
create index udbud_soegetekst on public.udbud_bekendtgoerelse using gin (soegetekst);

-- CPV-opslag går gennem to indekser, fordi der er to slags spørgsmål:
--   "præcis denne kode"  -> GIN på arrayet (&&)
--   "denne kode og alt under den" -> se cpv_praefiks() nedenfor
create index udbud_cpv on public.udbud_bekendtgoerelse using gin (cpv_koder);

alter table public.udbud_bekendtgoerelse enable row level security;
revoke all on public.udbud_bekendtgoerelse from anon, authenticated;


-- CPV-hierarkiet ligger i cifrene: 72000000 er hele IT-området, 72222300 en
-- enkelt ydelse i det. Vælger man en bred kode, skal alt under den med —
-- ellers rammer et valg på "It-tjenester" ingenting, fordi de konkrete udbud
-- altid er kodet dybere.
--
-- Præfikset er koden uden efterstillede nuller: 72000000 -> '72',
-- 90910000 -> '9091', 48931000 -> '48931'. Samme hierarkiske adfærd som
-- TED's egen classification-cpv (verificeret direkte mod deres API), så de to
-- kilder svarer ens på det samme valg.
create or replace function public.cpv_praefiks(kode text)
returns text
language sql
immutable
parallel safe
as $$
  -- rtrim fjerner ALLE efterstillede nuller. En kode der kun er nuller ville
  -- give tom streng og dermed matche alt; den findes ikke i CPV, men
  -- afvisningen koster intet.
  select nullif(rtrim(split_part(btrim(kode), '-', 1), '0'), '');
$$;


-- Søgningen. Alt filtrering sker her frem for i klienten: tabellen er lille
-- nok til at svare hurtigt, men den er stadig 23.660 rækker, og at sende dem
-- til browseren for at filtrere dér ville koste mere end selve svaret.
create or replace function public.soeg_udbud(
  soegetekst text default null,
  cpv_koder text[] default null,
  kilder text[] default null,        -- {TED,DKUDBUD}
  arter text[] default null,         -- {udbud,forhaandsmeddelelse,tildeling,andet}
  kun_aabne boolean default false,   -- frist i fremtiden
  sortering text default 'frist',    -- frist | nyeste | vaerdi
  maks int default 100,
  spring_over int default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with praefikser as (
    select array_agg(p || '%') as m
    from (
      select public.cpv_praefiks(k) as p
      from unnest(coalesce(cpv_koder, '{}')) as k
    ) s
    where p is not null
  ),
  soeg as (
    select case
             when soegetekst is null or btrim(soegetekst) = '' then null
             -- websearch_to_tsquery frem for plainto_: den forstår citater og
             -- OR, og den KASTER ikke på et løst anførselstegn, som en bruger
             -- sagtens kan komme til at skrive midt i en søgning.
             else websearch_to_tsquery('danish', soegetekst)
           end as q
  ),
  fundne as (
    select b.*
    from public.udbud_bekendtgoerelse b, praefikser p, soeg s
    where (s.q is null or b.soegetekst @@ s.q)
      and (p.m is null or exists (
            select 1 from unnest(b.cpv_koder) as k where k like any (p.m)
          ))
      and (kilder is null or coalesce(array_length(kilder, 1), 0) = 0 or b.kilde = any(kilder))
      and (arter is null or coalesce(array_length(arter, 1), 0) = 0 or b.art = any(arter))
      -- "Kun åbne" betyder en frist der ikke er udløbet. Bekendtgørelser
      -- HELT uden frist (tildelinger, forhåndsmeddelelser) er ikke åbne udbud
      -- og udelades — at tage dem med ville fylde listen med noget, man ikke
      -- kan byde på.
      and (not kun_aabne or (b.frist is not null and b.frist >= now()))
  ),
  sorteret as (
    select *
    from fundne
    order by
      case when sortering = 'frist'   then frist end asc nulls last,
      case when sortering = 'vaerdi'  then anslaaet_vaerdi end desc nulls last,
      registreringstidspunkt desc
    limit greatest(1, least(maks, 200))
    offset greatest(0, spring_over)
  )
  select jsonb_build_object(
    -- Antallet tælles på hele træfmængden, ikke på siden: uden det kan
    -- brugeren ikke se om en afgrænsning virkede eller bare skubbede
    -- resultaterne ned på næste side.
    'ialt', (select count(*) from fundne),
    'aabne', (select count(*) from fundne where frist is not null and frist >= now()),
    'prKilde', coalesce((
      select jsonb_object_agg(kilde, n) from (
        select kilde, count(*) as n from fundne group by kilde
      ) s), '{}'::jsonb),
    'prArt', coalesce((
      select jsonb_object_agg(art, n) from (
        select art, count(*) as n from fundne group by art
      ) s), '{}'::jsonb),
    'udbud', coalesce((
      select jsonb_agg(jsonb_build_object(
        'noticeId', notice_id,
        'version', notice_version,
        'publikationsnummer', nullif(publikationsnummer, ''),
        'kilde', kilde,
        'art', art,
        'subtype', subtype,
        'titel', titel,
        'beskrivelse', beskrivelse,
        'kontrakttype', kontrakttype,
        'ordregiver', ordregiver,
        'ordregiverCvr', ordregiver_cvr,
        'cpvHoved', cpv_hoved,
        'cpvKoder', cpv_koder,
        'frist', frist,
        'anslaaetVaerdi', anslaaet_vaerdi,
        'valuta', valuta,
        'nuts', nuts,
        'dokumentUrl', dokument_url,
        'registreret', registreringstidspunkt
      )) from sorteret), '[]'::jsonb)
  );
$$;

revoke all on function public.soeg_udbud(text, text[], text[], text[], boolean, text, int, int)
  from public, anon, authenticated;
