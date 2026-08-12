import { useEffect, useRef, useState } from "react";
import { hentVirksomhed, søgVirksomheder } from "../services/cvrService";
import { searchWonContractsByCompany } from "../services/tedService";
import { getNoticeDetail } from "../services/tedNoticeService";
import { getAvailableFiscalYears, getFinancialsForYear } from "../services/financialsService";
import { getESGProfile } from "../services/esgService";
import { checkSanctions } from "../services/sanctionsService";
import { getIndustryBenchmark, pickClosestBenchmarkYear } from "../services/industryBenchmarkService";
import TrendChart from "../components/charts/TrendChart";

// Rækkefølgen her er også rækkefølgen knapperne vises i under grafen.
const METRIC_DEFS = [
  { key: "topline", label: "Omsætning/bruttofortjeneste", isPercent: false },
  { key: "result", label: "Årets resultat", isPercent: false },
  { key: "equity", label: "Egenkapital", isPercent: false },
  { key: "assets", label: "Balancesum", isPercent: false },
  { key: "solvencyPct", label: "Soliditetsgrad", isPercent: true }
];

function formatDkkMio(value) {
  if (value == null) return "–";
  // For meget små selskaber (fx et lige-stiftet holdingselskab) kan et
  // negativt beløb i hele kroner (fx -4.999 DKK) afrunde til 0,0 i
  // mio.-visning — toLocaleString bevarer fortegnet på negativ nul og ville
  // vise "-0 mio. DKK", hvilket ligner en fejl. Rund selv først og kollaps
  // -0 til 0.
  const rounded = Math.round((value / 1_000_000) * 10) / 10;
  const normalized = rounded === 0 ? 0 : rounded;
  return `${normalized.toLocaleString("da-DK", { maximumFractionDigits: 1 })} mio. DKK`;
}

// Procenter skal formateres som beløbene ovenfor — dansk decimalkomma. Uden
// dette viser tallene sig som "24.3%" side om side med "5.290,5 mio. DKK".
function formatPercent(value) {
  if (value == null) return "–";
  return `${value.toLocaleString("da-DK", { maximumFractionDigits: 1 })}%`;
}

function formatDate(isoDate) {
  return isoDate ? isoDate.slice(0, 10) : "–";
}

// company.creditRemark kommer fra CVR_Kreditoplysninger (se
// cvr-datafordeler/index.ts) — Erhvervsstyrelsens egen løbende registrering
// af konkurs/tvangsopløsning/likvidation mv., med myndighedens egen ordlyd.
// null betyder intet åbent forhold at bemærke.
function formatCreditRemark(remark) {
  if (!remark) return null;
  return `${remark.type} — ${remark.stage} (siden ${formatDanishDate(remark.since)})`;
}

// Datafordeleren leverer datoer i ISO-format ("1991-01-09"). Vist råt stak de
// ud fra resten af siden, der er gennemført dansk.
function formatDanishDate(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleDateString("da-DK");
}

export default function CompanyLookupPage({ prefillQuery, prefillToken }) {
  const [query, setQuery] = useState(prefillQuery || "");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState(null);
  const [company, setCompany] = useState(null);
  // Et firmanavn kan ramme flere selskaber — "netcompany" giver både
  // Netcompany A/S, Netcompany Group A/S og Netcompany Banking Services A/S.
  // Så lader vi brugeren vælge frem for at gætte.
  const [candidates, setCandidates] = useState([]);
  // Live forslag mens man skriver — separat fra candidates ovenfor, som først
  // vises EFTER en fuld søgning (Enter/knap) hvis den giver flere træf.
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const searchBoxRef = useRef(null);
  // Beskytter mod en langsom, forældet søgning der overskriver et nyere svar
  // (fx hvis "net" svarer senere end det efterfølgende "netc").
  const suggestionRequestRef = useRef(0);
  const [esg, setEsg] = useState(null);
  const [sanctions, setSanctions] = useState(null);
  const [sanctionsLoading, setSanctionsLoading] = useState(false);
  const [contracts, setContracts] = useState({ notices: [], total: 0, usedFallback: false });
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractsError, setContractsError] = useState(null);
  // Detaljer hentes dovent, kun for den udfoldede notice — ikke alle på én
  // gang, da hver af dem er et separat kald der parser en fuld eForms-XML.
  const [expandedNoticeId, setExpandedNoticeId] = useState(null);
  const [noticeDetails, setNoticeDetails] = useState({});
  const [financials, setFinancials] = useState({ status: "idle" });
  const [financialsLoading, setFinancialsLoading] = useState(false);
  const [industryBenchmark, setIndustryBenchmark] = useState(null);
  const [fiscalYears, setFiscalYears] = useState([]);
  const [selectedYearIndex, setSelectedYearIndex] = useState(0);
  const [trendExpanded, setTrendExpanded] = useState(false);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState(null);
  const [trendByYear, setTrendByYear] = useState([]);
  const [selectedMetric, setSelectedMetric] = useState(null);
  const [trendAsTable, setTrendAsTable] = useState(false);

  const loadFinancialsForYear = async (entries, index) => {
    const entry = entries[index];
    if (!entry) {
      setFinancials({ status: "not_found" });
      return;
    }
    setFinancialsLoading(true);
    const data = await getFinancialsForYear(entry);
    setFinancials(data);
    setFinancialsLoading(false);
  };

  const handleYearChange = (index) => {
    setSelectedYearIndex(index);
    loadFinancialsForYear(fiscalYears, index);
  };

  // Henter alle tilgængelige regnskabsår parallelt — kun når brugeren rent
  // faktisk beder om udviklingen, ikke automatisk ved hvert opslag (op til 10
  // dokumenter er unødvendigt at hente hvis ingen kigger på grafen).
  const loadTrend = async () => {
    setTrendExpanded(true);
    if (trendByYear.length || trendLoading) return;

    setTrendLoading(true);
    setTrendError(null);
    try {
      const results = await Promise.all(
        fiscalYears.map((entry) => getFinancialsForYear(entry).then((financials) => ({ entry, financials })))
      );
      const chronological = [...results].reverse(); // ældst → nyest, til grafens x-akse
      setTrendByYear(chronological);

      const firstAvailable = METRIC_DEFS.find((def) =>
        chronological.some((d) => d.financials?.status === "ok" && d.financials[def.key] != null)
      );
      setSelectedMetric(firstAvailable?.key || null);
    } catch (err) {
      setTrendError(err.message || "Kunne ikke hente udvikling over tid.");
    } finally {
      setTrendLoading(false);
    }
  };

  // Søgning og opslag er to trin, fordi kilden er delt i to: navnesøgning går
  // mod vores eget indeks, stamdata hentes på CVR-nummer hos Datafordeleren.
  const runSearch = async (term) => {
    const trimmed = (term ?? "").trim();
    if (!trimmed) return;

    setStatus("loading");
    setMessage(null);
    setCompany(null);
    setCandidates([]);

    const result = await søgVirksomheder(trimmed);

    if (result.status === "cvr") return loadCompany(result.cvr);

    if (result.status !== "ok") {
      setStatus(result.status);
      setMessage(result.message);
      return;
    }

    // Ét entydigt træf behøver ingen mellemstation.
    if (result.traf.length === 1) return loadCompany(result.traf[0].cvr);

    setCandidates(result.traf);
    setStatus("candidates");
  };

  const loadCompany = async (cvr) => {
    setStatus("loading");
    setMessage(null);
    setCandidates([]);

    const result = await hentVirksomhed(cvr);

    if (result.status !== "ok") {
      setStatus(result.status === "not_found" ? "not_found" : "error");
      setMessage(result.message);
      return;
    }

    setCompany(result.company);
    setEsg(getESGProfile(result.company));
    setStatus("found");

    setContractsLoading(true);
    setContractsError(null);
    setExpandedNoticeId(null);
    setNoticeDetails({});
    setFinancialsLoading(true);
    setFinancials({ status: "idle" });
    setFiscalYears([]);
    setSelectedYearIndex(0);
    setTrendExpanded(false);
    setTrendError(null);
    setTrendByYear([]);
    setSelectedMetric(null);
    setTrendAsTable(false);
    setIndustryBenchmark(null);
    setSanctions(null);
    setSanctionsLoading(true);

    const contractsPromise = searchWonContractsByCompany(result.company.name)
      .then(setContracts)
      .catch((err) => setContractsError(err.message || "Kunne ikke hente TED-data."))
      .finally(() => setContractsLoading(false));

    const financialsPromise = getAvailableFiscalYears(result.company).then((entries) => {
      setFiscalYears(entries);
      return loadFinancialsForYear(entries, 0);
    });

    // Ét hurtigt, direkte kald (ingen proxy nødvendig — DST's API har åben
    // CORS) — fejler stille, da branchesammenligning er et supplement, ikke
    // noget resten af siden afhænger af.
    const benchmarkPromise = getIndustryBenchmark(result.company.industryCode)
      .then(setIndustryBenchmark)
      .catch(() => setIndustryBenchmark(null));

    const sanctionsPromise = checkSanctions(result.company.name)
      .then(setSanctions)
      .catch(() => setSanctions(null))
      .finally(() => setSanctionsLoading(false));

    await Promise.all([contractsPromise, financialsPromise, benchmarkPromise, sanctionsPromise]);
  };

  // Henter kun den fulde notice-XML ved første udfoldning af hvert kort, og
  // gemmer resultatet, så et andet klik på samme kort ikke kalder igen.
  const toggleNoticeDetail = async (notice) => {
    if (expandedNoticeId === notice.id) {
      setExpandedNoticeId(null);
      return;
    }
    setExpandedNoticeId(notice.id);
    if (noticeDetails[notice.id]) return;

    setNoticeDetails((prev) => ({ ...prev, [notice.id]: { status: "loading" } }));
    try {
      const data = await getNoticeDetail(notice, company?.name);
      setNoticeDetails((prev) => ({ ...prev, [notice.id]: { status: "ok", data } }));
    } catch (err) {
      setNoticeDetails((prev) => ({
        ...prev,
        [notice.id]: { status: "error", message: err.message || "Kunne ikke hente detaljer." }
      }));
    }
  };

  useEffect(() => {
    if (!prefillToken) return;
    setQuery(prefillQuery);
    runSearch(prefillQuery);
    // Skal kun genkøres når hoppet fra markedsanalysen udløser et nyt token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillToken]);

  // Live forslag mens man skriver. Debounces 250ms, så vi ikke sender ét
  // søgekald pr. tastetryk — samme navneindeks som "Slå op"-knappen bruger
  // (søgVirksomheder), bare uden knappen. Et 8-cifret CVR-nummer giver
  // {status: "cvr"} fra søgVirksomheder uden noget netværkskald, og skal ikke
  // vise forslag (der er intet at foreslå — det ER allerede entydigt).
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      const requestId = ++suggestionRequestRef.current;
      const result = await søgVirksomheder(trimmed);
      if (requestId !== suggestionRequestRef.current) return; // et nyere kald er undervejs
      setSuggestions(result.status === "ok" ? result.traf : []);
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Luk forslagsboksen ved klik udenfor. Bruger mousedown (ikke inputtets
  // onBlur), så et klik PÅ et forslag ikke lukker boksen før onClick når at
  // køre — mousedown på selve forslaget rammer stadig containeren og lukker
  // derfor ikke boksen for tidligt.
  useEffect(() => {
    function handleClickOutside(e) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) {
        setSuggestionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const pickSuggestion = (kandidat) => {
    setQuery(kandidat.navn);
    setSuggestionsOpen(false);
    setSuggestions([]);
    loadCompany(kandidat.cvr);
  };

  // isMultiWinner-notices holdes UDENFOR summen: "value" der er notice'ens
  // egen samlede loftværdi, ikke hvad virksomheden selv vandt (se
  // tedService.js). At lægge den sammen med rigtige enkeltkontrakter ville
  // kunne overdrive beløbet med en faktor 100+.
  const totalContractValueDkk = contracts.notices
    .filter((n) => n.value != null && n.currency === "DKK" && !n.isMultiWinner)
    .reduce((sum, n) => sum + n.value, 0);
  const multiWinnerCount = contracts.notices.filter((n) => n.isMultiWinner).length;

  const availableMetrics = METRIC_DEFS.filter((def) =>
    trendByYear.some((d) => d.financials?.status === "ok" && d.financials[def.key] != null)
  );
  const activeMetricDef = availableMetrics.find((def) => def.key === selectedMetric) || null;
  const formatMetricValue = (value) =>
    activeMetricDef?.isPercent ? formatPercent(value) : formatDkkMio(value);

  const companyFiscalYear = financials.status === "ok" ? financials.fiscalYearEnd?.slice(0, 4) : null;
  const benchmark =
    industryBenchmark && companyFiscalYear ? pickClosestBenchmarkYear(industryBenchmark, companyFiscalYear) : null;
  // Overskudsgrad (resultat/topline) giver kun mening når topline reelt
  // afspejler forretningens omfang. Rene holdingselskaber mangler "Revenue"
  // helt, så topline falder ned til fx GrossProfitLoss — ofte bare et par
  // administrationsomkostninger i minus — mens resultatet (bundlinjen)
  // domineres af finansielle poster (nedskrivninger på kapitalandele,
  // koncernrenter mv.), som intet har med topline at gøre. Divideres et
  // stort resultat med en næsten-nul topline, får man tal i titusindvis af
  // procent — og er begge negative, ligner det oven i købet et flot
  // overskud (fx PureGym Denmark Holding, CVR 36700386, FY2025: -38,5 mio.
  // kr. i resultat / -74.000 kr. i GrossProfitLoss ⇒ ~52.000% "overskudsgrad").
  //
  // Kræv derfor at topline udgør mindst 5% af resultatets størrelse, før
  // brøken vises som en overskudsgrad.
  const MIN_TOPLINE_SHARE_OF_RESULT = 0.05;
  const profitMarginNotMeaningful =
    financials.status === "ok" &&
    financials.result != null &&
    !!financials.topline &&
    Math.abs(financials.topline) < Math.abs(financials.result) * MIN_TOPLINE_SHARE_OF_RESULT;

  const companyProfitMarginPct =
    financials.status === "ok" && financials.result != null && financials.topline && !profitMarginNotMeaningful
      ? Number(((financials.result / financials.topline) * 100).toFixed(1))
      : null;

  return (
    <main className="page">
      <section className="card">
        <div className="section-header">
          <div>
            <h3>Virksomhedsopslag</h3>
            <p className="muted">
              Slå en virksomhed op på navn eller CVR-nummer og få ét samlet billede: CVR-stamdata,
              vundne EU-udbud (TED), økonomi og ESG.
            </p>
          </div>
        </div>

        <div className="filters-grid">
          <div style={{ gridColumn: "1 / -1", position: "relative" }} ref={searchBoxRef}>
            <label>Firmanavn eller CVR-nummer</label>
            <input
              className="input"
              placeholder="Fx Netcompany eller 25511484"
              value={query}
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value);
                setSuggestionsOpen(true);
              }}
              onFocus={() => suggestions.length > 0 && setSuggestionsOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSuggestionsOpen(false);
                  runSearch(query);
                } else if (e.key === "Escape") {
                  setSuggestionsOpen(false);
                }
              }}
            />
            {suggestionsOpen && suggestions.length > 0 && (
              <ul className="suggestions-list">
                {suggestions.map((kandidat) => (
                  <li key={kandidat.cvr}>
                    <button type="button" onClick={() => pickSuggestion(kandidat)}>
                      <span>{kandidat.navn}</span>
                      <span className="muted small">CVR {kandidat.cvr}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="button-row align-end">
            <button
              className="btn btn-primary"
              onClick={() => {
                setSuggestionsOpen(false);
                runSearch(query);
              }}
              disabled={status === "loading" || !query.trim()}
            >
              {status === "loading" ? "Slår op…" : "Slå op"}
            </button>
          </div>
        </div>
      </section>

      {(status === "not_found" || status === "error") && (
        <section className="empty-state">
          <h4>Ingen resultat</h4>
          <p className="muted">{message}</p>
        </section>
      )}

      {status === "candidates" && (
        <section className="card">
          <div className="section-header">
            <div>
              <h3>{candidates.length} virksomheder matcher</h3>
              <p className="muted">Vælg den du vil se profilen for.</p>
            </div>
          </div>

          <div className="stack">
            {candidates.map((kandidat) => (
              <div className="subcard" key={kandidat.cvr}>
                <div className="space-between mobile-stack">
                  <div>
                    <strong>{kandidat.navn}</strong>
                    <p className="muted small">CVR {kandidat.cvr}</p>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => loadCompany(kandidat.cvr)}>
                    Se profil →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {status === "found" && company && (
        <>
          <section className="card">
            <div className="space-between mobile-stack">
              <div>
                <p className="eyebrow">CVR-stamdata · rigtig data</p>
                <h2 className="hero-title-sm">{company.name}</h2>
                <p className="muted">{company.fullAddress || "Adresse ikke oplyst"}</p>
              </div>
              <span className={`pill ${company.active && !company.creditRemark ? "pill-ok" : "pill-warn"}`}>
                {!company.active ? "Ophørt" : company.creditRemark ? company.creditRemark.type : "Aktiv"}
              </span>
            </div>

            <div className="tag-row">
              {company.cvr && <span className="tag">CVR {company.cvr}</span>}
              {company.companyType && <span className="tag">{company.companyType}</span>}
              {company.industryDesc && <span className="tag">{company.industryDesc}</span>}
              {company.employeesRange && <span className="tag">{company.employeesRange} ansatte</span>}
              {company.startDate && (
                <span className="tag">Stiftet {formatDanishDate(company.startDate)}</span>
              )}
              {company.endDate && (
                <span className="tag">Ophørt {formatDanishDate(company.endDate)}</span>
              )}
            </div>
          </section>

          <section className="grid three-col">
            <div className="card">
              <div className="space-between">
                <h3>Økonomi &amp; nøgletal</h3>
                {financials.status === "ok" ? (
                  <span className="pill pill-ok">Rigtig data</span>
                ) : (
                  <span className="pill">Erhvervsstyrelsen</span>
                )}
              </div>

              {fiscalYears.length > 0 && (
                <select
                  className="input"
                  style={{ marginBottom: 12 }}
                  value={selectedYearIndex}
                  disabled={financialsLoading}
                  onChange={(e) => handleYearChange(Number(e.target.value))}
                >
                  {fiscalYears.map((entry, index) => (
                    <option key={entry.fiscalYearEnd} value={index}>
                      Regnskabsår {entry.fiscalYearEnd.slice(0, 4)}
                    </option>
                  ))}
                </select>
              )}

              {financialsLoading && (
                <p className="muted small">Henter regnskabsdata (kan tage lidt tid)…</p>
              )}

              {!financialsLoading && financials.status === "ok" && (
                <div className="stack text-sm">
                  <div className="space-between">
                    <span>{financials.toplineLabel || "Omsætning/bruttofortjeneste"}</span>
                    <strong>{formatDkkMio(financials.topline)}</strong>
                  </div>
                  <div className="space-between">
                    <span>Årets resultat</span>
                    <strong>{formatDkkMio(financials.result)}</strong>
                  </div>
                  <div className="space-between">
                    <span>Resultat sidste år</span>
                    <strong>{formatDkkMio(financials.priorYearResult)}</strong>
                  </div>
                  <div className="space-between">
                    <span>Egenkapital</span>
                    <strong>{formatDkkMio(financials.equity)}</strong>
                  </div>
                  <div className="space-between">
                    <span>Balancesum</span>
                    <strong>{formatDkkMio(financials.assets)}</strong>
                  </div>
                  <div className="space-between">
                    <span>Soliditetsgrad</span>
                    <strong>{formatPercent(financials.solvencyPct)}</strong>
                  </div>
                  {financials.sourceUrl && (
                    <a href={financials.sourceUrl} target="_blank" rel="noreferrer">
                      Kilde: Regnskab {formatDate(financials.fiscalYearEnd).slice(0, 4)} →
                    </a>
                  )}
                </div>
              )}

              {!financialsLoading && financials.status === "facts_unavailable" && (
                <div className="stack text-sm">
                  <p className="muted">
                    Regnskabet blev fundet, men nøgletal kunne ikke udtrækkes automatisk (fx fordi
                    virksomheden filer via ESEF/IFRS-format).
                  </p>
                  {financials.sourceUrl && (
                    <a href={financials.sourceUrl} target="_blank" rel="noreferrer">
                      Se det indberettede regnskab →
                    </a>
                  )}
                </div>
              )}

              {!financialsLoading && financials.status === "not_found" && (
                <p className="muted small">Intet regnskab fundet i Erhvervsstyrelsens registre.</p>
              )}

              {!financialsLoading && financials.status === "error" && (
                <p className="muted small">{financials.message}</p>
              )}
            </div>

            <div className="card">
              <h3>ESG &amp; compliance</h3>
              <div className="stack text-sm">
                <div className="space-between">
                  <span>EU-sanktionstjek</span>
                  <strong className={sanctions?.fund?.length ? "text-danger" : "text-ok"}>
                    {sanctionsLoading
                      ? "Tjekker…"
                      : sanctions?.match
                        ? "Match fundet"
                        : sanctions?.fund?.length
                          ? "Muligt match — kræver verifikation"
                          : "Intet match"}
                  </strong>
                </div>
                {sanctions?.fund?.length > 0 && (
                  <p className="muted small">
                    {sanctions.match ? "Ramt: " : "Enkeltord-match, sandsynligvis tilfældigt: "}
                    {sanctions.fund.map((f) => `${f.navn} (${f.programme || "ukendt regime"})`).join(", ")}
                  </p>
                )}
                <p className="muted small">
                  Kilde: EU's konsoliderede sanktionsliste · eksakt navnematch — stavevarianter og
                  translitterationer kan derfor undslippe. Korte enkeltords-match (fx et fornavn der
                  også er alias for en udpeget person) flager som "kræver verifikation", ikke som et
                  sikkert match.
                </p>

                <div className="space-between">
                  <span>
                    CSR-rapport indsendt <span className="pill pill-mock">Demo</span>
                  </span>
                  <strong>
                    {esg.csrReportFiled ? `Ja (${esg.csrReportYear})` : "Nej"}
                  </strong>
                </div>
                <div className="space-between">
                  <span>
                    Klimarapportering <span className="pill pill-mock">Demo</span>
                  </span>
                  <strong>{esg.climateReporting ? "Ja" : "Nej"}</strong>
                </div>
                <div className="space-between">
                  <span>
                    Whistleblowerordning <span className="pill pill-mock">Demo</span>
                  </span>
                  <strong>{esg.whistleblowerScheme ? "Ja" : "Nej"}</strong>
                </div>
              </div>
            </div>

            <div className="card">
              <h3>Risikoprofil</h3>
              <div className="stack text-sm">
                <div className="space-between">
                  <span>Samlet vurdering</span>
                  <strong>
                    {sanctions?.match || company.creditRemark
                      ? "Kræver afklaring"
                      : financials.status === "ok" && financials.solvencyPct != null
                        ? financials.solvencyPct >= 30
                          ? "God soliditet"
                          : financials.solvencyPct >= 15
                            ? "Middel soliditet"
                            : "Lav soliditet"
                        : "Utilstrækkelig data"}
                  </strong>
                </div>

                {company.creditRemark && (
                  <div className="space-between">
                    <span>Virksomhedsstatus (CVR)</span>
                    <strong className="text-danger">{formatCreditRemark(company.creditRemark)}</strong>
                  </div>
                )}

                {benchmark?.solvencyPct != null && financials.solvencyPct != null && (
                  <div className="space-between">
                    <span>Soliditet vs. branche</span>
                    <strong className={financials.solvencyPct >= benchmark.solvencyPct ? "text-ok" : "text-danger"}>
                      {formatPercent(financials.solvencyPct)} vs. {formatPercent(benchmark.solvencyPct)}
                    </strong>
                  </div>
                )}

                {benchmark?.profitMarginPct != null && companyProfitMarginPct != null && (
                  <div className="space-between">
                    <span>Overskudsgrad vs. branche</span>
                    <strong
                      className={companyProfitMarginPct >= benchmark.profitMarginPct ? "text-ok" : "text-danger"}
                    >
                      {formatPercent(companyProfitMarginPct)} vs. {formatPercent(benchmark.profitMarginPct)}
                    </strong>
                  </div>
                )}

                {profitMarginNotMeaningful && (
                  <p className="muted small">
                    Overskudsgrad ikke vist — {financials.toplineLabel || "topline"} (
                    {formatDkkMio(financials.topline)}) er for lille i forhold til årets resultat til at udgøre et
                    meningsfuldt nøgletal. Typisk et holdingselskab uden reelle driftsindtægter.
                  </p>
                )}

                {benchmark && (
                  <p className="muted small">
                    Branchegennemsnit: {benchmark.sectorLabel}, {benchmark.year} · Kilde: Danmarks Statistik
                  </p>
                )}

                <p className="muted small">
                  Baseret på soliditetsgrad (egenkapital/balancesum) fra regnskabet og
                  sanktionstjek. Kombinér altid med en konkret vurdering af den enkelte opgave.
                </p>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <h3>Udvikling over tid</h3>
                <p className="muted">
                  {fiscalYears.length > 1
                    ? `Nøgletal for de seneste ${fiscalYears.length} regnskabsår, fra Erhvervsstyrelsen.`
                    : "Kun ét regnskabsår fundet — ikke nok til en udviklingsgraf."}
                </p>
              </div>
              {!trendExpanded && fiscalYears.length > 1 && (
                <button className="btn btn-secondary" onClick={loadTrend}>
                  Vis udvikling
                </button>
              )}
            </div>

            {trendExpanded && trendLoading && (
              <p className="muted small">Henter {fiscalYears.length} års regnskaber…</p>
            )}

            {trendExpanded && !trendLoading && trendError && (
              <div className="empty-state">
                <p className="muted">{trendError}</p>
              </div>
            )}

            {trendExpanded && !trendLoading && !trendError && availableMetrics.length === 0 && (
              <div className="empty-state">
                <h4>Ingen nøgletal at vise udvikling for</h4>
                <p className="muted">
                  Ingen af de fundne regnskabsår havde nøgletal der kunne udtrækkes automatisk.
                </p>
              </div>
            )}

            {trendExpanded && !trendLoading && !trendError && availableMetrics.length > 0 && (
              <>
                <div className="button-row" style={{ marginBottom: 16 }}>
                  {availableMetrics.map((def) => (
                    <button
                      key={def.key}
                      className={`nav-button ${selectedMetric === def.key ? "active" : ""}`}
                      onClick={() => setSelectedMetric(def.key)}
                    >
                      {def.label}
                    </button>
                  ))}
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ marginLeft: "auto" }}
                    onClick={() => setTrendAsTable((v) => !v)}
                  >
                    {trendAsTable ? "Vis som graf" : "Vis som tabel"}
                  </button>
                </div>

                {!trendAsTable ? (
                  <TrendChart
                    points={trendByYear.map((d) => ({
                      label: d.entry.fiscalYearEnd.slice(0, 4),
                      value: d.financials?.status === "ok" ? d.financials[selectedMetric] : null
                    }))}
                    formatValue={formatMetricValue}
                  />
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="trend-table">
                      <thead>
                        <tr>
                          <th>Regnskabsår</th>
                          <th>{activeMetricDef?.label}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trendByYear.map((d) => {
                          const value = d.financials?.status === "ok" ? d.financials[selectedMetric] : null;
                          return (
                            <tr key={d.entry.fiscalYearEnd}>
                              <td>{d.entry.fiscalYearEnd.slice(0, 4)}</td>
                              <td>{value != null ? formatMetricValue(value) : "–"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <h3>Vundne udbud (TED)</h3>
                <p className="muted">
                  {contractsLoading
                    ? "Henter…"
                    : `${contracts.total} kontrakt${contracts.total === 1 ? "" : "er"} fundet i TED${
                        totalContractValueDkk > 0
                          ? ` · samlet ${formatDkkMio(totalContractValueDkk)} (enkeltkontrakter i DKK)`
                          : ""
                      }${
                        multiWinnerCount > 0
                          ? ` · ${multiWinnerCount} rammeaftale${
                              multiWinnerCount === 1 ? "" : "r"
                            } med flere vindere ikke talt med — se enkeltbeløb under "Se detaljer"`
                          : ""
                      }`}
                </p>
              </div>
              <span className="pill">Rigtig data</span>
            </div>

            {contractsError && (
              <div className="empty-state">
                <p className="muted">{contractsError}</p>
              </div>
            )}

            {!contractsLoading && !contractsError && contracts.notices.length === 0 && (
              <div className="empty-state">
                <h4>Ingen kontrakter fundet</h4>
                <p className="muted">
                  TED dækker kun udbud over EU's tærskelværdi — mindre danske kontrakter kan findes
                  på Udbud.dk i stedet.
                </p>
              </div>
            )}

            <div className="stack">
              {contracts.notices.map((notice) => {
                const detail = noticeDetails[notice.id];
                const expanded = expandedNoticeId === notice.id;

                return (
                  <div className="subcard" key={notice.id}>
                    <div className="space-between mobile-stack">
                      <div>
                        <strong>{notice.buyerName || "Ukendt ordregiver"}</strong>
                        <p className="muted small">
                          Type: {notice.noticeType || "–"} · Notice-nr.: {notice.publicationNumber || "–"}
                        </p>
                      </div>
                      <div className="align-right">
                        {notice.isMultiWinner ? (
                          <>
                            <p className="muted small">
                              Rammeaftale/DPS med {notice.winnerCount} vindere
                            </p>
                            <p className="small">
                              Loftværdi:{" "}
                              {notice.value != null
                                ? `${notice.value.toLocaleString("da-DK")} ${notice.currency || ""}`
                                : "Ikke oplyst"}
                            </p>
                          </>
                        ) : (
                          <p>
                            Værdi:{" "}
                            {notice.value != null
                              ? `${notice.value.toLocaleString("da-DK")} ${notice.currency || ""}`
                              : "Ikke oplyst"}
                          </p>
                        )}
                        <p>Dato: {formatDate(notice.date)}</p>
                        <div className="button-row" style={{ justifyContent: "flex-end" }}>
                          {notice.publicationNumber && (
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => toggleNoticeDetail(notice)}
                            >
                              {expanded ? "Skjul detaljer" : "Se detaljer"}
                            </button>
                          )}
                          {notice.url && (
                            <a
                              href={notice.url}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-sm btn-secondary"
                            >
                              Se notice →
                            </a>
                          )}
                        </div>
                      </div>
                    </div>

                    {expanded && (
                      <div className="stack inner-gap">
                        {detail?.status === "loading" && (
                          <p className="muted small">Henter detaljer fra TED's fulde notice…</p>
                        )}
                        {detail?.status === "error" && <p className="muted small">{detail.message}</p>}

                        {detail?.status === "ok" && (
                          <>
                            {detail.data.title && (
                              <div>
                                <strong>{detail.data.title}</strong>
                                {detail.data.description && (
                                  <p className="muted small">
                                    {detail.data.description.length > 600
                                      ? `${detail.data.description.slice(0, 600)}…`
                                      : detail.data.description}
                                  </p>
                                )}
                              </div>
                            )}

                            {detail.data.lots.length > 0 && (
                              <div className="stack" style={{ gap: 10 }}>
                                <p className="small" style={{ marginBottom: 0 }}>
                                  <strong>Lots ({detail.data.lots.length})</strong>
                                </p>
                                {detail.data.lots.map((lot) => (
                                  <div key={lot.id}>
                                    <p className="small" style={{ marginBottom: 2 }}>
                                      <strong>{lot.title || lot.id}</strong>
                                    </p>
                                    {lot.description && (
                                      <p className="muted small">{lot.description}</p>
                                    )}
                                    {lot.cpvCodes.length > 0 && (
                                      <div className="tag-row">
                                        {lot.cpvCodes.map((cpv) => (
                                          <span className="tag" key={cpv}>
                                            {cpv}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {notice.isMultiWinner &&
                              (detail.data.companyAwards.length > 0 ? (
                                <div>
                                  <p className="small">
                                    <strong>{company?.name}</strong> har vundet følgende delkontrakter i
                                    denne rammeaftale:
                                  </p>
                                  <div style={{ overflowX: "auto" }}>
                                    <table className="trend-table">
                                      <thead>
                                        <tr>
                                          <th>Lot</th>
                                          <th>Delkontrakt</th>
                                          <th>Dato</th>
                                          <th>Værdi</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {detail.data.companyAwards.map((award) => (
                                          <tr key={award.tenderId}>
                                            <td>{award.lotTitle || award.lotId || "–"}</td>
                                            <td>{award.description || "–"}</td>
                                            <td>{formatDate(award.awardDate)}</td>
                                            <td>
                                              {award.value != null
                                                ? `${award.value.toLocaleString("da-DK")} ${
                                                    award.currency || ""
                                                  }`
                                                : "–"}
                                            </td>
                                          </tr>
                                        ))}
                                        <tr>
                                          <td colSpan={3}>
                                            <strong>I alt</strong>
                                          </td>
                                          <td>
                                            <strong>
                                              {detail.data.companyAwardsTotal.toLocaleString("da-DK")} DKK
                                            </strong>
                                          </td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : (
                                <p className="muted small">
                                  Kunne ikke finde specifikke delkontrakter for {company?.name} i
                                  rammeaftalens XML — navnet kan afvige fra det TED har registreret som
                                  vinder. Loftværdien ovenfor er IKKE et udtryk for hvad virksomheden
                                  reelt har fået tildelt.
                                </p>
                              ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
