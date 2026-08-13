-- Smal dimensionstabel til markedsopslag: én række pr. (virksomhed, branchekode),
-- så både hovedbranche og bibrancher kan slås op med ét indeks.
--
-- HVORFOR: målt på produktionsdata tog marked_statistik 6,1 sekunder og
-- soeg_marked 4,1 — mod PostgREST's loft på 8. EXPLAIN viste at indekserne
-- blev brugt korrekt; tiden gik med at hente 33.727 BREDE rækker fra
-- cvr_virksomhed_indeks (16.030 diskblokke). Statistikken har ikke brug for
-- rækkerne, kun for at tælle dem.
--
-- HVORFOR IKKE EN FÆRDIG OPTÆLLING PR. BRANCHEKODE: en virksomhed kan ramme
-- markedet gennem både sin hovedbranche og en bibranche, eller gennem to
-- forskellige bibrancher. Summerede man antal pr. kode, ville den tælle med
-- flere gange. Derfor holdes rækkerne på virksomhedsniveau og tælles med
-- count(distinct), som er eksakt.

-- "hovedbranche" står på ALLE rækker, også dem der repræsenterer en bibranche.
-- Det er dét, der gør det muligt at svare på "hvad laver de virksomheder vi
-- fandt" uden at slå op i den brede indekstabel. Netop det spørgsmål er
-- pointen i en markedsafdækning: søger man på fire IT-koder og får holding-
-- selskaber, designbureauer og ingeniørrådgivere med, er det et signal om at
-- markedet er bredere end de koder man startede med.
create materialized view public.marked_dim as
  select i.cvr, i.branchekode as kode, true as er_hoved,
         i.branchekode as hovedbranche,
         i.kommunekode, i.kommunenavn, i.virksomhedsform
  from public.cvr_virksomhed_indeks i
  where i.ophoert = false and i.branchekode is not null
union all
  select i.cvr, b as kode, false as er_hoved,
         i.branchekode as hovedbranche,
         i.kommunekode, i.kommunenavn, i.virksomhedsform
  from public.cvr_virksomhed_indeks i, unnest(i.bibrancher) as b
  where i.ophoert = false;

create index marked_dim_kode on public.marked_dim (kode);
create index marked_dim_kode_kommune on public.marked_dim (kode, kommunekode);
create unique index marked_dim_unik on public.marked_dim (cvr, kode);

-- Branchetekster gemmes kun på hovedbranchen i indekset. Bibrancher er bare
-- koder, så teksten slås op her når en kode optræder som bibranche.
create materialized view public.branche_tekst as
  select distinct on (branchekode) branchekode as kode, branchetekst as tekst
  from public.cvr_virksomhed_indeks
  where branchekode is not null and branchetekst is not null;

create unique index branche_tekst_kode on public.branche_tekst (kode);

alter materialized view public.marked_dim owner to postgres;
alter materialized view public.branche_tekst owner to postgres;

revoke all on public.marked_dim from anon, authenticated;
revoke all on public.branche_tekst from anon, authenticated;
