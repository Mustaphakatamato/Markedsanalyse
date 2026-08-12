import { useEffect, useRef, useState } from "react";
import { hentVirksomhed, søgVirksomheder } from "../services/cvrService";
import { searchWonContractsByCompany } from "../services/tedService";
import { getNoticeDetail } from "../services/tedNoticeService";
import { getAvailableFiscalYears, getFinancialsForYear } from "../services/financialsService";
import { getESGProfile } from "../services/esgService";
import { checkSanctions } from "../services/sanctionsService";
import { getIndustryBenchmark, pickClosestBenchmarkYear } from "../services/industryBenchmarkService";
import TrendChart from "../components/charts/TrendChart";
import Icon from "../components/ui/Icon";
import SourceBadge from "../components/ui/SourceBadge";
import StatusChip from "../components/ui/StatusChip";
import ConfidenceMeter from "../components/ui/ConfidenceMeter";
import { Working, SkeletonRows, OpChip } from "../components/ui/Loading";
import { formatDkkMio, formatPercent, formatDate, formatDanishDate, formatAmount } from "../lib/format";

// Rækkefølgen her er også rækkefølgen knapperne vises i under grafen.
const METRIC_DEFS = [
  { key: "topline", label: "Omsætning/bruttofortjeneste", isPercent: false },
  { key: "result", label: "Årets resultat", isPercent: false },
  { key: "equity", label: "Egenkapital", isPercent: false },
  { key: "assets", label: "Balancesum", isPercent: false },
  { key: "solvencyPct", label: "Soliditetsgrad", isPercent: true }
];

// company.creditRemark kommer fra CVR_Kreditoplysninger (se
// cvr-datafordeler/index.ts) — Erhvervsstyrelsens egen løbende registrering
// af konkurs/tvangsopløsning/likvidation mv., med myndighedens egen ordlyd.
// null betyder intet åbent forhold at bemærke.
function formatCreditRemark(remark) {
  if (!remark) return null;
  return `${remark.type} — ${remark.stage} (siden ${formatDanishDate(remark.since)})`;
}

// Beløb, procenter og datoer sættes i tabularnumre, så kolonner flugter
// lodret når man scanner ned gennem nøgletallene.
function Figure({ children, tone }) {
  const toneClass = tone ? ` metric__value--${tone}` : "";
  return <span className={`metric__value num${toneClass}`}>{children}</span>;
}

function MetricRow({ label, value, tone }) {
  return (
    <div className="metric">
      <span className="metric__label">{label}</span>
      <Figure tone={tone}>{value}</Figure>
    </div>
  );
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

  // Samme regel som før — kun oversat til en tone, så vurderingen kan vises
  // som en status og ikke bare som en tekststreng.
  const riskVerdict = (() => {
    if (sanctions?.match || company?.creditRemark) return { label: "Kræver afklaring", tone: "alert" };
    if (financials.status === "ok" && financials.solvencyPct != null) {
      if (financials.solvencyPct >= 30) return { label: "God soliditet", tone: "ok" };
      if (financials.solvencyPct >= 15) return { label: "Middel soliditet", tone: "warn" };
      return { label: "Lav soliditet", tone: "alert" };
    }
    return { label: "Utilstrækkelig data", tone: "neutral" };
  })();

  const sanctionsVerdict = sanctions?.match
    ? { label: "Match fundet", tone: "alert" }
    : sanctions?.fund?.length
      ? { label: "Muligt match — kræver verifikation", tone: "warn" }
      : { label: "Intet match", tone: "ok" };

  return (
    <main className="page">
      {/* Sidens indgang står på konsolfladen — se .console i index.css for
          hvorfor input har sin egen mørke flade, og hvordan den beholder
          farvesignalerne intakte. */}
      <section className={`console ${status === "loading" ? "is-working" : ""}`}>
        <div className="console-head">
          <p className="eyebrow">Due diligence</p>
          <h3>Slå en virksomhed op</h3>
          <p className="lede">
            Navn eller CVR-nummer giver ét samlet billede: CVR-stamdata, vundne EU-udbud (TED),
            økonomi, branchesammenligning og ESG — med kilde på hvert eneste tal.
          </p>
        </div>

        <div className="console-bay">
          <div className="filters-grid">
            <div className="search-field" ref={searchBoxRef}>
              <label htmlFor="company-query">Firmanavn eller CVR-nummer</label>
              <div className="search-field__control">
                <Icon name="search" size={16} className="search-field__icon" />
                <input
                  id="company-query"
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
              </div>
              {suggestionsOpen && suggestions.length > 0 && (
                <ul className="suggestions-list">
                  {suggestions.map((kandidat) => (
                    <li key={kandidat.cvr}>
                      <button type="button" onClick={() => pickSuggestion(kandidat)}>
                        <span>{kandidat.navn}</span>
                        <span>CVR {kandidat.cvr}</span>
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
                {status === "loading" ? (
                  <Working>Slår op…</Working>
                ) : (
                  <>
                    <Icon name="search" size={14} />
                    Slå op
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="card-foot">
            <span className="eyebrow" style={{ margin: 0 }}>
              Kilder
            </span>
            <div className="source-row">
              <SourceBadge source="cvr" />
              <SourceBadge source="erst" />
              <SourceBadge source="ted" />
              <SourceBadge source="dst" />
              <SourceBadge source="eu" />
            </div>
          </div>
        </div>
      </section>

      {(status === "not_found" || status === "error") && (
        <section className="empty-state">
          <span className="empty-state__icon">
            <Icon name="inbox" size={22} />
          </span>
          <h4>Ingen resultat</h4>
          <p className="muted">{message}</p>
        </section>
      )}

      {status === "candidates" && (
        <section className="card">
          <div className="section-header">
            <div>
              <h3>{candidates.length} virksomheder matcher</h3>
              <p className="muted small">Vælg den du vil se profilen for.</p>
            </div>
            <SourceBadge source="cvr" label="Navneindeks" />
          </div>

          <div className="stack">
            {candidates.map((kandidat) => (
              <div className="subcard" key={kandidat.cvr}>
                <div className="space-between mobile-stack">
                  <div>
                    <strong>{kandidat.navn}</strong>
                    <p className="muted small mono">CVR {kandidat.cvr}</p>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => loadCompany(kandidat.cvr)}>
                    Se profil
                    <Icon name="arrow" size={13} />
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
                <p className="eyebrow">CVR-stamdata</p>
                <h2 className="hero-title-sm">{company.name}</h2>
                <p className="muted small">{company.fullAddress || "Adresse ikke oplyst"}</p>
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <SourceBadge source="cvr" />
                <StatusChip
                  tone={company.active && !company.creditRemark ? "ok" : "alert"}
                  size="lg"
                >
                  {!company.active ? "Ophørt" : company.creditRemark ? company.creditRemark.type : "Aktiv"}
                </StatusChip>
              </div>
            </div>

            <div className="tag-row">
              {company.cvr && (
                <span className="tag tag--code">
                  <span className="tag__key">CVR</span>
                  {company.cvr}
                </span>
              )}
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
            <div className={`card ${financialsLoading ? "is-working" : ""}`}>
              <div className="space-between">
                <h3>Økonomi &amp; nøgletal</h3>
                <SourceBadge source="erst" label="Erhvervsstyrelsen" />
              </div>

              {fiscalYears.length > 0 && (
                <select
                  className="input"
                  style={{ marginBottom: 12 }}
                  aria-label="Regnskabsår"
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
                <>
                  <Working>Henter regnskabsdata (kan tage lidt tid)…</Working>
                  <div style={{ marginTop: 14 }}>
                    <SkeletonRows rows={6} />
                  </div>
                </>
              )}

              {!financialsLoading && financials.status === "ok" && (
                <>
                  <div className="metrics">
                    <MetricRow
                      label={financials.toplineLabel || "Omsætning/bruttofortjeneste"}
                      value={formatDkkMio(financials.topline)}
                    />
                    <MetricRow label="Årets resultat" value={formatDkkMio(financials.result)} />
                    <MetricRow label="Resultat sidste år" value={formatDkkMio(financials.priorYearResult)} />
                    <MetricRow label="Egenkapital" value={formatDkkMio(financials.equity)} />
                    <MetricRow label="Balancesum" value={formatDkkMio(financials.assets)} />
                    <MetricRow label="Soliditetsgrad" value={formatPercent(financials.solvencyPct)} />
                  </div>
                  {financials.sourceUrl && (
                    <div className="card-foot">
                      <a href={financials.sourceUrl} target="_blank" rel="noreferrer" className="small">
                        Kilde: Regnskab {formatDate(financials.fiscalYearEnd).slice(0, 4)}{" "}
                        <Icon name="external" size={12} style={{ display: "inline", verticalAlign: "-1px" }} />
                      </a>
                    </div>
                  )}
                </>
              )}

              {!financialsLoading && financials.status === "facts_unavailable" && (
                <div className="stack text-sm">
                  <p className="muted">
                    Regnskabet blev fundet, men nøgletal kunne ikke udtrækkes automatisk (fx fordi
                    virksomheden filer via ESEF/IFRS-format).
                  </p>
                  {financials.sourceUrl && (
                    <a href={financials.sourceUrl} target="_blank" rel="noreferrer" className="small">
                      Se det indberettede regnskab{" "}
                      <Icon name="external" size={12} style={{ display: "inline", verticalAlign: "-1px" }} />
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

            <div className={`card ${sanctionsLoading ? "is-working" : ""}`}>
              <div className="space-between">
                <h3>ESG &amp; compliance</h3>
                <SourceBadge source="eu" label="Sanktionsliste" />
              </div>

              <p className="eyebrow" style={{ marginTop: 14 }}>
                EU-sanktionstjek
              </p>

              {sanctionsLoading ? (
                <div className="verdict">
                  <Working>Tjekker mod EU's sanktionsliste…</Working>
                </div>
              ) : (
                <div
                  className={`verdict${
                    sanctionsVerdict.tone !== "neutral" ? ` verdict--${sanctionsVerdict.tone}` : ""
                  }`}
                >
                  <span className="verdict__icon">
                    <Icon name={sanctionsVerdict.tone === "ok" ? "shield" : "alert"} size={18} />
                  </span>
                  <div className="verdict__body">
                    <p className="verdict__label">Resultat</p>
                    <p className="verdict__value">{sanctionsVerdict.label}</p>
                  </div>
                </div>
              )}

              {sanctions?.fund?.length > 0 && (
                <div className="stack stack-tight" style={{ marginTop: 12 }}>
                  <p className="small muted" style={{ margin: 0 }}>
                    {sanctions.match ? "Ramt:" : "Enkeltord-match, sandsynligvis tilfældigt:"}
                  </p>
                  {sanctions.fund.map((f, i) => (
                    <div className="subcard" key={`${f.navn}-${i}`}>
                      <div className="space-between mobile-stack">
                        <div>
                          <strong className="small">{f.navn}</strong>
                          <p className="muted small" style={{ margin: 0 }}>
                            {f.programme || "ukendt regime"}
                            {f.type ? ` · ${f.type}` : ""}
                          </p>
                        </div>
                        <ConfidenceMeter level={f.confidence} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <ul className="trace" style={{ marginTop: 14 }}>
                <li>
                  <strong>Kilde:</strong> EU's konsoliderede sanktionsliste · eksakt navnematch
                </li>
                <li>Stavevarianter og translitterationer kan derfor undslippe.</li>
                <li>
                  Korte enkeltords-match (fx et fornavn der også er alias for en udpeget person)
                  flager som "kræver verifikation", ikke som et sikkert match.
                </li>
              </ul>

              <div className="card-foot" style={{ display: "block" }}>
                <div className="space-between" style={{ marginBottom: 10 }}>
                  <p className="eyebrow" style={{ margin: 0 }}>
                    ESG-rapportering
                  </p>
                  <SourceBadge source="demo" label="Fabrikeret demo-data" />
                </div>
                <div className="metrics">
                  <MetricRow
                    label="CSR-rapport indsendt"
                    value={esg.csrReportFiled ? `Ja (${esg.csrReportYear})` : "Nej"}
                  />
                  <MetricRow label="Klimarapportering" value={esg.climateReporting ? "Ja" : "Nej"} />
                  <MetricRow label="Whistleblowerordning" value={esg.whistleblowerScheme ? "Ja" : "Nej"} />
                </div>
              </div>
            </div>

            <div className="card">
              <div className="space-between">
                <h3>Risikoprofil</h3>
                <SourceBadge source="dst" label="Branchetal" />
              </div>

              <div
                className={`verdict${riskVerdict.tone !== "neutral" ? ` verdict--${riskVerdict.tone}` : ""}`}
                style={{ marginTop: 12 }}
              >
                <span className="verdict__icon">
                  <Icon name={riskVerdict.tone === "ok" ? "check" : riskVerdict.tone === "neutral" ? "info" : "alert"} size={18} />
                </span>
                <div className="verdict__body">
                  <p className="verdict__label">Samlet vurdering</p>
                  <p className="verdict__value">{riskVerdict.label}</p>
                </div>
              </div>

              <div className="metrics" style={{ marginTop: 6 }}>
                {company.creditRemark && (
                  <MetricRow
                    label="Virksomhedsstatus (CVR)"
                    value={formatCreditRemark(company.creditRemark)}
                    tone="alert"
                  />
                )}

                {benchmark?.solvencyPct != null && financials.solvencyPct != null && (
                  <MetricRow
                    label="Soliditet vs. branche"
                    value={`${formatPercent(financials.solvencyPct)} vs. ${formatPercent(benchmark.solvencyPct)}`}
                    tone={financials.solvencyPct >= benchmark.solvencyPct ? "ok" : "alert"}
                  />
                )}

                {benchmark?.profitMarginPct != null && companyProfitMarginPct != null && (
                  <MetricRow
                    label="Overskudsgrad vs. branche"
                    value={`${formatPercent(companyProfitMarginPct)} vs. ${formatPercent(
                      benchmark.profitMarginPct
                    )}`}
                    tone={companyProfitMarginPct >= benchmark.profitMarginPct ? "ok" : "alert"}
                  />
                )}
              </div>

              {profitMarginNotMeaningful && (
                <p className="muted small" style={{ marginTop: 12 }}>
                  Overskudsgrad ikke vist — {financials.toplineLabel || "topline"} (
                  {formatDkkMio(financials.topline)}) er for lille i forhold til årets resultat til at udgøre et
                  meningsfuldt nøgletal. Typisk et holdingselskab uden reelle driftsindtægter.
                </p>
              )}

              <ul className="trace" style={{ marginTop: 14 }}>
                {benchmark && (
                  <li>
                    <strong>Branchegennemsnit:</strong> {benchmark.sectorLabel}, {benchmark.year} · Kilde:
                    Danmarks Statistik
                  </li>
                )}
                <li>
                  Baseret på soliditetsgrad (egenkapital/balancesum) fra regnskabet og sanktionstjek.
                  Kombinér altid med en konkret vurdering af den enkelte opgave.
                </li>
              </ul>
            </div>
          </section>

          <section className={`card ${trendLoading ? "is-working" : ""}`}>
            <div className="section-header">
              <div>
                <h3>Udvikling over tid</h3>
                <p className="muted small">
                  {fiscalYears.length > 1
                    ? `Nøgletal for de seneste ${fiscalYears.length} regnskabsår, fra Erhvervsstyrelsen.`
                    : "Kun ét regnskabsår fundet — ikke nok til en udviklingsgraf."}
                </p>
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <SourceBadge source="erst" label="Erhvervsstyrelsen" />
                {!trendExpanded && fiscalYears.length > 1 && (
                  <button className="btn btn-secondary btn-sm" onClick={loadTrend}>
                    <Icon name="trend" size={14} />
                    Vis udvikling
                  </button>
                )}
              </div>
            </div>

            {trendExpanded && trendLoading && (
              <Working>Henter {fiscalYears.length} års regnskaber…</Working>
            )}

            {trendExpanded && !trendLoading && trendError && (
              <div className="empty-state">
                <p className="muted">{trendError}</p>
              </div>
            )}

            {trendExpanded && !trendLoading && !trendError && availableMetrics.length === 0 && (
              <div className="empty-state">
                <span className="empty-state__icon">
                  <Icon name="trend" size={22} />
                </span>
                <h4>Ingen nøgletal at vise udvikling for</h4>
                <p className="muted">
                  Ingen af de fundne regnskabsår havde nøgletal der kunne udtrækkes automatisk.
                </p>
              </div>
            )}

            {trendExpanded && !trendLoading && !trendError && availableMetrics.length > 0 && (
              <>
                <div className="space-between mobile-stack" style={{ marginBottom: 18, alignItems: "center" }}>
                  <div className="seg">
                    {availableMetrics.map((def) => (
                      <button
                        key={def.key}
                        type="button"
                        className={`nav-button ${selectedMetric === def.key ? "active" : ""}`}
                        aria-pressed={selectedMetric === def.key}
                        onClick={() => setSelectedMetric(def.key)}
                      >
                        {def.label}
                      </button>
                    ))}
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setTrendAsTable((v) => !v)}>
                    <Icon name={trendAsTable ? "trend" : "table"} size={14} />
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
                  <div className="scroll-x">
                    <table className="data-table">
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
                              <td className="mono">{d.entry.fiscalYearEnd.slice(0, 4)}</td>
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

          <section className={`card ${contractsLoading ? "is-working" : ""}`}>
            <div className="section-header">
              <div>
                <h3>Vundne udbud (TED)</h3>
                <p className="muted small">
                  Kontrakttildelinger hvor virksomheden står som vinder i EU's udbudsdatabase.
                </p>
              </div>
              <SourceBadge source="ted" />
            </div>

            {contractsLoading ? (
              <SkeletonRows rows={4} />
            ) : (
              <div className="grid three-col" style={{ gap: 12, marginBottom: 18 }}>
                <div className="stat">
                  <p className="stat__label">Kontrakter i TED</p>
                  <span className="stat__value stat__value--big">{contracts.total}</span>
                </div>
                <div className="stat">
                  <p className="stat__label">Samlet værdi</p>
                  <span className="stat__value stat__value--big">
                    {totalContractValueDkk > 0 ? formatDkkMio(totalContractValueDkk) : "–"}
                  </span>
                  <p className="muted small" style={{ margin: "2px 0 0" }}>
                    enkeltkontrakter i DKK
                  </p>
                </div>
                <div className="stat">
                  <p className="stat__label">Rammeaftaler</p>
                  <span className="stat__value stat__value--big">{multiWinnerCount}</span>
                  <p className="muted small" style={{ margin: "2px 0 0" }}>
                    {multiWinnerCount > 0
                      ? 'med flere vindere — ikke talt med, se enkeltbeløb under "Se detaljer"'
                      : "ingen med flere vindere"}
                  </p>
                </div>
              </div>
            )}

            {contractsError && (
              <div className="empty-state">
                <p className="muted">{contractsError}</p>
              </div>
            )}

            {!contractsLoading && !contractsError && contracts.notices.length === 0 && (
              <div className="empty-state">
                <span className="empty-state__icon">
                  <Icon name="scales" size={22} />
                </span>
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
                  <div className={`subcard ${expanded ? "is-open" : ""}`} key={notice.id}>
                    <div className="space-between mobile-stack">
                      <div style={{ minWidth: 0 }}>
                        <strong>{notice.buyerName || "Ukendt ordregiver"}</strong>
                        <div className="tag-row" style={{ marginTop: 6 }}>
                          <span className="tag">
                            <span className="tag__key">Type</span>
                            {notice.noticeType || "–"}
                          </span>
                          <span className="tag tag--code">
                            <span className="tag__key">Notice</span>
                            {notice.publicationNumber || "–"}
                          </span>
                          <span className="tag tag--code">
                            <span className="tag__key">Dato</span>
                            {formatDate(notice.date)}
                          </span>
                        </div>
                      </div>

                      <div className="align-right" style={{ flex: "none" }}>
                        {notice.isMultiWinner ? (
                          <>
                            <p className="stat__label">Loftværdi</p>
                            <span className="stat__value num">
                              {formatAmount(notice.value, notice.currency)}
                            </span>
                            <div style={{ marginTop: 6 }}>
                              <StatusChip tone="warn">
                                Rammeaftale/DPS med {notice.winnerCount} vindere
                              </StatusChip>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="stat__label">Værdi</p>
                            <span className="stat__value num">
                              {formatAmount(notice.value, notice.currency)}
                            </span>
                          </>
                        )}

                        <div className="button-row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                          {notice.publicationNumber && (
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              aria-expanded={expanded}
                              onClick={() => toggleNoticeDetail(notice)}
                            >
                              <Icon
                                name="chevron"
                                size={13}
                                style={{
                                  transform: expanded ? "rotate(180deg)" : "none",
                                  transition: "transform 0.24s ease"
                                }}
                              />
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
                              Se notice
                              <Icon name="external" size={13} />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className={`reveal ${expanded ? "is-open" : ""}`}>
                      <div className="reveal__inner">
                        <div className="reveal__body">
                          {detail?.status === "loading" && (
                            <div className="stack stack-tight">
                              <Working>Henter detaljer fra TED's fulde notice…</Working>
                              <div className="row">
                                <OpChip state="running">ted-notice · eForms-XML</OpChip>
                                <OpChip state="running">join · Organisation → LotTender</OpChip>
                              </div>
                            </div>
                          )}
                          {detail?.status === "error" && (
                            <div className="stack stack-tight">
                              <div className="row">
                                <OpChip state="failed">ted-notice · fejlede</OpChip>
                              </div>
                              <p className="muted small" style={{ margin: 0 }}>
                                {detail.message}
                              </p>
                            </div>
                          )}

                          {detail?.status === "ok" && (
                            <div className="stack">
                              <div className="row">
                                <OpChip state="done">ted-notice · fuld eForms-XML</OpChip>
                              </div>

                              {detail.data.title && (
                                <div>
                                  <strong className="text-sm">{detail.data.title}</strong>
                                  {detail.data.description && (
                                    <p className="muted small" style={{ margin: "4px 0 0" }}>
                                      {detail.data.description.length > 600
                                        ? `${detail.data.description.slice(0, 600)}…`
                                        : detail.data.description}
                                    </p>
                                  )}
                                </div>
                              )}

                              {detail.data.lots.length > 0 && (
                                <div className="stack stack-tight">
                                  <p className="eyebrow" style={{ margin: 0 }}>
                                    Lots ({detail.data.lots.length})
                                  </p>
                                  {detail.data.lots.map((lot) => (
                                    <div key={lot.id}>
                                      <p className="small" style={{ margin: 0 }}>
                                        <strong>{lot.title || lot.id}</strong>
                                      </p>
                                      {lot.description && (
                                        <p className="muted small" style={{ margin: "2px 0 0" }}>
                                          {lot.description}
                                        </p>
                                      )}
                                      {lot.cpvCodes.length > 0 && (
                                        <div className="tag-row" style={{ marginTop: 6 }}>
                                          {lot.cpvCodes.map((cpv) => (
                                            <span className="tag tag--code" key={cpv}>
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
                                    <p className="small" style={{ marginTop: 0 }}>
                                      <strong>{company?.name}</strong> har vundet følgende delkontrakter i
                                      denne rammeaftale:
                                    </p>
                                    <div className="scroll-x">
                                      <table className="data-table">
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
                                              <td className="mono">{formatDate(award.awardDate)}</td>
                                              <td>
                                                {award.value != null
                                                  ? `${award.value.toLocaleString("da-DK")} ${
                                                      award.currency || ""
                                                    }`
                                                  : "–"}
                                              </td>
                                            </tr>
                                          ))}
                                          <tr className="row-total">
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
                                    <ul className="trace" style={{ marginTop: 12 }}>
                                      <li>
                                        Beløbene er joinet på ID'er i notice'ens fulde eForms-XML
                                        (Organisation → TenderingParty → LotTender), ikke gættet ud fra
                                        rækkefølge.
                                      </li>
                                    </ul>
                                  </div>
                                ) : (
                                  <p className="muted small">
                                    Kunne ikke finde specifikke delkontrakter for {company?.name} i
                                    rammeaftalens XML — navnet kan afvige fra det TED har registreret som
                                    vinder. Loftværdien ovenfor er IKKE et udtryk for hvad virksomheden
                                    reelt har fået tildelt.
                                  </p>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
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
