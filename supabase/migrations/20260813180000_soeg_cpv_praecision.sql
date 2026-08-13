-- Retter rangeringen i soeg_cpv(): matchets stramhed skal veje tungere end
-- kodens bredde.
--
-- FUNDET VED AT KØRE FLOWET: en søgning på "rengøring" gav
-- 39800000 "Rengørings-, pudse- og poleringsmidler" øverst — altså
-- rengøringsMIDLER — mens 90910000 "Rengøring", selve ydelsen, lå nummer tre.
-- Begge betegnelser begynder med søgeordet, så de havde samme rang, og
-- derefter afgjorde niveauet: 39800000 er en bredere kode.
--
-- RETTELSEN ER ÉN NY RANG, IKKE EN NY SORTERING. Det, der manglede, var at
-- et EKSAKT match har sin egen plads: skriver nogen præcis "rengøring", er
-- den kode, der HEDDER det, aldrig et gæt. Med den rang på plads falder
-- 90910000 øverst af sig selv, og "bredere kode først" kan blive stående
-- uændret for alt andet.
--
-- Et forsøg på i stedet at sortere efter betegnelsens LÆNGDE blev forkastet:
-- det rettede "rengøring", men ødelagde "bygge", som så gav 45210000
-- Byggearbejde frem for hovedgruppen 45000000 Bygge- og anlægsarbejder. De to
-- tilfælde trækker i hver sin retning, og længde er derfor det forkerte greb.

create or replace function public.soeg_cpv(soegetekst text, maks int default 20)
returns table (kode text, tekst text, niveau smallint, overordnet text, overordnet_tekst text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with q as (select lower(trim(soegetekst)) as t)
  select c.kode, c.tekst, c.niveau, c.overordnet, o.tekst as overordnet_tekst
  from public.cpv_koder c
  left join public.cpv_koder o on o.kode = c.overordnet, q
  where q.t <> ''
    and (c.kode like q.t || '%'
         or lower(c.tekst) like '%' || q.t || '%'
         or lower(c.tekst) % q.t)
  order by
    case
      when c.kode like q.t || '%' then 0        -- man skriver et kodepræfiks
      when lower(c.tekst) = q.t then 1          -- betegnelsen ER søgeordet
      when lower(c.tekst) like q.t || '%' then 2
      when lower(c.tekst) like '%' || q.t || '%' then 3
      else 4                                    -- kun trigram-lighed
    end,
    c.niveau,          -- inden for samme rang: bredest først
    similarity(lower(c.tekst), q.t) desc,
    c.kode
  limit greatest(1, least(maks, 50));
$$;

revoke all on function public.soeg_cpv(text, int) from public, anon, authenticated;
