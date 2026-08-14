-- Kandidater udvalgt på track record frem for på størrelse.
--
-- HVORFOR: rangering efter organisationens udstrækning (se 20260814090000)
-- gjorde listen brugbar, men den svarer stadig kun på "hvem er stor i denne
-- branche" — ikke på "hvem har rent faktisk løftet den her slags opgave for en
-- dansk ordregiver". Branchekoden er virksomhedens egen registrering; en
-- tildeling er et faktum.
--
-- Kilden er TED's kontrakttildelinger afgrænset til buyer-country=DNK. Målt
-- direkte mod API'et 14. august dækker den for CPV 90910000 (rengøring) 921
-- danske tildelinger tilbage til 2016 — nok til en meningsfuld rangering.
--
-- HVAD DEN IKKE DÆKKER, og hvorfor CVR-listen bliver stående ved siden af:
-- TED kender kun udbud over EU's tærskelværdi. En leverandør, der aldrig har
-- vundet et EU-udbud, findes ikke her — heller ikke hvis den er fuldt i stand
-- til at løfte opgaven. Bruger man denne liste alene, bekræfter man de store og
-- skjuler resten, hvilket er præcis den fejl markedsafdækningen skal undgå
-- (og som gør "opdel eller forklar" umulig at besvare). De to lister svarer på
-- hver sit spørgsmål og skal begge kunne vælges.

-- ---------------------------------------------------------------- navneopslag
--
-- Fra en liste af TED-vindernavne til de virksomheder, de svarer til i CVR.
-- Samme matchningsregler som brancheforslag_for_navne() — navn_normaliser()
-- og navn_kerne() — men her skal selve virksomheden ud, ikke en
-- branchefordeling.
--
-- MATCHNINGEN ER BEVIDST KONSERVATIV, og resultatet er ét af tre:
--   traf_antal = 1  virksomheden er fundet entydigt, felterne er udfyldt
--   traf_antal > 1  flere aktive selskaber bærer navnet — felterne er NULL
--   traf_antal = 0  intet match (typisk en udenlandsk vinder uden dansk CVR)
--
-- Den midterste er grunden til at funktionen ikke bare vælger det første træf.
-- "A Rengøring" findes flere gange i CVR, og at tilskrive den ene virksomheds
-- kontrakter til den anden er værre end at lade feltet stå tomt: det ligner et
-- svar. UI'et viser navnet og dets sejre alligevel — kun koblingen udelades.
create or replace function public.virksomheder_for_navne(navne text[])
returns table (
  soegt_navn text,
  traf_antal int,
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
  antal_penheder int,
  startdato date,
  stoerrelsesklasse text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with soegte as (
    select distinct btrim(n) as soegt
    from unnest(navne) as n
    where n is not null and btrim(n) <> ''
  ),
  noegler as (
    select soegt,
           public.navn_normaliser(soegt) as n_fuld,
           public.navn_normaliser(public.navn_kerne(soegt)) as n_kerne
    from soegte
  ),
  -- Tre veje til et match, rangeret. Niveauet er ikke kosmetik: det afgør
  -- hvilke træf der overhovedet kommer i betragtning, så et eksakt navnematch
  -- aldrig fortyndes af de løsere kernenavn-match.
  --
  -- Hvert led er sit eget opslag frem for ét OR. Skrevet som ét OR ville
  -- planlæggeren falde tilbage til at scanne alle 870.564 rækker i stedet for
  -- at bruge udtryksindekserne — samme grund som i brancheforslag_for_navne().
  traf as (
    -- 1: TED-navnet er præcis CVR-navnet ("Atea A/S" = "Atea A/S")
    select k.soegt, i.cvr, 1 as niveau
    from noegler k
    join public.cvr_virksomhed_indeks i on public.navn_normaliser(i.navn) = k.n_fuld
    where i.ophoert = false
    union all
    -- 2: TED skrev selskabsformen, CVR gjorde ikke
    select k.soegt, i.cvr, 2
    from noegler k
    join public.cvr_virksomhed_indeks i on public.navn_normaliser(i.navn) = k.n_kerne
    where i.ophoert = false and k.n_kerne <> k.n_fuld
    union all
    -- 3: CVR skrev selskabsformen, TED gjorde ikke ("Beta IT" -> "Beta IT ApS").
    -- Dette led er det, der løftede match-raten mod rigtige TED-data fra 76 %
    -- til 93 % for bygge og anlæg.
    select k.soegt, i.cvr, 3
    from noegler k
    join public.cvr_virksomhed_indeks i
      on public.navn_normaliser(public.navn_kerne(i.navn)) = k.n_kerne
    where i.ophoert = false
  ),
  bedste as (
    select soegt, min(niveau) as niveau from traf group by soegt
  ),
  udvalgt as (
    select distinct t.soegt, t.cvr
    from traf t
    join bedste b on b.soegt = t.soegt and b.niveau = t.niveau
  ),
  optalt as (
    select soegt, count(*)::int as antal, min(cvr) as ene_cvr
    from udvalgt
    group by soegt
  )
  select s.soegt,
         coalesce(o.antal, 0),
         i.cvr, i.navn, i.branchekode, i.branchetekst, i.bibrancher,
         i.kommunekode, i.kommunenavn, i.postnummer, i.postdistrikt,
         i.virksomhedsform, i.antal_penheder, i.startdato,
         public.stoerrelsesklasse(i.antal_penheder, i.virksomhedsformkode)
  from soegte s
  left join optalt o on o.soegt = s.soegt
  -- Kun ved præcis ét træf kobles virksomheden på. Ved flere står navnet
  -- tilbage uden CVR-nummer, og det er meningen.
  left join public.cvr_virksomhed_indeks i
    on o.antal = 1 and i.cvr = o.ene_cvr;
$$;

revoke all on function public.virksomheder_for_navne(text[]) from public, anon, authenticated;


-- ---------------------------------------------------------------------- cache
--
-- Optællingen koster op til fire TED-kald à 250 notices. Svaret ændrer sig kun
-- når der offentliggøres nye tildelinger, og en markedsanalyse laves ikke i ét
-- stræk — brugeren vender tilbage til samme udbud flere gange. TTL sættes af
-- funktionen (et døgn), ikke af skemaet.
create table if not exists public.ted_vindere_cache (
  query_hash text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.ted_vindere_cache enable row level security;
revoke all on public.ted_vindere_cache from anon, authenticated;

create index if not exists ted_vindere_cache_fetched_at_idx
  on public.ted_vindere_cache (fetched_at);
