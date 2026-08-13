-- Udleder branchekoder for et CPV-område ved at slå TED-vinderne op i CVR.
--
-- HVORFOR: der findes ingen officiel oversættelse mellem CPV (hvad der købes)
-- og DB25/NACE (hvad en virksomhed laver). En håndlavet tabel ville være et
-- gæt, vi ikke kan dokumentere. I stedet spørger vi de data vi har: hvilke
-- brancher har de virksomheder, der rent faktisk har vundet udbud i dette
-- CPV-felt? Det er efterprøvbart og kan vises for ordregiveren.
--
-- MÅLT PÅ RIGTIGE DATA (2026-08-13, 100 seneste danske tildelinger pr. kode):
--   CPV 72222300 IT-drift      60 % navne matchet  ->  622000+621000 = 65 %
--   CPV 45000000 Bygge/anlæg   76 %                ->  410000 19 %, så fagene
--   CPV 79600000 Rekruttering  67 %                ->  782000 29 %
--   CPV 90500000 Affald        73 %                ->  382100+494100+381100
--
-- FORSLAGET MÅ ALDRIG ANVENDES AUTOMATISK. To fejlkilder er systematiske:
-- vinderen er ofte moderselskabet, så holdingbrancher (642120, 649990) dukker
-- op i stedet for driftsbranchen; og navnematch kan ramme et andet selskab med
-- samme navn. Ordregiveren skal se andelene og kunne rette dem.

-- Normaliseringen ligger her og ikke i JavaScript, selvom tedService.js har en
-- tilsvarende. To implementeringer af samme matchning kan give modstridende
-- svar for samme firma, og opslaget skal ske i databasen for at kunne bruge et
-- indeks. Skal være IMMUTABLE for at kunne indekseres.
--
-- Bevidst identisk med normalizeForMatch() i tedService.js: accenter fjernes
-- (å -> a), mens ø og æ falder igennem til mellemrum, fordi de ikke dekomponerer
-- i NFD. Rettes den ene, skal den anden rettes med.
create or replace function public.navn_normaliser(navn text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select trim(regexp_replace(
    translate(
      lower(navn),
      'áàâäãåéèêëíìîïóòôöõúùûüýÿñç',
      'aaaaaaeeeeiiiiooooouuuuyync'
    ),
    '[^a-z0-9]+', ' ', 'g'));
$$;

-- Fjerner det der typisk står i CVR, men ikke i TED's vindernavn: selskabsform
-- til sidst, og "v/<indehaver>" på enkeltmandsvirksomheder. Samme regler som
-- coreCompanyName() i tedService.js.
create or replace function public.navn_kerne(navn text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select trim(regexp_replace(
    regexp_replace(navn, '\s+v/.*$', '', 'i'),
    '[\s,]+(a/s|aps|ivs|i/s|k/s|p/s|a\.m\.b\.a\.|amba|smba|fmba)\.?$', '', 'i'));
$$;

-- Udtryksindeks frem for en kolonne: en genereret kolonne på 870.564 rækker
-- ville kræve en fuld omskrivning af tabellen og dermed en ny indlæsning.
create index if not exists cvr_indeks_navn_norm
  on public.cvr_virksomhed_indeks (public.navn_normaliser(navn))
  where ophoert = false;

-- Og på kernenavnet, fordi TED ofte skriver vinderen uden selskabsform
-- ("Beta IT") hvor CVR har den med ("Beta IT ApS"). Uden dette indeks ville
-- den sammenligning enten blive tabt eller tvinge en fuld scanning.
create index if not exists cvr_indeks_kernenavn_norm
  on public.cvr_virksomhed_indeks (public.navn_normaliser(public.navn_kerne(navn)))
  where ophoert = false;


-- Slår en liste af vindernavne op og returnerer den branchefordeling, de
-- tilsammen peger på. Matchningen er bevidst konservativ — kun eksakt match på
-- normaliseret navn eller kernenavn. Fuzzy match ville trække tilfældige
-- brancher ind i fordelingen, og et forkert forslag er værre end et smalt.
create or replace function public.brancheforslag_for_navne(navne text[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with sogte as (
    select distinct public.navn_normaliser(n) as n
    from unnest(navne) as n
    where n is not null and n <> ''
    union
    select distinct public.navn_normaliser(public.navn_kerne(n))
    from unnest(navne) as n
    where n is not null and n <> ''
  ),
  -- Selskabsformen kan mangle på begge sider: TED skriver "Beta IT" hvor CVR
  -- har "Beta IT ApS", og omvendt kan TED have "Atea A/S" hvor navnet i CVR
  -- er uden. Derfor sammenlignes både fulde navne og kernenavne — som to
  -- separate opslag, så hvert af dem kan bruge sit udtryksindeks. Skrevet som
  -- ét OR ville planlæggeren falde tilbage til at scanne alle 870.564 rækker.
  fundne as (
    select i.cvr, i.branchekode, i.branchetekst
    from public.cvr_virksomhed_indeks i
    join sogte s on s.n = public.navn_normaliser(i.navn)
    where i.ophoert = false
    union
    select i.cvr, i.branchekode, i.branchetekst
    from public.cvr_virksomhed_indeks i
    join sogte s on s.n = public.navn_normaliser(public.navn_kerne(i.navn))
    where i.ophoert = false
  ),
  traf as (
    -- distinct on (cvr): samme virksomhed kan rammes ad flere veje, men må
    -- kun tælle én gang i fordelingen.
    select distinct on (cvr) cvr, branchekode, branchetekst from fundne
  )
  select jsonb_build_object(
    'navneSlaaetOp', (select count(*) from unnest(navne) as n where n is not null and n <> ''),
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
