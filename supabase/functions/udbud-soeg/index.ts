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
  // Loftet er 100 og ikke 25: overvågningssiden har 79 koder i sin liste.
  // Den sender kun de tre bredeste, fordi matchet er hierarkisk (se
  // src/lib/cpv.js), men slår man et felt fra, står feltets undere tilbage som
  // hver sit mønster — og en stille afkortning ville så vise et resultat, der
  // ligner et svar og mangler et felt.
  const cpvKoder = tekstliste(krop.cpvKoder, null, 100).map((k) => k.split("-")[0].trim());
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
  // Vinduet regnes om til et tidspunkt HER frem for at lade klienten sende et
  // timestamp. Så kan grænsen kun være "for N døgn siden", og kaldet kan ikke
  // bruges til at plukke et vilkårligt historisk vindue ud af tabellen.
  const dage = Number(krop.dage);
  const nyereEnd =
    Number.isFinite(dage) && dage > 0
      ? new Date(Date.now() - Math.min(dage, 365) * 86_400_000).toISOString()
      : null;

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
    spring_over: springOver,
    nyere_end: nyereEnd
  });

  if (error) {
    return json({ error: `Udbudssøgning fejlede: ${error.message}` }, { status: 500 });
  }

  return json(data);
});
