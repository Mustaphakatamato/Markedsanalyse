-- Genopbygger marked_dim uden de kolonner, den gentog fra indekset.
--
-- HVORFOR: Supabase-projektets disk løb fuld 14. august, hvilket satte
-- databasen i read-only. marked_dim fyldte 102 MB data + 37 MB indekser, og
-- 31 MB af det var tre kolonner, der enten stod med samme tekst på
-- hundredtusinder af rækker eller kunne regnes ud:
--
--   virksomhedsform     18 B/række  =  17 MB   (35 forskellige værdier)
--   kommunenavn          9 B/række  = 8,7 MB   (98 forskellige værdier)
--   stoerrelsesklasse    6 B/række  = 5,8 MB   (udledes af stoerrelse_score)
--
-- Teksterne slås nu op i to små opslagsvisninger i stedet. Klassen regnes ud
-- af scoren, hvor den skal bruges — de to har altid været samme funktion af
-- de samme to felter, så der var ingen grund til at gemme begge.
--
-- Rækkeantallet falder samtidig fra 987.202 til ~840.000, fordi foreninger,
-- dødsboer og folkekirkelige institutioner ikke længere er i indekset (se
-- fravalget i scripts/indlaes-cvr-indeks.mjs). En frivillig forening er ikke
-- en mulig tilbudsgiver, og at tælle 84.780 af dem med gjorde markedsbilledet
-- ringere, ikke bedre.

-- Opslagstabellerne. ALMINDELIGE TABELLER, ikke materialiserede visninger,
-- selvom de fyldes fra indekset her: næste skridt i oprydningen er at fjerne
-- de gentagne tekstkolonner FRA indekset, og en materialiseret visning ville
-- da ikke kunne genopbygges, fordi dens kilde var væk. Værdierne ændrer sig
-- desuden aldrig i praksis — der er 35 selskabsformer og 98 kommuner.
create table if not exists public.selskabsform_tekst (
  kode text primary key,
  tekst text not null
);

insert into public.selskabsform_tekst (kode, tekst)
select distinct on (virksomhedsformkode) virksomhedsformkode, virksomhedsform
from public.cvr_virksomhed_indeks
where virksomhedsformkode is not null and virksomhedsform is not null
on conflict (kode) do nothing;

create table if not exists public.kommune_tekst (
  kode text primary key,
  navn text not null
);

insert into public.kommune_tekst (kode, navn)
select distinct on (kommunekode) kommunekode, kommunenavn
from public.cvr_virksomhed_indeks
where kommunekode is not null and kommunenavn is not null
on conflict (kode) do nothing;

alter table public.selskabsform_tekst enable row level security;
alter table public.kommune_tekst enable row level security;
revoke all on public.selskabsform_tekst from anon, authenticated;
revoke all on public.kommune_tekst from anon, authenticated;


-- marked_dim bygges forfra. Kolonnerne er nu kun dem, opslagene faktisk
-- afgrænser og sorterer på — resten joines til, når de skal vises.
drop materialized view if exists public.marked_dim;

create materialized view public.marked_dim as
  select i.cvr, i.branchekode as kode, true as er_hoved,
         i.branchekode as hovedbranche,
         i.kommunekode,
         i.virksomhedsformkode,
         public.stoerrelse_score(i.antal_penheder, i.virksomhedsformkode) as stoerrelse_score,
         i.startdato
  from public.cvr_virksomhed_indeks i
  where i.ophoert = false and i.branchekode is not null
union all
  select i.cvr, b as kode, false as er_hoved,
         i.branchekode as hovedbranche,
         i.kommunekode,
         i.virksomhedsformkode,
         public.stoerrelse_score(i.antal_penheder, i.virksomhedsformkode),
         i.startdato
  from public.cvr_virksomhed_indeks i, unnest(i.bibrancher) as b
  where i.ophoert = false;

-- Det varme opslag: "de største i branche X". Dækker både prædikatet og
-- sorteringen, og afløser de tre indekser den gamle udgave havde.
create index marked_dim_kode_stoerrelse on public.marked_dim (kode, stoerrelse_score desc);

-- marked_dim_unik er IKKE genskabt. Den fyldte 30 MB og blev brugt én gang.
-- Entydigheden er sikret i konstruktionen i stedet: hovedbranchen giver præcis
-- én række pr. virksomhed, og indlæsningen fjerner hovedbranchen fra
-- bibranche-arrayet, før den skriver (se trin 7 i indlaes-cvr-indeks.mjs), så
-- unnest() ikke kan gentage den. Skal garantien tilbage, koster den 30 MB.

alter materialized view public.marked_dim owner to postgres;
revoke all on public.marked_dim from anon, authenticated;
analyze public.marked_dim;


-- soeg_marked() henter nu teksterne fra opslagsvisningerne. Signatur og
-- returformat er uændrede — kun vejen til de tre tekstfelter.
create or replace function public.soeg_marked(
  branchekoder text[],
  kommunekoder text[] default null,
  maks int default 200,
  mindst_klasse text default null,
  sortering text default 'stoerrelse'
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
  traf_hovedbranche boolean,
  antal_penheder int,
  startdato date,
  stoerrelsesklasse text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with graense as (
    select case mindst_klasse
             when 'landsdaekkende' then 3
             when 'flere_adresser' then 2
             when 'selskab'        then 1
             else 0
           end as trin
  ),
  traf as (
    select d.cvr as fundet_cvr,
           bool_or(d.er_hoved) as hoved,
           max(d.stoerrelse_score) as score,
           min(d.startdato) as startdato
    from public.marked_dim d, graense g
    where coalesce(array_length(branchekoder, 1), 0) > 0
      and d.kode = any(branchekoder)
      and (kommunekoder is null
           or coalesce(array_length(kommunekoder, 1), 0) = 0
           or d.kommunekode = any(kommunekoder))
      -- Klassen udledes nu af scoren frem for at være gemt. Trinnene følger
      -- stoerrelse_score()'s egen konstruktion: antal p-enheder gange ti plus
      -- selskabsformens vægt, så 100 = ti forretningssteder og 20 = to.
      and (g.trin = 0
           or case
                when d.stoerrelse_score >= 100 then 3
                when d.stoerrelse_score >= 20  then 2
                when d.stoerrelse_score % 10 >= 3 then 1
                else 0
              end >= g.trin)
    group by d.cvr
    order by max(d.stoerrelse_score) desc, min(d.startdato) asc nulls last, d.cvr
    limit greatest(1, least(maks, 2000))
  )
  select i.cvr, i.navn, i.branchekode, bt.tekst, i.bibrancher,
         i.kommunekode, kt.navn, i.postnummer, i.postdistrikt,
         sf.tekst, t.hoved,
         i.antal_penheder, i.startdato,
         public.stoerrelsesklasse(i.antal_penheder, i.virksomhedsformkode)
  from traf t
  join public.cvr_virksomhed_indeks i on i.cvr = t.fundet_cvr
  left join public.branche_tekst bt on bt.kode = i.branchekode
  left join public.kommune_tekst kt on kt.kode = i.kommunekode
  left join public.selskabsform_tekst sf on sf.kode = i.virksomhedsformkode
  order by
    case when sortering = 'navn' then 0 else -t.score end,
    case when sortering = 'navn' then null else t.startdato end asc nulls last,
    case when sortering = 'navn' then null else t.hoved end desc nulls last,
    i.navn;
$$;

revoke all on function public.soeg_marked(text[], text[], int, text, text)
  from public, anon, authenticated;


-- marked_statistik() grupperer nu på koder og slår teksten op til sidst.
-- Optællingen bliver den samme; kun etiketten kommer et andet sted fra.
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
  with rel as (
    select d.cvr, d.kode, d.er_hoved, d.hovedbranche,
           d.kommunekode, d.virksomhedsformkode, d.stoerrelse_score
    from public.marked_dim d
    where coalesce(array_length(branchekoder, 1), 0) > 0
      and d.kode = any(branchekoder)
      and (kommunekoder is null
           or coalesce(array_length(kommunekoder, 1), 0) = 0
           or d.kommunekode = any(kommunekoder))
  ),
  pr_virksomhed as (
    select cvr,
           bool_or(er_hoved) as har_hoved,
           max(hovedbranche) as hovedbranche,
           max(kommunekode) as kommunekode,
           max(virksomhedsformkode) as virksomhedsformkode,
           max(stoerrelse_score) as stoerrelse_score
    from rel
    group by cvr
  ),
  klassificeret as (
    select *,
           case
             when stoerrelse_score >= 100 then 'landsdaekkende'
             when stoerrelse_score >= 20  then 'flere_adresser'
             when stoerrelse_score % 10 >= 3 then 'selskab'
             else 'mikro'
           end as stoerrelsesklasse
    from pr_virksomhed
  )
  select jsonb_build_object(
    'ialt', (select count(*) from klassificeret),
    'hovedbranche', (select count(*) from klassificeret where har_hoved),
    'kunBibranche', (select count(*) from klassificeret where not har_hoved),
    'prBranche', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('kode', v.hovedbranche, 'tekst', bt.tekst, 'antal', count(*)) as x
        from klassificeret v
        left join public.branche_tekst bt on bt.kode = v.hovedbranche
        where v.hovedbranche is not null
        group by v.hovedbranche, bt.tekst
        order by count(*) desc
        limit 25
      ) s), '[]'::jsonb),
    'prKommune', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('kode', v.kommunekode, 'navn', kt.navn, 'antal', count(*)) as x
        from klassificeret v
        left join public.kommune_tekst kt on kt.kode = v.kommunekode
        where v.kommunekode is not null
        group by v.kommunekode, kt.navn
        order by count(*) desc
        limit 30
      ) s), '[]'::jsonb),
    -- LEFT join med fald tilbage til koden: mangler en selskabsform i
    -- opslagstabellen, skal den vise "80" frem for at forsvinde ud af
    -- fordelingen. En manglende etiket er til at få øje på; en virksomhed der
    -- lydløst ikke tælles med, er ikke.
    'prSelskabsform', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
                 'form', coalesce(sf.tekst, v.virksomhedsformkode),
                 'antal', count(*)) as x
        from klassificeret v
        left join public.selskabsform_tekst sf on sf.kode = v.virksomhedsformkode
        where v.virksomhedsformkode is not null
        group by coalesce(sf.tekst, v.virksomhedsformkode)
        order by count(*) desc
        limit 15
      ) s), '[]'::jsonb),
    'prStoerrelse', (
      select jsonb_object_agg(k, n) from (
        select stoerrelsesklasse as k, count(*) as n
        from klassificeret
        group by stoerrelsesklasse
      ) s)
  );
$$;

revoke all on function public.marked_statistik(text[], text[]) from public, anon, authenticated;
