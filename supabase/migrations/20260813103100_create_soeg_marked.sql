-- Markedsopslag: find populationen af aktive danske virksomheder i et sæt
-- brancher, valgfrit afgrænset geografisk.
--
-- Ligger i SQL frem for i Edge Function'en af samme grund som
-- soeg_virksomhed(): databasen kan bruge indekset til både at filtrere og
-- sortere, og en markedsafdækning kan ramme tusinder af rækker.
--
-- Bibrancher tæller med, men rangeres under hovedbranche. En virksomhed med
-- IT-drift som bibranche ER en mulig leverandør, men er svagere evidens end
-- en hvor det er hovedforretningen — og den forskel skal en ordregiver kunne
-- se, ikke have skjult i en samlet score.

create or replace function public.soeg_marked(
  branchekoder text[],
  kommunekoder text[] default null,
  maks int default 200
)
returns table (
  cvr bigint,
  navn text,
  branchekode text,
  branchetekst text,
  bibrancher text[],
  kommunekode text,
  kommunenavn text,
  postnummer text,
  postdistrikt text,
  virksomhedsform text,
  traf_hovedbranche boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    i.cvr, i.navn, i.branchekode, i.branchetekst, i.bibrancher,
    i.kommunekode, i.kommunenavn, i.postnummer, i.postdistrikt,
    i.virksomhedsform,
    (i.branchekode = any(branchekoder)) as traf_hovedbranche
  from public.cvr_virksomhed_indeks i
  where i.ophoert = false
    and coalesce(array_length(branchekoder, 1), 0) > 0
    and (i.branchekode = any(branchekoder) or i.bibrancher && branchekoder)
    and (kommunekoder is null
         or coalesce(array_length(kommunekoder, 1), 0) = 0
         or i.kommunekode = any(kommunekoder))
  order by
    (i.branchekode = any(branchekoder)) desc,  -- hovedbranche før bibranche
    i.navn
  limit greatest(1, least(maks, 2000));
$$;

revoke all on function public.soeg_marked(text[], text[], int) from public, anon, authenticated;


-- Markedets struktur i ét kald: hvor stort er markedet, hvordan fordeler det
-- sig på brancher, geografi og selskabsform. Det er grundlaget for de
-- udbudsstrategiske spørgsmål — er der konkurrence nok, og er der SMV'er
-- der kan løfte opgaven hvis den deles op.
--
-- Returnerer jsonb frem for flere returtabeller, så UI'et henter hele
-- markedsbilledet i én forespørgsel.

create or replace function public.marked_statistik(
  branchekoder text[],
  kommunekoder text[] default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with fundet as (
    select i.*
    from public.cvr_virksomhed_indeks i
    where i.ophoert = false
      and coalesce(array_length(branchekoder, 1), 0) > 0
      and (i.branchekode = any(branchekoder) or i.bibrancher && branchekoder)
      and (kommunekoder is null
           or coalesce(array_length(kommunekoder, 1), 0) = 0
           or i.kommunekode = any(kommunekoder))
  )
  select jsonb_build_object(
    'ialt', (select count(*) from fundet),
    'hovedbranche', (select count(*) from fundet where branchekode = any(branchekoder)),
    'kunBibranche', (select count(*) from fundet
                     where branchekode is null or not (branchekode = any(branchekoder))),
    'prBranche', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
          'kode', branchekode, 'tekst', branchetekst, 'antal', count(*)
        ) as x
        from fundet where branchekode is not null
        group by branchekode, branchetekst
        order by count(*) desc limit 25
      ) s
    ), '[]'::jsonb),
    'prKommune', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
          'kode', kommunekode, 'navn', kommunenavn, 'antal', count(*)
        ) as x
        from fundet where kommunekode is not null
        group by kommunekode, kommunenavn
        order by count(*) desc limit 30
      ) s
    ), '[]'::jsonb),
    'prSelskabsform', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object('form', virksomhedsform, 'antal', count(*)) as x
        from fundet where virksomhedsform is not null
        group by virksomhedsform
        order by count(*) desc limit 15
      ) s
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.marked_statistik(text[], text[]) from public, anon, authenticated;
