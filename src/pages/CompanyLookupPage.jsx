import { useEffect, useState } from "react";
import { lookupCompany } from "../services/cvrService";
import { searchWonContractsByCompany } from "../services/tedService";
import { getAvailableFiscalYears, getFinancialsForYear } from "../services/financialsService";
import { getESGProfile } from "../services/esgService";
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

function formatDate(isoDate) {
  return isoDate ? isoDate.slice(0, 10) : "–";
}

const STATUS_MESSAGES = {
  not_found: "Ingen virksomhed fundet med det navn eller CVR-nummer.",
  quota_exceeded: null, // uses service-provided message
  error: "Der skete en fejl under opslaget."
};

export default function CompanyLookupPage({ prefillQuery, prefillToken }) {
  const [query, setQuery] = useState(prefillQuery || "");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState(null);
  const [company, setCompany] = useState(null);
  const [esg, setEsg] = useState(null);
  const [contracts, setContracts] = useState({ notices: [], total: 0, usedFallback: false });
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractsError, setContractsError] = useState(null);
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

  const runSearch = async (term) => {
    const trimmed = (term ?? "").trim();
    if (!trimmed) return;

    setStatus("loading");
    setMessage(null);
    setCompany(null);

    const result = await lookupCompany(trimmed);

    if (result.status !== "ok") {
      setStatus(result.status);
      setMessage(result.message || STATUS_MESSAGES[result.status]);
      return;
    }

    setCompany(result.company);
    setEsg(getESGProfile(result.company));
    setStatus("found");

    setContractsLoading(true);
    setContractsError(null);
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

    await Promise.all([contractsPromise, financialsPromise, benchmarkPromise]);
  };

  useEffect(() => {
    if (!prefillToken) return;
    setQuery(prefillQuery);
    runSearch(prefillQuery);
    // Skal kun genkøres når hoppet fra markedsanalysen udløser et nyt token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillToken]);

  const totalContractValueDkk = contracts.notices
    .filter((n) => n.value != null && n.currency === "DKK")
    .reduce((sum, n) => sum + n.value, 0);

  const availableMetrics = METRIC_DEFS.filter((def) =>
    trendByYear.some((d) => d.financials?.status === "ok" && d.financials[def.key] != null)
  );
  const activeMetricDef = availableMetrics.find((def) => def.key === selectedMetric) || null;
  const formatMetricValue = (value) => (activeMetricDef?.isPercent ? `${value}%` : formatDkkMio(value));

  const companyFiscalYear = financials.status === "ok" ? financials.fiscalYearEnd?.slice(0, 4) : null;
  const benchmark =
    industryBenchmark && companyFiscalYear ? pickClosestBenchmarkYear(industryBenchmark, companyFiscalYear) : null;
  const companyProfitMarginPct =
    financials.status === "ok" && financials.result != null && financials.topline
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
          <div style={{ gridColumn: "1 / -1" }}>
            <label>Firmanavn eller CVR-nummer</label>
            <input
              className="input"
              placeholder="Fx Netcompany A/S eller 28429738"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch(query)}
            />
          </div>
          <div className="button-row align-end">
            <button
              className="btn btn-primary"
              onClick={() => runSearch(query)}
              disabled={status === "loading" || !query.trim()}
            >
              {status === "loading" ? "Slår op…" : "Slå op"}
            </button>
          </div>
        </div>
      </section>

      {(status === "not_found" || status === "quota_exceeded" || status === "error") && (
        <section className="empty-state">
          <h4>Ingen resultat</h4>
          <p className="muted">{message}</p>
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
              <span className={`pill ${company.active ? "pill-ok" : "pill-warn"}`}>
                {company.active ? "Aktiv" : "Ophørt"}
              </span>
            </div>

            <div className="tag-row">
              {company.cvr && <span className="tag">CVR {company.cvr}</span>}
              {company.companyType && <span className="tag">{company.companyType}</span>}
              {company.industryDesc && <span className="tag">{company.industryDesc}</span>}
              {company.employeesRange && <span className="tag">{company.employeesRange} ansatte</span>}
              {company.startDate && <span className="tag">Stiftet {company.startDate}</span>}
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
                    <strong>{financials.solvencyPct != null ? `${financials.solvencyPct}%` : "–"}</strong>
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
              <div className="space-between">
                <h3>ESG &amp; compliance</h3>
                <span className="pill pill-mock">Demo-data</span>
              </div>
              <div className="stack text-sm">
                <div className="space-between">
                  <span>CSR-rapport indsendt</span>
                  <strong>
                    {esg.csrReportFiled ? `Ja (${esg.csrReportYear})` : "Nej"}
                  </strong>
                </div>
                <div className="space-between">
                  <span>Klimarapportering</span>
                  <strong>{esg.climateReporting ? "Ja" : "Nej"}</strong>
                </div>
                <div className="space-between">
                  <span>Whistleblowerordning</span>
                  <strong>{esg.whistleblowerScheme ? "Ja" : "Nej"}</strong>
                </div>
                <div className="space-between">
                  <span>EU-sanktionstjek</span>
                  <strong className={esg.sanctionsMatch ? "text-danger" : "text-ok"}>
                    {esg.sanctionsMatch ? "Match fundet" : "Intet match"}
                  </strong>
                </div>
              </div>
            </div>

            <div className="card">
              <h3>Risikoprofil</h3>
              <div className="stack text-sm">
                <div className="space-between">
                  <span>Samlet vurdering</span>
                  <strong>
                    {esg.sanctionsMatch
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

                {benchmark?.solvencyPct != null && financials.solvencyPct != null && (
                  <div className="space-between">
                    <span>Soliditet vs. branche</span>
                    <strong className={financials.solvencyPct >= benchmark.solvencyPct ? "text-ok" : "text-danger"}>
                      {financials.solvencyPct}% vs. {benchmark.solvencyPct}%
                    </strong>
                  </div>
                )}

                {benchmark?.profitMarginPct != null && companyProfitMarginPct != null && (
                  <div className="space-between">
                    <span>Overskudsgrad vs. branche</span>
                    <strong
                      className={companyProfitMarginPct >= benchmark.profitMarginPct ? "text-ok" : "text-danger"}
                    >
                      {companyProfitMarginPct}% vs. {benchmark.profitMarginPct}%
                    </strong>
                  </div>
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
                          ? ` · samlet ${formatDkkMio(totalContractValueDkk)} (DKK-kontrakter)`
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
              {contracts.notices.map((notice) => (
                <div className="subcard" key={notice.id}>
                  <div className="space-between mobile-stack">
                    <div>
                      <strong>{notice.buyerName || "Ukendt ordregiver"}</strong>
                      <p className="muted small">
                        Type: {notice.noticeType || "–"} · Notice-nr.: {notice.publicationNumber || "–"}
                      </p>
                    </div>
                    <div className="align-right">
                      <p>
                        Værdi:{" "}
                        {notice.value != null
                          ? `${notice.value.toLocaleString("da-DK")} ${notice.currency || ""}`
                          : "Ikke oplyst"}
                      </p>
                      <p>Dato: {formatDate(notice.date)}</p>
                      {notice.url && (
                        <a href={notice.url} target="_blank" rel="noreferrer">
                          Se notice →
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
