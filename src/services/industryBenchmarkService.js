// Branchegennemsnit fra Danmarks Statistiks Statistikbank-API — gratis,
// åben, ingen login (CORS er åben med Access-Control-Allow-Origin: *,
// verificeret direkte, så kaldet går uden om proxy, i modsætning til
// TED/CVR/regnskabsdata).
//
// Tabel REGN50A ("Nøgletal i procent for regnskabsstatistik for private
// byerhverv") dækker kun private, markedsøkonomiske brancher — landbrug,
// finans/forsikring og offentlige brancher er ikke med (se
// data/naceSectionMap.js). Tallene er årlige og efterslæbte — det seneste
// tilgængelige år er typisk halvandet år gammelt, aldrig det indeværende.

import { getIndustrySector } from "../data/naceSectionMap";

const STATBANK_URL = "https://api.statbank.dk/v1/data";

const RATIO_ROW_LABELS = {
  "Soliditetsgrad (pct.) gennemsnit": "solvencyPct",
  "Overskudsgrad (pct.), gennemsnit A/S, Aps, Amba, mv.": "profitMarginPct"
};

function parseDanishNumber(text) {
  const num = Number(text.trim().replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

// Statbank CSV kommer semikolon-separeret, med et indledende BOM-tegn.
function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").trim().split("\n");
  const [, ...rows] = lines; // første linje er headeren (ERHVERV;REGNSKPOSTER;TID;INDHOLD)
  return rows.map((line) => {
    const [erhverv, regnskabspost, tid, indhold] = line.split(";");
    return { erhverv, regnskabspost, year: tid.trim(), value: parseDanishNumber(indhold) };
  });
}

/**
 * Hent branchegennemsnit (soliditetsgrad, overskudsgrad) for den branche en
 * given DB07-kode hører under, for alle tilgængelige år.
 *
 * @param {string|number|null} industryCode 6-cifret DB07-kode fra CVR
 * @returns {Promise<{ sectorLabel: string, byYear: Record<string, { solvencyPct?: number, profitMarginPct?: number }> } | null>}
 */
export async function getIndustryBenchmark(industryCode) {
  const sector = getIndustrySector(industryCode);
  if (!sector) return null;

  const response = await fetch(STATBANK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      table: "REGN50A",
      format: "CSV",
      variables: [
        { code: "ERHVERV", values: [sector.sector] },
        { code: "REGNSKPOSTER", values: ["XSO", "XOGS"] },
        { code: "Tid", values: ["*"] }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Danmarks Statistik-opslag fejlede (HTTP ${response.status})`);
  }

  const rows = parseCsv(await response.text());
  const byYear = {};

  for (const row of rows) {
    const field = RATIO_ROW_LABELS[row.regnskabspost];
    if (!field || row.value == null) continue;
    byYear[row.year] = { ...byYear[row.year], [field]: row.value };
  }

  if (Object.keys(byYear).length === 0) return null;

  return { sectorLabel: sector.label, byYear };
}

/**
 * Vælg branchegennemsnittet for det år der ligger tættest på virksomhedens
 * regnskabsår — Statistikbanken efterslæber typisk et par år, så det er
 * sjældent et eksakt match. Returnerer altid hvilket år tallet faktisk
 * stammer fra, så det aldrig fremstår som mere aktuelt end det er.
 *
 * @param {{ sectorLabel: string, byYear: Record<string, object> }} benchmark
 * @param {string} companyFiscalYear fx "2025"
 */
export function pickClosestBenchmarkYear(benchmark, companyFiscalYear) {
  if (!benchmark) return null;
  const years = Object.keys(benchmark.byYear).sort();
  if (years.length === 0) return null;

  const target = Number(companyFiscalYear);
  const closest = years.reduce((best, year) =>
    Math.abs(Number(year) - target) < Math.abs(Number(best) - target) ? year : best
  );

  return { year: closest, sectorLabel: benchmark.sectorLabel, ...benchmark.byYear[closest] };
}
