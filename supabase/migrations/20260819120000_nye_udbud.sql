-- Overvågning af nye bekendtgørelser: to tilføjelser til soeg_udbud().
--
-- HVORFOR ET TIDSFILTER OG IKKE BARE SORTERING PÅ 'nyeste': at sortere nyest
-- først besvarer "hvad er det nyeste", ikke "hvad er KOMMET TIL siden i går".
-- Forskellen er hele pointen i en overvågningsliste: uden filteret fylder de
-- samme bekendtgørelser listen dag efter dag, og man kan ikke se om der er
-- noget nyt uden at huske hvad man så sidst.
--
-- Filteret måler på registreringstidspunkt — tidspunktet udbud.dk lagde
-- bekendtgørelsen i sin egen database — og ikke på fristen eller en
-- offentliggørelsesdato. Det er den samme akse API'ets `since`-parameter
-- måler på, og dermed den eneste, hvor "nyt for os" og "nyt hos kilden"
-- betyder det samme. En bekendtgørelse kan godt have en gammel frist og være
-- registreret i dag (rettelser, genudbud), og den ER ny for en tilbudsgiver.
--
-- HVORFOR senesteRegistrering KOMMER MED I SVARET: listen fyldes nu af en
-- daglig synk (api/synk-udbud.js) frem for af en manuel scriptkørsel. Holder
-- synken op med at køre, viser en overvågningsliste "0 nye i dag" — hvilket
-- ser ud som et svar, men er en fejl. Feltet gør forskellen synlig i UI'et.
-- Det tælles på HELE tabellen, ikke på træfmængden, netop fordi det handler
-- om indeksets alder og ikke om søgningen.
--
-- INTET NYT INDEKS: filteret er et interval-scan på 23.660 rækker, og der er
-- kun 219 MB luft i databasen efter oprydningen 14. august. Et indeks på
-- registreringstidspunkt ville koste plads for at spare millisekunder på en
-- tabel, der i forvejen svarer hurtigt. Kommer der en nul til på rækketallet,
-- er det det første sted at se.

-- Signaturen ændres, og create or replace kan ikke tilføje en parameter.
-- Uden drop ville der stå TO overloads, og et kald med kun defaults ville
-- blive tvetydigt ("function is not unique").
drop function if exists public.soeg_udbud(text, text[], text[], text[], boolean, text, int, int);

create or replace function public.soeg_udbud(
  soegetekst text default null,
  cpv_koder text[] default null,
  kilder text[] default null,        -- {TED,DKUDBUD}
  arter text[] default null,         -- {udbud,forhaandsmeddelelse,tildeling,andet}
  kun_aabne boolean default false,   -- frist i fremtiden
  sortering text default 'frist',    -- frist | nyeste | vaerdi
  maks int default 100,
  spring_over int default 0,
  nyere_end timestamptz default null -- kun registreret efter dette tidspunkt
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
    -- Indeksets alder, ikke søgningens: se noten om senesteRegistrering.
    'senesteRegistrering', (
      select max(registreringstidspunkt) from public.udbud_bekendtgoerelse
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

revoke all on function
  public.soeg_udbud(text, text[], text[], text[], boolean, text, int, int, timestamptz)
  from public, anon, authenticated;
