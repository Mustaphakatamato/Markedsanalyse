// Markedsopslag mod vores eget CVR-indeks i Postgres.
//
// Findes fordi de tre SQL-funktioner bevidst er utilgængelige for klienten
// (revoke ... from anon, authenticated). De læser hele virksomhedsregistret,
// og et ubegrænset kald derfra ville kunne trække 870.000 rækker ud. Adgangen
// går derfor gennem service-nøglen her, hvor argumenterne kan afgrænses.
//
// Tre handlinger, fordi de besvarer hvert sit trin i en markedsafdækning:
//   brancheforslag  hvilke brancher peger TED-vinderne i dette CPV-felt på?
//   statistik       hvor stort er markedet, og hvordan ser det ud?
//   soeg            hvem er de konkret — de STØRSTE først, se mindstKlasse.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handlePreflight, json } from "../_shared/http.ts";

const serviceKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
  auth: { persistSession: false }
});

// DB25-koder er altid seks cifre. Filtrering her frem for i SQL, så et
// misforstået input giver en forklarende fejl i stedet for et tomt marked —
// den fejl er ubehagelig, netop fordi den ligner et rigtigt svar.
const ER_BRANCHEKODE = /^\d{6}$/;
const ER_KOMMUNEKODE = /^\d{3}$/;

const MAKS_BRANCHEKODER = 25;
const MAKS_KOMMUNEKODER = 100; // der findes 98 kommuner
const MAKS_NAVNE = 500;

function tekstliste(vaerdi: unknown, maks: number): string[] {
  if (!Array.isArray(vaerdi)) return [];
  return vaerdi
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, maks);
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Brug POST." }, { status: 405 });
  }

  let krop: Record<string, unknown>;
  try {
    krop = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON i kroppen." }, { status: 400 });
  }

  const handling = String(krop.handling ?? "");

  // ------------------------------------------------------------ brancheforslag
  if (handling === "brancheforslag") {
    const navne = tekstliste(krop.navne, MAKS_NAVNE);
    if (!navne.length) {
      return json({ error: "Feltet 'navne' skal indeholde mindst ét navn." }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("brancheforslag_for_navne", { navne });
    if (error) return json({ error: `Brancheforslag fejlede: ${error.message}` }, { status: 500 });
    return json(data);
  }

  // ---------------------------------------------------------------------- cpv
  // Opslag i CPV-nomenklaturen (9.454 danske betegnelser). Ligger her frem for
  // i bundlen, fordi teksterne fylder 315 KB rå — mere end appens samlede
  // JavaScript. Søgningen er et debounced fjernopslag i UI'et, samme mønster
  // som firmanavne.
  if (handling === "cpv") {
    const q = String(krop.q ?? "").trim();
    if (q.length < 2) {
      return json({ traf: [] });
    }
    const maks = Math.min(Math.max(Number(krop.maks) || 20, 1), 50);
    const { data, error } = await supabase.rpc("soeg_cpv", { soegetekst: q, maks });
    if (error) return json({ error: `CPV-søgning fejlede: ${error.message}` }, { status: 500 });

    return json({
      traf: (data ?? []).map((r: Record<string, unknown>) => ({
        kode: r.kode,
        tekst: r.tekst,
        niveau: r.niveau,
        overordnet: r.overordnet,
        overordnetTekst: r.overordnet_tekst
      }))
    });
  }

  // ------------------------------------------------ statistik og soeg
  const branchekoder = tekstliste(krop.branchekoder, MAKS_BRANCHEKODER);
  const ugyldige = branchekoder.filter((k) => !ER_BRANCHEKODE.test(k));
  if (ugyldige.length) {
    return json(
      {
        error:
          `Ugyldige branchekoder: ${ugyldige.join(", ")}. ` +
          "En DB25-kode er seks cifre, fx 621000 for computerprogrammering."
      },
      { status: 400 }
    );
  }
  if (!branchekoder.length) {
    return json({ error: "Feltet 'branchekoder' skal indeholde mindst én kode." }, { status: 400 });
  }

  const kommunekoder = tekstliste(krop.kommunekoder, MAKS_KOMMUNEKODER)
    .filter((k) => ER_KOMMUNEKODE.test(k));

  if (handling === "statistik") {
    const { data, error } = await supabase.rpc("marked_statistik", {
      branchekoder,
      kommunekoder: kommunekoder.length ? kommunekoder : null
    });
    if (error) return json({ error: `Markedsstatistik fejlede: ${error.message}` }, { status: 500 });
    return json(data);
  }

  if (handling === "soeg") {
    const maks = Math.min(Math.max(Number(krop.maks) || 200, 1), 2000);

    // Hvid liste frem for gennemstik: værdierne indgår i en case-udtryk i SQL,
    // hvor alt ukendt falder tilbage til "ingen afgrænsning". En tastefejl fra
    // klienten ville dermed lydløst give hele markedet i stedet for de store —
    // et svar der ser rigtigt ud. Her fejler den i stedet.
    const KLASSER = ["selskab", "flere_adresser", "landsdaekkende"];
    const mindstKlasse = krop.mindstKlasse == null ? null : String(krop.mindstKlasse);
    if (mindstKlasse !== null && !KLASSER.includes(mindstKlasse)) {
      return json(
        { error: `Ukendt størrelsesklasse '${mindstKlasse}'. Brug ${KLASSER.join(", ")} eller udelad feltet.` },
        { status: 400 }
      );
    }

    const sortering = krop.sortering === "navn" ? "navn" : "stoerrelse";

    const { data, error } = await supabase.rpc("soeg_marked", {
      branchekoder,
      kommunekoder: kommunekoder.length ? kommunekoder : null,
      maks,
      mindst_klasse: mindstKlasse,
      sortering
    });
    if (error) return json({ error: `Markedssøgning fejlede: ${error.message}` }, { status: 500 });

    // cvr som streng: et CVR-nummer er en identifikator, ikke et tal, og
    // JavaScript ville kunne miste præcision på store bigint-værdier.
    return json({
      virksomheder: (data ?? []).map((r: Record<string, unknown>) => ({
        cvr: String(r.cvr),
        navn: r.navn,
        branchekode: r.branchekode,
        branchetekst: r.branchetekst,
        bibrancher: r.bibrancher ?? [],
        kommunekode: r.kommunekode,
        kommunenavn: r.kommunenavn,
        postnummer: r.postnummer,
        postdistrikt: r.postdistrikt,
        virksomhedsform: r.virksomhedsform,
        trafHovedbranche: r.traf_hovedbranche,
        antalPenheder: r.antal_penheder,
        startdato: r.startdato,
        stoerrelsesklasse: r.stoerrelsesklasse
      }))
    });
  }

  return json(
    { error: "Ukendt handling. Brug 'cpv', 'brancheforslag', 'statistik' eller 'soeg'." },
    { status: 400 }
  );
});
