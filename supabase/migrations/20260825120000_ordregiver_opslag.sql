-- Opslag på en ORDREGIVER: hvilke bekendtgørelser har de selv offentliggjort.
--
-- HVORFOR CVR ER NØGLEN OG IKKE NAVNET: ordregiverfeltet i eForms er fritekst,
-- som ordregiveren selv udfylder pr. bekendtgørelse. Målt på PROD 25. august
-- 2026: 23.813 bekendtgørelser fordelt på 1.756 forskellige NAVNE, men kun
-- 1.067 forskellige CVR-numre. Københavns Kommune (CVR 64942212) alene står
-- under 29 navne — "Københavns Kommune", "KØBENHAVNS KOMMUNE", "Teknik- og
-- Miljøforvaltningen", "Byggeri København", "Copenhagen Municipality" m.fl.
-- Forsvarsministeriets Materiel- og Indkøbsstyrelse har 39, inkl. tre
-- stavefejl af deres eget navn.
--
-- En søgning der grupperede på navn ville derfor dele én ordregiver op i et
-- dusin halve profiler, hvor ingen af dem viser hele billedet. Derfor:
--   1. Søgeteksten matches mod ALLE navnevarianter (og mod CVR-nummeret).
--   2. Resultatet grupperes på CVR — så et træf på "Teknik- og
--      Miljøforvaltningen" giver hele Københavns Kommune.
--   3. Det viste navn er den variant ordregiveren selv bruger oftest.
--
-- De 874 rækker uden CVR (3,7%) kan ikke slås sammen og grupperes på deres
-- eget navn. Det er en kilde-mangel, ikke noget vi kan udlede os ud af.
--
-- INTET NYT INDEKS: samme afvejning som i 20260819120000_nye_udbud.sql.
-- Søgningen er to seq-scans over 23.813 rækker og måler 126 ms mod PROD —
-- forslagslisten i UI'et debouncer i forvejen 250 ms. Et trigram-indeks på
-- ordregiver ville spare ~100 ms for et par MB, og der er kun ~80 MB luft i
-- databasen. Vokser tabellen en tierpotens, er dette det første sted at se.

create or replace function public.soeg_ordregiver(
  soegetekst text default null,
  maks int default 10
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with param as (
    select
      nullif(btrim(coalesce(soegetekst, '')), '') as t,
      -- Et rent tal behandles som CVR-nummer. Ordregivere ER virksomheder i
      -- CVR (kommuner, regioner, styrelser), så det er en reel indgang.
      nullif(regexp_replace(coalesce(soegetekst, ''), '\D', '', 'g'), '') as cvr
  ),
  -- Trin 1: hvilke ordregivere rammer søgeteksten — på ét eller andet af
  -- deres navne, eller på CVR-nummeret.
  ramte as (
    select
      array_agg(distinct b.ordregiver_cvr) filter (where b.ordregiver_cvr is not null) as cvrs,
      array_agg(distinct lower(btrim(b.ordregiver))) filter (where b.ordregiver_cvr is null) as navne
    from public.udbud_bekendtgoerelse b, param p
    where p.t is not null
      and (b.ordregiver ilike '%' || p.t || '%' or b.ordregiver_cvr = p.cvr)
  ),
  -- Trin 2: HELE bekendtgørelsesmængden for de ramte ordregivere — også de
  -- navnevarianter der ikke selv matchede søgeteksten. Det er hele pointen:
  -- "Byggeri København" skal tælle med under Københavns Kommune.
  traf as (
    select
      b.ordregiver,
      b.ordregiver_cvr,
      b.art,
      b.kilde,
      b.frist,
      b.registreringstidspunkt,
      coalesce(b.ordregiver_cvr, 'navn:' || lower(btrim(b.ordregiver))) as noegle
    from public.udbud_bekendtgoerelse b, ramte r
    where b.ordregiver_cvr = any (r.cvrs)
       or lower(btrim(b.ordregiver)) = any (r.navne)
  ),
  -- Navnevarianterne pr. ordregiver, mest brugte først. Den øverste bliver
  -- profilens navn: ordregiverens eget almindelige selvbetegnelse, ikke den
  -- tilfældige variant der stod på den nyeste bekendtgørelse.
  varianter as (
    select noegle, ordregiver, count(*) as n, max(registreringstidspunkt) as sen
    from traf
    group by 1, 2
  ),
  navngivet as (
    select
      noegle,
      (array_agg(ordregiver order by n desc, sen desc, length(ordregiver)))[1] as navn,
      (array_agg(ordregiver order by n desc, sen desc, length(ordregiver)))[1:8] as top_varianter,
      count(*) as antal_navne
    from varianter
    group by noegle
  ),
  -- Fordelingerne udregnes hver for sig og joines ind. Lagt som to lateral
  -- joins på samme række ville de gange hinanden op (hver kilde × hver art),
  -- og jsonb_object_agg ville få samme nøgle flere gange.
  pr_kilde as (
    select noegle, jsonb_object_agg(kilde, n) as fordeling
    from (select noegle, kilde, count(*) as n from traf group by 1, 2) x
    group by noegle
  ),
  pr_art as (
    select noegle, jsonb_object_agg(art, n) as fordeling
    from (select noegle, art, count(*) as n from traf group by 1, 2) x
    group by noegle
  ),
  grundtal as (
    select
      noegle,
      max(ordregiver_cvr) as cvr,
      count(*) as antal,
      count(*) filter (where frist is not null and frist >= now()) as aabne,
      min(registreringstidspunkt) as foerste,
      max(registreringstidspunkt) as seneste
    from traf
    group by noegle
  ),
  samlet as (
    select
      n.navn,
      n.top_varianter,
      n.antal_navne,
      g.cvr,
      g.antal,
      g.aabne,
      g.foerste,
      g.seneste,
      coalesce(k.fordeling, '{}'::jsonb) as pr_kilde,
      coalesce(a.fordeling, '{}'::jsonb) as pr_art
    from grundtal g
    join navngivet n using (noegle)
    left join pr_kilde k using (noegle)
    left join pr_art a using (noegle)
  )
  select jsonb_build_object(
    'ialt', (select count(*) from samlet),
    -- Indeksets egen horisont. UI'et bruger den til at forklare hvorfor TED
    -- kan vise flere bekendtgørelser end listen fra udbud.dk: indekset
    -- begynder her, TED rækker år længere tilbage.
    'indeksStart', (select min(registreringstidspunkt) from public.udbud_bekendtgoerelse),
    'ordregivere', coalesce((
      select jsonb_agg(o) from (
        select jsonb_build_object(
          'navn', s.navn,
          'cvr', s.cvr,
          'navnevarianter', to_jsonb(s.top_varianter),
          'antalNavne', s.antal_navne,
          'antal', s.antal,
          'aabne', s.aabne,
          'foerste', s.foerste,
          'seneste', s.seneste,
          'prKilde', s.pr_kilde,
          'prArt', s.pr_art
        ) as o
        from samlet s, param p
        -- Et præfiksmatch på det viste navn vejer tungest: skriver man
        -- "aarhus", skal Aarhus Kommune ligge over en ordregiver der blot
        -- har ordet inde i et af sine navne. Derefter er størrelse den
        -- bedste rangering vi har.
        order by (case when p.t is not null and s.navn ilike p.t || '%' then 0 else 1 end),
                 s.antal desc,
                 s.navn
        limit greatest(1, least(maks, 50))
      ) r), '[]'::jsonb)
  );
$$;

revoke all on function public.soeg_ordregiver(text, int) from public, anon, authenticated;


-- soeg_udbud() får et ordregiverfilter, så ordregiverprofilens liste bruger
-- PRÆCIS samme søgning (og dermed samme CPV-hierarki, fristlogik og
-- sortering) som Udbudssøgning og overvågningen. Et separat
-- "udbud_for_ordregiver" ville være en tredje kopi af de samme regler.
--
-- Filteret er på CVR, ikke på navn — se noten om navnevarianter øverst.
-- kun_ordregiver_navn findes udelukkende til de 874 rækker uden CVR, hvor
-- navnet er den eneste identitet der er.
--
-- Parametrene heder kun_* og ikke ordregiver_cvr/ordregiver: i en
-- SQL-funktion vinder KOLONNEN, hvis et parameternavn er identisk med en
-- kolonne i scope — stille, uden fejl. Filteret ville så sammenligne
-- kolonnen med sig selv og aldrig afgrænse noget.
drop function if exists public.soeg_udbud(text, text[], text[], text[], boolean, text, int, int, timestamptz);

create or replace function public.soeg_udbud(
  soegetekst text default null,
  cpv_koder text[] default null,
  kilder text[] default null,        -- {TED,DKUDBUD}
  arter text[] default null,         -- {udbud,forhaandsmeddelelse,tildeling,andet}
  kun_aabne boolean default false,   -- frist i fremtiden
  sortering text default 'frist',    -- frist | nyeste | vaerdi
  maks int default 100,
  spring_over int default 0,
  nyere_end timestamptz default null,      -- kun registreret efter dette tidspunkt
  kun_ordregiver_cvr text default null,    -- én ordregiver, uanset navnevariant
  kun_ordregiver_navn text default null    -- kun for ordregivere uden CVR i kilden
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
      and (nyere_end is null or b.registreringstidspunkt >= nyere_end)
      and (kun_ordregiver_cvr is null or b.ordregiver_cvr = kun_ordregiver_cvr)
      and (
        kun_ordregiver_navn is null
        or lower(btrim(b.ordregiver)) = lower(btrim(kun_ordregiver_navn))
      )
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
    -- Indeksets alder, ikke søgningens: se noten i 20260819120000_nye_udbud.sql.
    'senesteRegistrering', (
      select max(registreringstidspunkt) from public.udbud_bekendtgoerelse
    ),
    -- Indeksets horisont bagud. Den skal med i svaret, fordi en
    -- ordregiverprofil ellers ser ud som om ordregiveren først begyndte at
    -- udbyde i november 2024 — det er indekset, der begynder der, ikke dem.
    'indeksStart', (
      select min(registreringstidspunkt) from public.udbud_bekendtgoerelse
    ),
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

revoke all on function public.soeg_udbud(
  text, text[], text[], text[], boolean, text, int, int, timestamptz, text, text
) from public, anon, authenticated;
