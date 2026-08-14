// Søgning i indekset over udbud.dk's bekendtgørelser.
//
// Findes af samme grund som "marked": SQL-funktionen bag er utilgængelig for
// klienten (revoke ... from anon, authenticated), fordi den læser en tabel med
// 23.660 rækker og et ubegrænset kald kunne trække dem alle ud. Adgangen går
// gennem service-nøglen her, hvor argumenterne kan afgrænses.
//
// Ingen cache: tabellen er vores egen, svarene er hurtige, og et cachelag
// ville kun tilføje risikoen for at vise et udbud som åbent efter fristen.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handlePreflight, json } from "../_shared/http.ts";

const serviceKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
  auth: { persistSession: false }
});

const ER_CPV = /^\d{8}$/;
const KILDER = ["TED", "DKUDBUD"];
const ARTER = ["udbud", "forhaandsmeddelelse", "tildeling", "andet"];
const SORTERINGER = ["frist", "nyeste", "vaerdi"];

function tekstliste(vaerdi: unknown, tilladte: string[] | null, maks: number): string[] {
  if (!Array.isArray(vaerdi)) return [];
  const rene = vaerdi
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, maks);
  return tilladte ? rene.filter((v) => tilladte.includes(v)) : rene;
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

  // CPV-koder afvises frem for at blive filtreret bort i stilhed: en
  // forkert kode ville give et tomt resultat, der ligner "der er ingen udbud
  // i dette felt" — den fejl er ubehagelig, netop fordi den ligner et svar.
  const cpvKoder = tekstliste(krop.cpvKoder, null, 25).map((k) => k.split("-")[0].trim());
  const ugyldige = cpvKoder.filter((k) => !ER_CPV.test(k));
  if (ugyldige.length) {
    return json(
      { error: `Ugyldige CPV-koder: ${ugyldige.join(", ")}. En CPV-kode er otte cifre.` },
      { status: 400 }
    );
  }

  const soegetekst = typeof krop.soegetekst === "string" ? krop.soegetekst.slice(0, 200) : null;
  const kilder = tekstliste(krop.kilder, KILDER, 2);
  const arter = tekstliste(krop.arter, ARTER, 4);
  const kunAabne = krop.kunAabne === true;
  const sortering = SORTERINGER.includes(String(krop.sortering)) ? String(krop.sortering) : "frist";
  const maks = Math.min(Math.max(Number(krop.maks) || 50, 1), 200);
  const springOver = Math.min(Math.max(Number(krop.springOver) || 0, 0), 5000);

  const { data, error } = await supabase.rpc("soeg_udbud", {
    soegetekst: soegetekst && soegetekst.trim() ? soegetekst : null,
    cpv_koder: cpvKoder.length ? cpvKoder : null,
    kilder: kilder.length ? kilder : null,
    arter: arter.length ? arter : null,
    kun_aabne: kunAabne,
    sortering,
    maks,
    spring_over: springOver
  });

  if (error) {
    return json({ error: `Udbudssøgning fejlede: ${error.message}` }, { status: 500 });
  }

  return json(data);
});
