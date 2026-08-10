// Rigtigt EU-sanktionstjek mod vores eget indeks af EU's konsoliderede
// sanktionsliste (indlæst ugentligt, se scripts/indlaes-eu-sanktioner.mjs).
// Erstatter det tidligere hardkodede sanctionsMatch: false i esgService.js.
//
// Bevidst konservativt: kun EKSAKT match på det normaliserede navn, ingen
// fuzzy/trigram-søgning. Et sanktionstjek med falske positiver (uskyldige
// virksomheder der fejlagtigt flages) er værre end et der overser en
// stavevariant — falske negativer er acceptable her, falske positiver er det
// ikke, i en due diligence-kontekst der bruges direkte i en risikovurdering.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handlePreflight, json } from "../_shared/http.ts";

const serviceKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
  auth: { persistSession: false }
});

// SKAL matche normaliser() i scripts/indlaes-eu-sanktioner.mjs præcist —
// ellers matcher intet nogensinde.
function normaliser(navn: string): string {
  return navn
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,'’"-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const navn = new URL(req.url).searchParams.get("navn")?.trim() ?? "";
  if (navn.length < 2) {
    return json({ error: "Angiv et virksomhedsnavn." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("eu_sanktionsliste")
    .select("navn, subjekt_type, programme")
    .eq("navn_norm", normaliser(navn));

  if (error) {
    return json({ error: `Sanktionstjek fejlede: ${error.message}` }, { status: 500 });
  }

  return json({
    match: (data ?? []).length > 0,
    // Flere rækker kan ramme samme normaliserede navn (forskellige enheder,
    // fx to forskellige sanktionerede parter der tilfældigvis translittereres
    // ens) — vis dem alle, gør ikke selv den vurdering.
    fund: (data ?? []).map((r) => ({
      navn: r.navn as string,
      type: (r.subjekt_type as string | null) ?? null,
      programme: (r.programme as string | null) ?? null
    })),
    kilde: "EU's konsoliderede sanktionsliste (Financial Sanctions Files)"
  });
});
