// Rigtigt EU-sanktionstjek mod vores eget indeks af EU's konsoliderede
// sanktionsliste (indlæst ugentligt, se scripts/indlaes-eu-sanktioner.mjs).
// Erstatter det tidligere hardkodede sanctionsMatch: false i esgService.js.
//
// Bevidst konservativt: kun EKSAKT match på det normaliserede navn, ingen
// fuzzy/trigram-søgning. Et sanktionstjek med falske positiver (uskyldige
// virksomheder der fejlagtigt flages) er værre end et der overser en
// stavevariant — falske negativer er acceptable her, falske positiver er det
// ikke, i en due diligence-kontekst der bruges direkte i en risikovurdering.
//
// KONFIDENS-NIVEAUER: eksakt navnematch er stadig ikke nok i sig selv. Et
// stikprøve-join mod CVR-indekset viste adskillige forkerte matches mod korte
// enkeltord-aliaser på listen ("Leo", "Adam", "Bach", "Aurora", "TSA", "RGB")
// — fornavne og forkortelser knyttet til udpegede terrorister/enheder, som
// tilfældigvis også er navnet på en helt almindelig dansk enkeltmandsvirksomhed.
// Et navn der hverken indeholder mellemrum (altså ét enkelt ord) eller er
// mindst 10 tegn langt regnes derfor kun som LAV konfidens — det driver ikke
// "Match fundet"/Kræver afklaring, men vises stadig, så intet skjules.
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

const MIN_ENKELTORD_LAENGDE = 10;

function konfidens(navn: string): "høj" | "lav" {
  const trimmet = navn.trim();
  const flereOrd = /\s/.test(trimmet);
  return flereOrd || trimmet.length >= MIN_ENKELTORD_LAENGDE ? "høj" : "lav";
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

  // Flere rækker kan ramme samme normaliserede navn (forskellige enheder, fx
  // to forskellige sanktionerede parter der tilfældigvis translittereres
  // ens) — vis dem alle, gør ikke selv den endelige vurdering.
  const fund = (data ?? []).map((r) => ({
    navn: r.navn as string,
    type: (r.subjekt_type as string | null) ?? null,
    programme: (r.programme as string | null) ?? null,
    confidence: konfidens(r.navn as string)
  }));

  return json({
    // Kun høj-konfidens fund tæller som et rigtigt "match" der skal kræve
    // afklaring — lav-konfidens fund vises stadig i "fund", men flager ikke.
    match: fund.some((f) => f.confidence === "høj"),
    fund,
    kilde: "EU's konsoliderede sanktionsliste (Financial Sanctions Files)"
  });
});
