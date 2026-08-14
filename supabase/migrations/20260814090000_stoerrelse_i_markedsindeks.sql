-- Størrelse i markedsindekset: gør kandidatlisten rangerbar efter hvor stor en
-- organisation virksomheden er.
--
-- HVORFOR: soeg_marked() valgte hidtil "de første 200 efter hovedbranche og
-- derefter CVR-nummer" — altså et vilkårligt udsnit. I et rigtigt marked er
-- det ubrugeligt. Målt på rengøringsbranchen (812100, 7.388 aktive
-- virksomheder) er 64 % enkeltmandsvirksomheder eller personligt ejede mindre
-- virksomheder, og kun 293 virksomheder (4,0 %) er enten aktieselskab eller
-- har mere end ét forretningssted. Et vilkårligt udsnit på 200 rammer derfor
-- ca. 8 af dem. Ordregiveren, som skal finde nogen der kan løfte opgaven,
-- skulle læse 200 rækker for at finde otte.
--
-- HVAD MÅLET ER, OG HVAD DET IKKE ER: omsætning og antal ansatte findes IKKE
-- i CVR's bulkudtræk. Beskaeftigelse-entiteten svarer 404 hos Datafordeleren,
-- og Erhvervsstyrelsens regnskabs-API (distribution.virk.dk) udstiller kun
-- dokument-URL'er, ikke nøgletal — de skal parses ét regnskab ad gangen.
-- Størrelsen her måles derfor på to ting, der FINDES for hele populationen:
--
--   1. antal aktive produktionsenheder (forretningssteder)
--   2. selskabsform
--
-- Det er et mål for organisationens UDSTRÆKNING, ikke for dens omsætning. Et
-- rådgivningshus med 300 ansatte på én adresse rangerer som "kapitalselskab",
-- side om side med et enmands-ApS. Derfor er rangeringen kun en forsortering:
-- de rigtige tal hentes stadig pr. virksomhed gennem regnskabsberigelsen. UI'et
-- skal sige det, ikke skjule det.

alter table public.cvr_virksomhed_indeks
  add column if not exists antal_penheder int,
  -- Alderen er ikke et størrelsesmål, men den er et rimeligt tiebreak inden
  -- for samme klasse: mellem to enmands-ApS'er i samme branche er det 30 år
  -- gamle det, der har en historik at spørge ind til.
  add column if not exists startdato date;


-- Selskabsformens vægt. Egen funktion frem for et udtryk inde i view'et, så
-- definitionen står ét sted og kan læses uden at læse view'et.
--
-- Koderne er Erhvervsstyrelsens egne (feltet 'vaerdi' i bulkfilen
-- Virksomhedsform). Vægten udtrykker ét spørgsmål: hvor sandsynligt er det, at
-- formen rummer en organisation med ansatte og kapital bag sig?
create or replace function public.selskabsform_vaegt(formkode text)
returns int
language sql
immutable
parallel safe
as $$
  select case formkode
    -- Kapitalkrav og revisionspligt: A/S, P/S, erhvervsdrivende fond, SE.
    when '60'  then 5   -- Aktieselskab
    when '70'  then 5   -- Kommanditaktieselskab/Partnerselskab
    when '100' then 5   -- Erhvervsdrivende fond
    when '290' then 5   -- SE-selskab
    when '285' then 5   -- Særlig finansiel virksomhed
    when '235' then 5   -- Selvstændig offentlig virksomhed
    -- Selskabsformer med begrænset ansvar, uden A/S'ets kapitalkrav.
    when '80'  then 3   -- Anpartsselskab
    when '151' then 3   -- Selskab med begrænset ansvar
    when '130' then 3   -- Andelsselskab (-forening)
    when '140' then 3   -- Andelsselskab med begrænset ansvar
    when '90'  then 3   -- Fonde og andre selvejende institutioner
    when '40'  then 3   -- Kommanditselskab
    when '210' then 3   -- Anden udenlandsk virksomhed
    when '170' then 3   -- Filial af udenlandsk A/S
    when '180' then 3   -- Filial af udenlandsk ApS
    when '190' then 3   -- Filial af udenlandsk virksomhed m. begrænset ansvar
    when '291' then 3   -- Filial af SE-selskab
    when '520' then 3   -- Grønlandsk afdeling af udenlandsk selskab
    -- Personligt hæftende, men reelle virksomheder.
    when '30'  then 2   -- Interessentskab
    when '50'  then 2   -- Partrederi
    when '81'  then 2   -- Iværksætterselskab
    when '160' then 2   -- Europæisk Økonomisk Firmagruppe
    when '280' then 2   -- Øvrige virksomhedsformer
    -- Enkeltmand og dødsboer: én person, ingen organisation bag.
    when '10'  then 0   -- Enkeltmandsvirksomhed
    when '15'  then 0   -- Personligt ejet Mindre Virksomhed
    when '20'  then 0   -- Dødsbo
    -- Foreninger og offentlige enheder optræder i markedsopslag, men er
    -- sjældent tilbudsgivere. De skal kunne ses, ikke ligge øverst.
    else 1
  end;
$$;


-- Klassen der vises i UI'et. Fire trin, fordi flere ville foregøgle en
-- præcision målet ikke har.
create or replace function public.stoerrelsesklasse(antal_penheder int, formkode text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    -- Ti forretningssteder eller flere: en organisation der dækker et område,
    -- ikke en adresse. 977 danske virksomheder i alt.
    when coalesce(antal_penheder, 0) >= 10 then 'landsdaekkende'
    -- Mere end ét sted er den skarpeste billige skillelinje der findes:
    -- 97 % af alle aktive danske virksomheder har præcis ét.
    when coalesce(antal_penheder, 0) >= 2  then 'flere_adresser'
    when public.selskabsform_vaegt(formkode) >= 3 then 'selskab'
    else 'mikro'
  end;
$$;


-- Selve rangeringstallet. Forretningssteder vejer tungest, selskabsformen
-- afgør inden for samme antal. Loftet på 200 findes for at en enkelt
-- ekstremværdi (Danske Bank har hundredvis af P-enheder) ikke gør resten af
-- skalaen ligegyldig — over 200 er "meget stor" alligevel.
create or replace function public.stoerrelse_score(antal_penheder int, formkode text)
returns int
language sql
immutable
parallel safe
as $$
  select least(greatest(coalesce(antal_penheder, 1), 1), 200) * 10
       + public.selskabsform_vaegt(formkode);
$$;


-- marked_dim skal bære score og klasse, ellers kan rangeringen ikke ske på den
-- smalle tabel — og så er vi tilbage ved at hente 33.727 brede rækker for at
-- kunne sortere dem. Et materialiseret view kan ikke udvides med nye kolonner,
-- så det bygges forfra.
drop materialized view if exists public.marked_dim;

create materialized view public.marked_dim as
  select i.cvr, i.branchekode as kode, true as er_hoved,
         i.branchekode as hovedbranche,
         i.kommunekode, i.kommunenavn, i.virksomhedsform,
         public.stoerrelse_score(i.antal_penheder, i.virksomhedsformkode) as stoerrelse_score,
         public.stoerrelsesklasse(i.antal_penheder, i.virksomhedsformkode) as stoerrelsesklasse,
         i.startdato
  from public.cvr_virksomhed_indeks i
  where i.ophoert = false and i.branchekode is not null
union all
  select i.cvr, b as kode, false as er_hoved,
         i.branchekode as hovedbranche,
         i.kommunekode, i.kommunenavn, i.virksomhedsform,
         public.stoerrelse_score(i.antal_penheder, i.virksomhedsformkode),
         public.stoerrelsesklasse(i.antal_penheder, i.virksomhedsformkode),
         i.startdato
  from public.cvr_virksomhed_indeks i, unnest(i.bibrancher) as b
  where i.ophoert = false;

create index marked_dim_kode on public.marked_dim (kode);
create index marked_dim_kode_kommune on public.marked_dim (kode, kommunekode);
create unique index marked_dim_unik on public.marked_dim (cvr, kode);

-- Det varme opslag efter denne ændring: "de største i branche X".
create index marked_dim_kode_stoerrelse on public.marked_dim (kode, stoerrelse_score desc);

alter materialized view public.marked_dim owner to postgres;
revoke all on public.marked_dim from anon, authenticated;
analyze public.marked_dim;
