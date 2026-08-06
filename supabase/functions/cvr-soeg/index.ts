// Navnesøgning mod vores eget CVR-indeks i Postgres.
//
// Findes fordi Datafordelerens GraphQL-tjeneste kun kan filtrere strenge med
// "eq" og "in" — der er ingen "contains", så "netcompany" ville give nul
// resultater dér. Indekset indlæses ugentligt fra Datafordelerens
// fildownload (se scripts/indlaes-cvr-navne.mjs).
//
// Rangeringen ligger i SQL-funktionen soeg_virksomhed(), så databasen kan
// bruge trigram-indekset til både at filtrere og sortere.
//
// Indekset dækker kun AKTIVE virksomheder — det er hvad Datafordelerens
// "current"-udtræk indeholder. Ophørte selskaber kan stadig slås op på
// CVR-nummer via cvr-datafordeler.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handlePreflight, json } from "../_shared/http.ts";

const serviceKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
  auth: { persistSession: false }
});

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  const maks = Math.min(Math.max(Number(params.get("maks")) || 10, 1), 50);

  if (q.length < 2) {
    return json({ error: "Søgeteksten skal være mindst to tegn." }, { status: 400 });
  }

  // Er søgeteksten et CVR-nummer, er der intet at søge efter — så er svaret
  // entydigt, og opslaget kan gå direkte videre til cvr-datafordeler.
  if (/^\d{8}$/.test(q)) {
    return json({ traf: [], cvr: q, erCvrNummer: true });
  }

  const { data, error } = await supabase.rpc("soeg_virksomhed", {
    soegetekst: q,
    maks
  });

  if (error) {
    return json({ error: `Søgning fejlede: ${error.message}` }, { status: 500 });
  }

  return json({
    erCvrNummer: false,
    traf: (data ?? []).map((r: Record<string, unknown>) => ({
      cvr: String(r.cvr),
      navn: r.navn,
      ophoert: r.ophoert
    }))
  });
});
