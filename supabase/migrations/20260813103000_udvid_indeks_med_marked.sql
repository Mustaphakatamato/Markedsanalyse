-- Udvider navneindekset til et markedsindeks: branche, geografi og selskabsform
-- pr. aktiv dansk virksomhed (se scripts/indlaes-cvr-indeks.mjs).
--
-- HVORFOR: en markedsanalyse skal kunne besvare "hvem findes der i dette
-- marked" — ikke kun "hvem har vundet et EU-udbud før". TED kender kun
-- historiske vindere over EU's tærskelværdi, hvilket systematisk skjuler
-- mindre og nye leverandører. Det er præcis den population en ordregiver
-- skal afdække, bl.a. for at kunne begrunde opdeling i delkontrakter.
--
-- HVORFOR HER OG IKKE MOD KILDEN: samme begrundelse som navneindekset —
-- Datafordelerens GraphQL kan kun filtrere strenge med "eq"/"in", tillader
-- kun ét rodfelt pr. forespørgsel og forbyder aliaser. Et opslag "alle
-- virksomheder med branchekode X i kommune Y" er derfor umuligt direkte
-- mod kilden. Felterne kommer fra bulkfilerne Branche, Adressering og
-- Virksomhedsform, der alle joiner på CVREnhedsId ligesom Navn.

alter table public.cvr_virksomhed_indeks
  add column if not exists branchekode        text,
  add column if not exists branchetekst       text,
  -- Bibrancher er reelle for markedsafdækning: en virksomhed med
  -- hovedbranche "Bogføring og revision" kan have IT-drift som bibranche og
  -- er dermed en relevant leverandør. Array frem for egen tabel, fordi der
  -- typisk er 0-3 og de aldrig forespørges uden virksomheden.
  add column if not exists bibrancher         text[],
  add column if not exists kommunekode        text,
  add column if not exists kommunenavn        text,
  add column if not exists postnummer         text,
  add column if not exists postdistrikt       text,
  add column if not exists virksomhedsform    text,
  add column if not exists virksomhedsformkode text;

-- Opslaget "alle aktive i branche X" er modulets varmeste forespørgsel.
create index if not exists cvr_indeks_branche on public.cvr_virksomhed_indeks (branchekode)
  where ophoert = false;

-- Overlap-opslag (&&) mod bibrancher kræver GIN.
create index if not exists cvr_indeks_bibrancher on public.cvr_virksomhed_indeks
  using gin (bibrancher);

create index if not exists cvr_indeks_kommune on public.cvr_virksomhed_indeks (kommunekode)
  where ophoert = false;

-- Sammensat indeks til det typiske "branche + geografi"-filter, så begge
-- prædikater kan afvikles i ét indeksopslag.
create index if not exists cvr_indeks_branche_kommune on public.cvr_virksomhed_indeks
  (branchekode, kommunekode) where ophoert = false;
