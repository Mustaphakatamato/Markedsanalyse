-- Rangér og afgræns markedssøgningen efter størrelse.
--
-- Ændringen i ét ord: soeg_marked() returnerede før et VILKÅRLIGT udsnit på
-- 200, den returnerer nu de 200 STØRSTE — og kan afgrænses til en
-- størrelsesklasse, så udsnittet trækkes inde fra den klasse i stedet for at
-- filtreres bagefter i browseren. Forskellen er afgørende: et marked med 7.388
-- rengøringsvirksomheder rummer 293 der er A/S eller har flere adresser. Filtrerer
-- man 200 vilkårlige rækker i browseren, ser man ~8 af dem. Afgrænser man i
-- databasen, ser man alle 293.
--
-- Se 20260814090000 for hvad "størrelse" måler, og hvad det ikke måler.

drop function if exists public.soeg_marked(text[], text[], int);

create or replace function public.soeg_marked(
  branchekoder text[],
  kommunekoder text[] default null,
  maks int default 200,
  -- null | 'selskab' | 'flere_adresser' | 'landsdaekkende'
  mindst_klasse text default null,
  -- 'stoerrelse' | 'navn'
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
      and (g.trin = 0
           or case d.stoerrelsesklasse
                when 'landsdaekkende' then 3
                when 'flere_adresser' then 2
                when 'selskab'        then 1
                else 0
              end >= g.trin)
    group by d.cvr
    -- Afgrænsningen sker HER, på den smalle tabel. Rangeringen er derfor
    -- markedsdækkende, ikke en sortering af 200 tilfældige rækker.
    order by max(d.stoerrelse_score) desc, min(d.startdato) asc nulls last, d.cvr
    limit greatest(1, least(maks, 2000))
  )
  select i.cvr, i.navn, i.branchekode, i.branchetekst, i.bibrancher,
         i.kommunekode, i.kommunenavn, i.postnummer, i.postdistrikt,
         i.virksomhedsform, t.hoved,
         i.antal_penheder, i.startdato,
         public.stoerrelsesklasse(i.antal_penheder, i.virksomhedsformkode)
  from traf t
  join public.cvr_virksomhed_indeks i on i.cvr = t.fundet_cvr
  -- Visningsrækkefølgen er brugerens valg. Ved 'navn' er den RENT alfabetisk —
  -- også hovedbranche-nøglen slås fra, ellers ville listen se ud som to
  -- alfabeter efter hinanden, og det ligner en fejl. Ved 'stoerrelse' er det
  -- samme nøgle som udvælgelsen, så listen ikke skifter orden mellem det
  -- databasen valgte og det skærmen viser.
  order by
    case when sortering = 'navn' then 0 else -t.score end,
    case when sortering = 'navn' then null else t.startdato end asc nulls last,
    case when sortering = 'navn' then null else t.hoved end desc nulls last,
    i.navn;
$$;

revoke all on function public.soeg_marked(text[], text[], int, text, text)
  from public, anon, authenticated;


-- Statistikken får størrelsesfordelingen med. Den er ikke pynt: den er svaret
-- på "kan markedet bære ét samlet udbud". Står der 4 % i klasserne over
-- 'mikro', er spørgsmålet om opdeling i delkontrakter allerede besvaret.
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
           d.kommunekode, d.kommunenavn, d.virksomhedsform, d.stoerrelsesklasse
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
           max(kommunenavn) as kommunenavn,
           max(virksomhedsform) as virksomhedsform,
           -- Alle rækker for samme virksomhed bærer samme klasse; max() er
           -- blot måden at få den ud af aggregeringen på.
           max(stoerrelsesklasse) as stoerrelsesklasse
    from rel
    group by cvr
  )
  select jsonb_build_object(
    'ialt', (select count(*) from pr_virksomhed),
    'hovedbranche', (select count(*) from pr_virksomhed where har_hoved),
    'kunBibranche', (select count(*) from pr_virksomhed where not har_hoved),
    'prBranche', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('kode', v.hovedbranche, 'tekst', bt.tekst, 'antal', count(*)) as x
        from pr_virksomhed v
        left join public.branche_tekst bt on bt.kode = v.hovedbranche
        where v.hovedbranche is not null
        group by v.hovedbranche, bt.tekst
        order by count(*) desc
        limit 25
      ) s), '[]'::jsonb),
    'prKommune', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('kode', kommunekode, 'navn', kommunenavn, 'antal', count(*)) as x
        from pr_virksomhed
        where kommunekode is not null
        group by kommunekode, kommunenavn
        order by count(*) desc
        limit 30
      ) s), '[]'::jsonb),
    'prSelskabsform', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('form', virksomhedsform, 'antal', count(*)) as x
        from pr_virksomhed
        where virksomhedsform is not null
        group by virksomhedsform
        order by count(*) desc
        limit 15
      ) s), '[]'::jsonb),
    -- Nøglet på klasse frem for en liste, så klienten kan slå op uden at lede
    -- og uden at skulle håndtere en manglende klasse som "0 eller udefineret".
    'prStoerrelse', (
      select jsonb_object_agg(k, n) from (
        select stoerrelsesklasse as k, count(*) as n
        from pr_virksomhed
        group by stoerrelsesklasse
      ) s)
  );
$$;

revoke all on function public.marked_statistik(text[], text[]) from public, anon, authenticated;
