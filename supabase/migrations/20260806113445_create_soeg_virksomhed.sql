-- Navnesøgning med rangering, vigtigst først:
--   0  præcist navnematch
--   1  navnet begynder med søgeteksten
--   2  søgeteksten indgår i navnet
--   3  ingen tekstmatch, men trigram-lighed (fanger stavefejl)
-- Aktive virksomheder vægtes over ophørte.
--
-- Ligger i SQL frem for i Edge Function'en, så databasen kan bruge
-- trigram-indekset til både filtrering og sortering.

create or replace function public.soeg_virksomhed(soegetekst text, maks int default 10)
returns table (cvr bigint, navn text, status text, ophoert boolean, lighed real)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with q as (select lower(trim(soegetekst)) as t)
  select i.cvr, i.navn, i.status, i.ophoert, similarity(lower(i.navn), q.t) as lighed
  from public.cvr_virksomhed_indeks i, q
  where q.t <> ''
    and (lower(i.navn) like '%' || q.t || '%' or lower(i.navn) % q.t)
  order by
    i.ophoert,
    case
      when lower(i.navn) = q.t then 0
      when lower(i.navn) like q.t || '%' then 1
      when lower(i.navn) like '%' || q.t || '%' then 2
      else 3
    end,
    similarity(lower(i.navn), q.t) desc,
    length(i.navn)
  limit greatest(1, least(maks, 50));
$$;

revoke all on function public.soeg_virksomhed(text, int) from public, anon, authenticated;
