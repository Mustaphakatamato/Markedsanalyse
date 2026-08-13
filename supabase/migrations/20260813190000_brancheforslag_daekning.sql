-- Retter dækningsgraden i brancheforslag_for_navne().
--
-- FUNDET VED AT KØRE FLOWET: et rengøringsudbud gav "101 af 95 vindernavne
-- matchet — 106 % dækning". Tælleren var antal VIRKSOMHEDER, nævneren antal
-- NAVNE, og ét TED-navn kan matche flere selskaber med samme normaliserede
-- navn ("A Rengøring" findes flere gange i CVR). To forskellige enheder
-- præsenteret som én brøk.
--
-- Dækningsgraden skal svare på "hvor stor en del af vinderfeltet kunne vi
-- overhovedet slå op" — altså hvor mange af de SØGTE NAVNE der ramte mindst
-- én virksomhed. Antallet af virksomheder er stadig interessant, men er et
-- andet tal og vises som sit eget.
--
-- Tallet er ikke kosmetik: det er dét, der fortæller en ordregiver, hvor
-- meget forslaget er værd. Et forslag bygget på 45 af 67 navne vejer
-- anderledes end ét bygget på alle — og et forslag med "106 % dækning"
-- undergraver tilliden til hele analysen.

create or replace function public.brancheforslag_for_navne(navne text[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with input as (
    select distinct n
    from unnest(navne) as n
    where n is not null and btrim(n) <> ''
  ),
  -- Hvert søgt navn giver to opslagsformer: det fulde navn og kernenavnet
  -- uden selskabsform. Det oprindelige navn bæres med, så et træf kan føres
  -- tilbage til dét navn, der blev søgt på.
  sogte as (
    select n as original, public.navn_normaliser(n) as norm from input
    union all
    select n, public.navn_normaliser(public.navn_kerne(n)) from input
  ),
  fundne as (
    select s.original, i.cvr, i.branchekode, i.branchetekst
    from public.cvr_virksomhed_indeks i
    join sogte s on s.norm = public.navn_normaliser(i.navn)
    where i.ophoert = false
    union
    select s.original, i.cvr, i.branchekode, i.branchetekst
    from public.cvr_virksomhed_indeks i
    join sogte s on s.norm = public.navn_normaliser(public.navn_kerne(i.navn))
    where i.ophoert = false
  ),
  -- Én række pr. virksomhed til branchefordelingen: den samme virksomhed må
  -- ikke tælle flere gange, blot fordi den blev ramt ad flere veje.
  traf as (
    select distinct on (cvr) cvr, branchekode, branchetekst from fundne
  )
  select jsonb_build_object(
    'navneSlaaetOp', (select count(*) from input),
    'navneMedTraf', (select count(distinct original) from fundne),
    'virksomhederFundet', (select count(*) from traf),
    'medBranche', (select count(*) from traf where branchekode is not null),
    'brancher', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'kode', branchekode,
          'tekst', branchetekst,
          'antal', count(*),
          'andel', round(100.0 * count(*) / nullif((select count(*) from traf where branchekode is not null), 0), 1)
        ) as x
        from traf
        where branchekode is not null
        group by branchekode, branchetekst
        order by count(*) desc, branchekode
        limit 20
      ) s), '[]'::jsonb)
  );
$$;

revoke all on function public.brancheforslag_for_navne(text[]) from public, anon, authenticated;
