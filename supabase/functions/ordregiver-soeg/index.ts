// Søgning efter ORDREGIVERE i indekset over udbud.dk's bekendtgørelser.
//
// Findes af samme grund som "udbud-soeg": SQL-funktionen bag er utilgængelig
// for klienten (revoke ... from anon, authenticated), fordi den læser hele
// bekendtgørelsestabellen. Adgangen går gennem service-nøglen her, hvor
// søgeteksten og antallet kan afgrænses.
//
// HVAD DEN SVARER PÅ: "hvilken ordregiver mener du?" — ét opslag pr.
// CVR-nummer, ikke pr. navnevariant. Se migrationen
// 20260825120000_ordregiver_opslag.sql for hvorfor det er hele pointen:
// ordregiverfeltet er fritekst, og Københavns Kommune optræder under 29
// forskellige navne i kilden.
//
// Ingen cache: tabellen er vores egen, svaret måles i ~100 ms, og klienten
// debouncer i forvejen tastetryk.

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

  const url = new URL(req.url);
  const soegetekst = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const maks = Math.min(Math.max(Number(url.searchParams.get("maks")) || 10, 1), 50);

  // To tegn er nedre grænse af samme grund som i cvr-soeg: ét bogstav rammer
  // næsten alle 1.756 ordregivernavne og er ikke et valg, brugeren har taget
  // endnu.
  if (soegetekst.length < 2) {
    return json({ ordregivere: [], ialt: 0, indeksStart: null });
  }

  const { data, error } = await supabase.rpc("soeg_ordregiver", {
    soegetekst,
    maks
  });

  if (error) {
    return json({ error: `Ordregiversøgning fejlede: ${error.message}` }, { status: 500 });
  }

  return json(data);
});
