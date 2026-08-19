// Den daglige synk af udbud.dk-indekset. Kaldes af Vercels cron, se
// "crons" i vercel.json.
//
// HVORFOR DEN LIGGER HER OG IKKE SOM EN SUPABASE EDGE FUNCTION: hver
// bekendtgørelse er base64-encoded eForms-XML, der skal parses, og Edge
// Functions har 2 sekunders CPU-tid pr. request. Det er den samme grund til,
// at XBRL-parsingen ligger i browseren og at ted-notice kun proxier — se
// READMEens afsnit om backend. En Vercel-funktion i Node har rigtig CPU-tid og
// kan bruge PRÆCIS den parser, indlæsningsscriptet allerede er afprøvet med
// (scripts/test-udbud-parser.mjs), frem for en Deno-kopi der skulle holdes i
// sync med den.
//
// Browseren kalder ALDRIG denne funktion. Reglen om at alt klient-vendt går
// gennem Edge Functions ad samme vej i dev og prod står uændret; dette er en
// baggrundskørsel uden en bruger foran.
//
// HVORFOR DEN NÆGTER AT LAVE DEN FØRSTE INDLÆSNING: er tabellen tom, betyder
// inkrementelt "hent alt" — 23.660 bekendtgørelser og ~1 GB XML. Det hører i
// en scriptkørsel på en maskine, der må tage den tid det tager
// (`node scripts/indlaes-udbud-dk.mjs --fuld`). En serverless-funktion, der
// prøvede, ville timeout midt i og efterlade indekset halvt fyldt med et
// vandmærke, der springer resten over.

import { synkroniser, senesteRegistrering, MILJOEER } from "../scripts/indlaes-udbud-dk.mjs";

// Sikkerhedsventil mod svartidsloftet. Et døgn giver ~50 bekendtgørelser =
// under én side, så loftet kan kun nås efter et længere udfald — og så er en
// --fuld-kørsel svaret. Se noten på synkroniser() om hvorfor et hårdt stop
// ikke er gratis.
const MAKS_SIDER = 30;

const KRÆVEDE = [
  "VITE_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "UDBUD_DK_BRUGER",
  "UDBUD_DK_PASSWORD_PROD"
];

export default async function handler(req, res) {
  // Vercel sender selv `Authorization: Bearer $CRON_SECRET` med cron-kaldet.
  // Mangler hemmeligheden i miljøet, afvises ALT — et åbent endepunkt her
  // ville lade enhver starte en times hentning fra udbud.dk i vores navn.
  const hemmelighed = process.env.CRON_SECRET;
  if (!hemmelighed) {
    return res.status(500).json({ fejl: "CRON_SECRET er ikke sat — synken er slået fra." });
  }
  if (req.headers.authorization !== `Bearer ${hemmelighed}`) {
    return res.status(401).json({ fejl: "Uautoriseret." });
  }

  const manglende = KRÆVEDE.filter((n) => !process.env[n]);
  if (manglende.length) {
    return res.status(500).json({ fejl: `Mangler i miljøet: ${manglende.join(", ")}` });
  }

  const linjer = [];
  const log = (besked) => {
    // Går i Vercels runtime-log. Der er ingen bruger foran, så beskederne er
    // det eneste spor, når en kørsel opfører sig anderledes end i går.
    console.log("[synk-udbud]", besked);
    if (linjer.length < 50) linjer.push(besked);
  };

  try {
    const vandmaerke = await senesteRegistrering(process.env, "ALLE");
    if (!vandmaerke) {
      return res.status(409).json({
        fejl: "Indekset er tomt. Kør `node scripts/indlaes-udbud-dk.mjs --fuld` én gang først.",
        hvorfor: "Den første indlæsning er ~1 GB XML og kan ikke gennemføres inden for svartidsloftet."
      });
    }

    const stat = await synkroniser({
      env: process.env,
      kilde: "ALLE",
      miljoe: MILJOEER.prod,
      maksSider: MAKS_SIDER,
      log,
      // Fremdrift pr. side er til en terminal, ikke til en log.
      fremdrift: () => {}
    });

    if (stat.naaedeLoft) {
      log(`ADVARSEL: sideloftet på ${MAKS_SIDER} blev nået. Der kan mangle bekendtgørelser — kør --fuld.`);
    }

    return res.status(200).json({
      ok: true,
      vandmaerkeFoer: vandmaerke,
      skrevet: stat.skrevet,
      laest: stat.laest,
      sprunget: stat.sprunget,
      sider: stat.sider,
      prKilde: stat.prKilde,
      prArt: stat.prArt,
      naaedeLoft: stat.naaedeLoft,
      log: linjer
    });
  } catch (fejl) {
    // Beskeden kan indeholde et svar fra udbud.dk eller Supabase; den er ikke
    // brugervendt, og logget er stedet den skal kunne læses.
    console.error("[synk-udbud] FEJL:", fejl);
    return res.status(500).json({ fejl: fejl.message, log: linjer });
  }
}
