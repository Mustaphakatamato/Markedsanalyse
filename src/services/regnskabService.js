// Rigtige nøgletal fra Erhvervsstyrelsens regnskabsdata (XBRL), fundet og
// verificeret ved direkte research (se plan-notat for detaljer):
//
// 1. http://distribution.virk.dk/offentliggoerelser/_search — åbent,
//    ikke-autentificeret Elasticsearch-endpoint, søgbart på cvrNummer.
//    Returnerer metadata + URL'er til de indberettede XBRL-dokumenter, inkl.
//    regnskabsperiode (start/slutdato) — nok til at bygge en årstals-liste
//    uden at hente og parse selve dokumentet for hvert år.
// 2. Det primære dokument (dokumentType "AARSRAPPORT", XML) hentes og parses
//    på-anmodning (kun for det valgte år) med native DOMParser.
//
// Begge kilder er kun http:// og svarer nogle gange langsomt, derfor går de
// gennem lokale proxier med høj timeout (se vite.config.js).
//
// VIGTIGT om XBRL-parsingen: Danske regnskaber bruger vilkårlige namespace-
// præfikser for samme koncept (fx både "fsa:Equity" og "d:Equity" for
// http://xbrl.dcca.dk/fsa#Equity) — vi matcher derfor på elementets LOKALE
// tagnavn (el.localName), ikke præfiks, samme tilgang som det åbne
// cvrminer-projekt bruger. Nogle store/børsnoterede selskaber udelader helt
// balance/resultat fra denne fil (de filer i stedet et separat ESEF/IFRS-
// dokument) — det håndteres IKKE i v1; vi returnerer da "facts_unavailable"
// fremfor at gætte eller vise forkerte tal.

const SEARCH_URL = "/api/regnskab-search";
const DOC_PROXY_PREFIX = "/api/regnskab-doc";

const TOPLINE_CANDIDATES = [
  { concept: "Revenue", label: "Nettoomsætning" },
  { concept: "GrossProfitLoss", label: "Bruttofortjeneste" },
  { concept: "ProfitLossFromOrdinaryOperatingActivities", label: "Resultat af primær drift" }
];

function firstChildByLocalName(parent, localName) {
  if (!parent) return null;
  return Array.from(parent.children).find((c) => c.localName === localName) || null;
}

function parseNumericText(raw) {
  if (raw == null) return null;
  const cleaned = raw.replace(/[\s ]/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

// En context er "sikker" at bruge til virksomhedens hovedtal, hvis den enten
// ikke har noget scenario (almindeligst), eller kun har en
// ConsolidatedSoloDimension (angiver "hele virksomheden", ikke et segment).
// Contexts med fx bestyrelsesmedlem-identifikation (typedMember) eller andre
// dimensioner springes over — de repræsenterer ikke totaltal.
function isSafeScenario(scenarioEl) {
  if (!scenarioEl) return true;
  const children = Array.from(scenarioEl.children);
  if (children.some((c) => c.localName === "typedMember")) return false;
  return children.every((c) => {
    if (c.localName !== "explicitMember") return true;
    const dimension = c.getAttribute("dimension") || "";
    return dimension.split(":").pop() === "ConsolidatedSoloDimension";
  });
}

function parseContexts(doc) {
  const contexts = new Map();
  const contextEls = Array.from(doc.getElementsByTagNameNS("*", "context"));

  for (const el of contextEls) {
    const id = el.getAttribute("id");
    const periodEl = firstChildByLocalName(el, "period");
    const scenarioEl = firstChildByLocalName(el, "scenario");
    const instantEl = periodEl && firstChildByLocalName(periodEl, "instant");
    const startEl = periodEl && firstChildByLocalName(periodEl, "startDate");
    const endEl = periodEl && firstChildByLocalName(periodEl, "endDate");

    contexts.set(id, {
      instant: instantEl?.textContent?.trim() || null,
      startDate: startEl?.textContent?.trim() || null,
      endDate: endEl?.textContent?.trim() || null,
      safe: isSafeScenario(scenarioEl)
    });
  }

  return contexts;
}

function findFactsByConcept(doc, contexts, conceptName) {
  const candidates = [];
  const allEls = Array.from(doc.getElementsByTagName("*"));

  for (const el of allEls) {
    if (el.localName !== conceptName) continue;
    const ctx = contexts.get(el.getAttribute("contextRef"));
    if (!ctx || !ctx.safe) continue;
    const value = parseNumericText(el.textContent);
    if (value == null) continue;
    candidates.push({ value, ctx });
  }

  return candidates;
}

function pickLatestTwo(facts, isInstant) {
  const sorted = [...facts].sort((a, b) => {
    const da = isInstant ? a.ctx.instant : a.ctx.endDate;
    const db = isInstant ? b.ctx.instant : b.ctx.endDate;
    return (db || "").localeCompare(da || "");
  });
  return { current: sorted[0] || null, prior: sorted[1] || null };
}

function extractFinancials(doc) {
  const contexts = parseContexts(doc);

  let toplineLabel = null;
  let topline = null;
  for (const candidate of TOPLINE_CANDIDATES) {
    const facts = findFactsByConcept(doc, contexts, candidate.concept);
    if (facts.length) {
      topline = pickLatestTwo(facts, false);
      toplineLabel = candidate.label;
      break;
    }
  }

  const resultFacts = findFactsByConcept(doc, contexts, "ProfitLoss");
  const result = resultFacts.length ? pickLatestTwo(resultFacts, false) : null;

  const equityFacts = findFactsByConcept(doc, contexts, "Equity");
  const equity = equityFacts.length ? pickLatestTwo(equityFacts, true) : null;

  const assetsFacts = findFactsByConcept(doc, contexts, "Assets");
  const assets = assetsFacts.length ? pickLatestTwo(assetsFacts, true) : null;

  if (!topline && !result && !equity && !assets) return null;

  const solvencyPct =
    equity?.current?.value != null && assets?.current?.value
      ? Number(((equity.current.value / assets.current.value) * 100).toFixed(1))
      : null;

  return {
    toplineLabel,
    topline: topline?.current?.value ?? null,
    result: result?.current?.value ?? null,
    priorYearResult: result?.prior?.value ?? null,
    equity: equity?.current?.value ?? null,
    assets: assets?.current?.value ?? null,
    solvencyPct
  };
}

// Til "se kilden"-linket skal vi ALDRIG pege på XML'en — den er til maskiner.
// Foretræk en rigtig PDF hvis regnskabet har en (ældre filer har det ofte),
// ellers den menneskeligt læsbare XHTML-udgave, som moderne (2024+) filinger
// bruger i stedet for PDF.
function pickHumanReadableUrl(documents, fallbackDoc) {
  const pdf = documents.find((d) => d.dokumentType === "AARSRAPPORT" && d.dokumentMimeType === "application/pdf");
  if (pdf) return pdf.dokumentUrl;
  const xhtml = documents.find(
    (d) => d.dokumentType === "AARSRAPPORT" && d.dokumentMimeType === "application/xhtml+xml"
  );
  if (xhtml) return xhtml.dokumentUrl;
  return fallbackDoc?.dokumentUrl || null;
}

/**
 * List de seneste indberettede regnskaber for et CVR-nummer, ét pr. år (op til
 * `limit` år tilbage). Én enkelt, billig søgning — henter IKKE selve
 * XBRL-dokumenterne, kun metadata + dokument-URL'er, så en årstals-dropdown
 * kan bygges uden at parse noget endnu.
 *
 * @param {string|number} cvr
 * @param {{ limit?: number }} [options]
 * @returns {Promise<Array<{ fiscalYearEnd: string, fiscalYearStart: string|null, documents: object[] }>>}
 */
export async function listAvailableRegnskaber(cvr, options = {}) {
  if (!cvr) return [];
  const { limit = 10 } = options;

  const searchBody = {
    query: {
      bool: {
        must: [{ term: { cvrNummer: Number(cvr) } }, { term: { offentliggoerelsestype: "regnskab" } }]
      }
    },
    // Hent lidt flere end limit — et selskab kan have flere indberetninger for
    // samme regnskabsår (fx en omgørelse), som vi dedupliceres væk nedenfor.
    size: limit + 5,
    sort: [{ offentliggoerelsesTidspunkt: "desc" }]
  };

  const searchResponse = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(searchBody)
  });

  if (!searchResponse.ok) {
    throw new Error(`Regnskabssøgning fejlede (HTTP ${searchResponse.status})`);
  }

  const searchData = await searchResponse.json();
  const hits = searchData?.hits?.hits || [];

  const seenYears = new Set();
  const entries = [];

  for (const hit of hits) {
    const source = hit._source;
    const slutDato = source?.regnskab?.regnskabsperiode?.slutDato;
    if (!slutDato) continue;

    const year = slutDato.slice(0, 4);
    if (seenYears.has(year)) continue; // allerede set en nyere indberetning for samme år
    seenYears.add(year);

    entries.push({
      fiscalYearEnd: slutDato,
      fiscalYearStart: source?.regnskab?.regnskabsperiode?.startDato || null,
      documents: source.dokumenter || []
    });

    if (entries.length >= limit) break;
  }

  return entries;
}

/**
 * Hent og udtræk nøgletal for én bestemt indberetning (fra
 * listAvailableRegnskaber()).
 *
 * @param {{ fiscalYearEnd: string, documents: object[] }} entry
 * @returns {Promise<
 *   | { status: "ok", fiscalYearEnd, toplineLabel, topline, result, priorYearResult, equity, assets, solvencyPct, sourceUrl, isMock: false }
 *   | { status: "facts_unavailable", sourceUrl: string|null }
 * >}
 */
export async function getFinancialsForEntry(entry) {
  const mainDoc = entry.documents.find(
    (d) => d.dokumentType === "AARSRAPPORT" && d.dokumentMimeType === "application/xml"
  );
  const sourceUrl = pickHumanReadableUrl(entry.documents, mainDoc);

  if (!mainDoc) return { status: "facts_unavailable", sourceUrl };

  const docPath = new URL(mainDoc.dokumentUrl).pathname;
  const docResponse = await fetch(`${DOC_PROXY_PREFIX}${docPath}`);
  if (!docResponse.ok) {
    throw new Error(`Kunne ikke hente regnskabsdokument (HTTP ${docResponse.status})`);
  }

  const xmlText = await docResponse.text();
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");

  if (doc.querySelector("parsererror")) {
    return { status: "facts_unavailable", sourceUrl };
  }

  const extracted = extractFinancials(doc);
  if (!extracted) {
    return { status: "facts_unavailable", sourceUrl };
  }

  return { status: "ok", fiscalYearEnd: entry.fiscalYearEnd, ...extracted, sourceUrl, isMock: false };
}

/**
 * Bekvemmeligheds-wrapper: find og udtræk nøgletal fra det SENESTE
 * indberettede regnskab for et CVR-nummer.
 *
 * @param {string|number} cvr
 * @returns {Promise<
 *   | { status: "ok", fiscalYearEnd, toplineLabel, topline, result, priorYearResult, equity, assets, solvencyPct, sourceUrl, isMock: false }
 *   | { status: "facts_unavailable", sourceUrl: string|null }
 *   | { status: "not_found" }
 * >}
 */
export async function findLatestRegnskab(cvr) {
  const entries = await listAvailableRegnskaber(cvr, { limit: 1 });
  if (!entries.length) return { status: "not_found" };
  return getFinancialsForEntry(entries[0]);
}
