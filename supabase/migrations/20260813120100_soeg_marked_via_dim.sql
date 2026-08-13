-- Lægger soeg_marked() og marked_statistik() om på marked_dim, så de kan
-- svare inden for PostgREST's loft på 8 sekunder. Signaturer og returformat
-- er uændrede — kun vejen til svaret.

-- Rangering: hovedbranche før bibranche, derefter CVR-nummer. CVR-nummeret er
-- vilkårligt, men stabilt, og det er bevidst: en meningsfuld rangering
-- (størrelse, økonomi, offentlig track record) kræver data vi først har efter
-- berigelsen. En alfabetisk liste ville se sorteret ud uden at være det —
-- "1337 ApS" øverst siger intet om relevans. De udvalgte rækker sorteres
-- alfabetisk til visning, så listen er rolig at læse.
--
-- Afgrænsningen sker på den smalle marked_dim, så kun de udvalgte rækker
-- hentes fra den brede indekstabel. Før hentede den alle 33.727 og smed
-- overskuddet væk.

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
  with traf as (
    select d.cvr as fundet_cvr, bool_or(d.er_hoved) as hoved
    from public.marked_dim d
    where coalesce(array_length(branchekoder, 1), 0) > 0
      and d.kode = any(branchekoder)
      and (kommunekoder is null
           or coalesce(array_length(kommunekoder, 1), 0) = 0
           or d.kommunekode = any(kommunekoder))
    group by d.cvr
    order by bool_or(d.er_hoved) desc, d.cvr
    limit greatest(1, least(maks, 2000))
  )
  select i.cvr, i.navn, i.branchekode, i.branchetekst, i.bibrancher,
         i.kommunekode, i.kommunenavn, i.postnummer, i.postdistrikt,
         i.virksomhedsform, t.hoved
  from traf t
  join public.cvr_virksomhed_indeks i on i.cvr = t.fundet_cvr
  order by t.hoved desc, i.navn;
$$;

revoke all on function public.soeg_marked(text[], text[], int) from public, anon, authenticated;


-- Optællingen sker på virksomhedsniveau, ikke pr. branchekode: en virksomhed
-- kan ramme markedet gennem både hovedbranche og bibranche, og må kun tælle
-- én gang i 'ialt'. 'prBranche' tæller derimod pr. kode, hvor hver virksomhed
-- optræder præcis én gang (unikt indeks på cvr, kode).

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
           d.kommunekode, d.kommunenavn, d.virksomhedsform
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
           max(virksomhedsform) as virksomhedsform
    from rel
    group by cvr
  )
  select jsonb_build_object(
    'ialt', (select count(*) from pr_virksomhed),
    'hovedbranche', (select count(*) from pr_virksomhed where har_hoved),
    'kunBibranche', (select count(*) from pr_virksomhed where not har_hoved),
    -- Grupperet på virksomhedens EGEN hovedbranche, ikke på de søgte koder:
    -- svarer på "hvad laver de her virksomheder", ikke "hvordan fordelte mine
    -- søgeord sig". Hver virksomhed tælles én gang, uanset hvor mange af de
    -- søgte koder den ramte.
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
      ) s), '[]'::jsonb)
  );
$$;

revoke all on function public.marked_statistik(text[], text[]) from public, anon, authenticated;
