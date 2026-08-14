-- Fjerner indekser, der er blevet overflødige, siden markedsopslagene flyttede
-- til marked_dim (20260813120000/20260813120100).
--
-- Målt på produktion 14. august 2026 med pg_stat_user_indexes. Tallene er
-- antal opslag siden statistikken sidst blev nulstillet, holdt op mod
-- primærnøglens 2.807.599:
--
--   cvr_indeks_aktive            40 MB     0 opslag
--   cvr_indeks_branche_kommune   16 MB     6 opslag
--   cvr_indeks_branche           15 MB     2 opslag
--   cvr_indeks_kommune           14 MB     0 opslag
--   cvr_indeks_bibrancher       6,6 MB     5 opslag
--   marked_dim_kode_kommune     8,1 MB     0 opslag
--   marked_dim_kode             6,8 MB     0 opslag
--                             ~106 MB
--
-- HVORFOR DE ER DØDE: de fire cvr_indeks_*-indekser blev lavet til
-- markedsopslag direkte mod den brede tabel. De opslag går nu gennem
-- marked_dim, som netop findes for ikke at røre den brede tabel. De to
-- marked_dim-indekser er afløst af marked_dim_kode_stoerrelse (51 opslag),
-- der dækker samme prædikat OG sorteringen.
--
-- cvr_indeks_aktive er et særtilfælde: et delvist indeks på (cvr) where
-- ophoert = false. Primærnøglen dækker cvr i forvejen, og tabellen indeholder
-- kun aktive virksomheder, fordi indlæsningen henter "current"-udtrækket og
-- rydder rækker den ikke rørte. Det har aldrig kunnet bruges til noget.
--
-- BEVARET MED VILJE: marked_dim_unik (30 MB) bruges kun én gang, men den er
-- ikke et opslagsindeks — den fanger, hvis en virksomhed skulle optræde to
-- gange under samme branchekode, hvilket ville dobbelttælle den i
-- markedsstatistikken. En korrekthedsgaranti er noget andet end dødvægt.
--
-- De tre navneindekser (trigram 97 MB, navn_norm 67 MB, kernenavn_norm 62 MB)
-- bæres af 396, 1.853 og 1.811 opslag og er appens hovedindgang. De røres ikke.

drop index if exists public.cvr_indeks_aktive;
drop index if exists public.cvr_indeks_branche;
drop index if exists public.cvr_indeks_branche_kommune;
drop index if exists public.cvr_indeks_kommune;
drop index if exists public.cvr_indeks_bibrancher;

drop index if exists public.marked_dim_kode_kommune;
drop index if exists public.marked_dim_kode;

-- Indekserne oprettes i 20260813103000 og 20260813120000. Skal de nogensinde
-- retableres, står definitionerne dér — de er ikke slettet, kun droppet.
