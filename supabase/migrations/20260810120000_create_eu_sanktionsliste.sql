-- EU's konsoliderede sanktionsliste (Financial Sanctions Files), indlæst fra
-- webgate.ec.europa.eu (se scripts/indlaes-eu-sanktioner.mjs). Erstatter det
-- hardkodede sanctionsMatch: false i esgService.js — det gamle "tjek" kunne
-- aldrig finde noget, uanset hvem man slog op.
--
-- Én række pr. navn-alias (en sanktioneret enhed/person har typisk flere
-- navnevarianter/translitterationer) — matches gøres på navn_norm, ikke navn.
create table public.eu_sanktionsliste (
  alias_id bigint primary key,
  entity_id bigint not null,
  navn text not null,
  navn_norm text not null,
  subjekt_type text,
  programme text,
  opdateret timestamptz not null default now()
);

create index eu_sanktioner_navn_norm on public.eu_sanktionsliste (navn_norm);

alter table public.eu_sanktionsliste enable row level security;
revoke all on public.eu_sanktionsliste from anon, authenticated;
