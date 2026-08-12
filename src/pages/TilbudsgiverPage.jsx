// Tilbudsgiver-radar — det spejlvendte flow af CompanyLookupPage/TenderPage.
// De to eksisterende flows researcher markedet FOR en ordregiver. Dette flow
// er til TILBUDSGIVEREN: peg det på et konkret, aktivt TED-udbud, og få at
// vide hvem der historisk vinder den slags kontrakter, og hvordan man selv
// står finansielt i forhold til dem — uden at skulle læse bekendtgørelsen.
//
// VIGTIG ÆRLIGHED, gennemgående i hele siden: TED har data om hvem der har
// VUNDET tidligere kontrakter, ALDRIG om hvem der byder på netop dette
// udbud — den oplysning er ikke offentlig før tildeling. Konkurrentfeltet
// herunder er derfor konsekvent formuleret som historiske vindere i
// markedet, aldrig som en forudsigelse af hvem der byder. Samme disciplin
// som getMarketPlayers() i tedService.js er bygget efter.
//
// Egnethedskravene i en TED-bekendtgørelse er FRI TEKST, ikke et
// struktureret talfelt (verificeret ved direkte research, se
// tedNoticeService.getTenderRequirements) — siden viser derfor kravteksten
// rå, ved siden af virksomhedens egne tal, og forsøger ALDRIG at give et
// automatisk "opfylder/opfylder ikke"-svar.

import { useEffect, useRef, useState } from "react";
import { hentVirksomhed, søgVirksomheder } from "../services/cvrService";
import { getTenderRequirements } from "../services/tedNoticeService";
import {
  getMarketPlayers,
  searchActiveNotices,
  searchWonContractsByCompany,
  coreCompanyName,
  normalizeForMatch
} from "../services/tedService";
import { findLatestRegnskab } from "../services/regnskabService";
import { getIndustryBenchmark, pickClosestBenchmarkYear } from "../services/industryBenchmarkService";
import Icon from "../components/ui/Icon";
import SourceBadge from "../components/ui/SourceBadge";
import { Working, SkeletonRows } from "../components/ui/Loading";
import { formatDkkMio, formatPercent, formatDate } from "../lib/format";

// Genkender både en rå notice-nummer-form ("558609-2026") og et hvilket som
// helst TED-link der indeholder den samme streng et sted i URL'en — ingen
// grund til at kræve at brugeren selv piller nummeret ud af et link.
function extractPublicationNumber(input) {
  const match = (input || "").match(/(\d{4,8}-\d{4})/);
  return match ? match[1] : null;
}

// Finder det mest sandsynlige CVR-nummer for et TED-vindernavn — samme
// konservative matching som resten af TED-koden (tedService/tedNoticeService):
// kun et navn der reelt matcher, aldrig det første tilfældige træf.
function pickBestCvrMatch(candidates, name) {
  const fullNeedle = normalizeForMatch(name);
  const core = coreCompanyName(name);
  const coreNeedle = core.length >= 3 ? normalizeForMatch(core) : null;

  return (
    candidates.find((k) => normalizeForMatch(k.navn) === fullNeedle) ||
    candidates.find((k) => coreNeedle && normalizeForMatch(k.navn).includes(coreNeedle)) ||
    null
  );
}

async function resolveCompanyFinancials(name) {
  const search = await søgVirksomheder(name);
  if (search.status !== "ok") return { cvr: null, financials: null };

  const match = pickBestCvrMatch(search.traf, name);
  if (!match) return { cvr: null, financials: null };

  const financials = await findLatestRegnskab(match.cvr);
  return { cvr: match.cvr, financials };
}

export default function TilbudsgiverPage({ onGoToCompany }) {
  const [noticeInput, setNoticeInput] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState(null);
  const [requirements, setRequirements] = useState(null);
  const [expandedCriterion, setExpandedCriterion] = useState(null);

  const [market, setMarket] = useState([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState(null);

  const [ownQuery, setOwnQuery] = useState("");
  const [ownStatus, setOwnStatus] = useState("idle");
  const [ownCandidates, setOwnCandidates] = useState([]);
  const [ownCompany, setOwnCompany] = useState(null);
  const [ownFinancials, setOwnFinancials] = useState(null);
  const [ownBenchmark, setOwnBenchmark] = useState(null);
  const [ownContracts, setOwnContracts] = useState(null);

  // Live forslag på titel/ordregiver mens man skriver — se
  // searchActiveNotices() i tedService.js for hvorfor det IKKE kan opdatere
  // sig pr. tastetryk sådan som firmanavne-forslagene i CompanyLookupPage
  // gør (TED matcher kun hele ord). Debounces i stedet det aktuelle input
  // som en hel frase; boksen viser simpelthen intet før et helt ord er
  // skrevet færdigt.
  const [noticeSuggestions, setNoticeSuggestions] = useState([]);
  const [noticeSuggestionsOpen, setNoticeSuggestionsOpen] = useState(false);
  const noticeBoxRef = useRef(null);
  const noticeSuggestionRequestRef = useRef(0);

  useEffect(() => {
    const trimmed = noticeInput.trim();
    // Indeholder input allerede et genkendeligt notice-nummer (rå tal eller
    // inde i et indsat TED-link), er der intet at foreslå — brugeren har
    // allerede det de skal bruge, og en fritekstsøgning på selve URL'en
    // ville alligevel ikke give nogen træf.
    if (trimmed.length < 2 || extractPublicationNumber(trimmed)) {
      setNoticeSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      const requestId = ++noticeSuggestionRequestRef.current;
      try {
        const results = await searchActiveNotices(trimmed);
        if (requestId !== noticeSuggestionRequestRef.current) return; // forældet svar
        setNoticeSuggestions(results);
      } catch {
        if (requestId === noticeSuggestionRequestRef.current) setNoticeSuggestions([]);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [noticeInput]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (noticeBoxRef.current && !noticeBoxRef.current.contains(e.target)) {
        setNoticeSuggestionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadTenderByPublicationNumber = async (publicationNumber) => {
    setStatus("loading");
    setMessage(null);
    setRequirements(null);
    setMarket([]);
    setMarketError(null);

    try {
      const data = await getTenderRequirements(publicationNumber);
      if (!data) {
        setStatus("error");
        setMessage("Kunne ikke hente udbuddet.");
        return;
      }
      setRequirements(data);
      setStatus("found");

      const primaryCpv = data.cpvCodes[0] || data.lots[0]?.cpvCodes[0];
      if (primaryCpv) {
        setMarketLoading(true);
        try {
          const players = await getMarketPlayers(primaryCpv, { buyerName: data.buyerName, top: 6 });
          setMarket(players);

          // Finansielle nøgletal er dyrere at hente (ét kald pr. konkurrent) —
          // gøres derfor kun for feltet vi rent faktisk viser, og fejler
          // stille pr. virksomhed frem for at vælte hele feltet.
          const enriched = await Promise.all(
            players.map(async (player) => {
              try {
                const { cvr, financials } = await resolveCompanyFinancials(player.name);
                return { ...player, cvr, financials };
              } catch {
                return { ...player, cvr: null, financials: null };
              }
            })
          );
          setMarket(enriched);
        } catch (err) {
          setMarketError(err.message || "Kunne ikke hente konkurrentfeltet.");
        } finally {
          setMarketLoading(false);
        }
      }
    } catch (err) {
      setStatus("error");
      setMessage(err.message || "Kunne ikke hente udbuddet.");
    }
  };

  const loadTender = () => {
    const publicationNumber = extractPublicationNumber(noticeInput);
    if (!publicationNumber) {
      setStatus("error");
      setMessage('Kunne ikke genkende et notice-nummer i det du indsatte. Prøv formen "558609-2026", eller indsæt selve TED-linket.');
      return;
    }
    setNoticeSuggestionsOpen(false);
    loadTenderByPublicationNumber(publicationNumber);
  };

  const pickNoticeSuggestion = (notice) => {
    setNoticeInput(notice.publicationNumber);
    setNoticeSuggestionsOpen(false);
    setNoticeSuggestions([]);
    loadTenderByPublicationNumber(notice.publicationNumber);
  };

  const loadOwnCompany = async (cvr) => {
    setOwnStatus("loading");
    setOwnCandidates([]);

    const result = await hentVirksomhed(cvr);
    if (result.status !== "ok") {
      setOwnStatus(result.status === "not_found" ? "not_found" : "error");
      return;
    }

    setOwnCompany(result.company);
    setOwnStatus("found");

    const [financials, contracts, benchmark] = await Promise.all([
      findLatestRegnskab(cvr),
      searchWonContractsByCompany(result.company.name),
      getIndustryBenchmark(result.company.industryCode).catch(() => null)
    ]);
    setOwnFinancials(financials);
    setOwnContracts(contracts);
    setOwnBenchmark(benchmark);
  };

  const runOwnSearch = async () => {
    const trimmed = ownQuery.trim();
    if (!trimmed) return;

    setOwnStatus("loading");
    const result = await søgVirksomheder(trimmed);

    if (result.status === "cvr") return loadOwnCompany(result.cvr);
    if (result.status !== "ok") {
      setOwnStatus(result.status);
      return;
    }
    if (result.traf.length === 1) return loadOwnCompany(result.traf[0].cvr);

    setOwnCandidates(result.traf);
    setOwnStatus("candidates");
  };

  const ownCompanyFiscalYear = ownFinancials?.status === "ok" ? ownFinancials.fiscalYearEnd?.slice(0, 4) : null;
  const ownBenchmarkForYear =
    ownBenchmark && ownCompanyFiscalYear ? pickClosestBenchmarkYear(ownBenchmark, ownCompanyFiscalYear) : null;

  const ownSingleContractValueInField = ownContracts?.notices
    ?.filter((n) => n.value != null && n.currency === "DKK" && !n.isMultiWinner)
    .reduce((sum, n) => sum + n.value, 0);

  return (
    <main className="page">
      <section className="card">
        <div className="section-header">
          <div>
            <h3>Tilbudsgiver-radar</h3>
            <p className="muted">
              Peg på et konkret, aktivt TED-udbud og få egnethedskravene samlet ét sted, samt hvilke
              virksomheder der historisk vinder i det marked — og hvordan I selv står i forhold til dem.
            </p>
          </div>
        </div>

        <div className="filters-grid">
          <div style={{ gridColumn: "1 / -1", position: "relative" }} ref={noticeBoxRef}>
            <label htmlFor="notice-input">TED-link, notice-nummer, titel eller ordregiver</label>
            <input
              id="notice-input"
              className="input"
              placeholder="Fx et TED-link, 558609-2026, et udbudsnavn eller ordregiverens navn"
              value={noticeInput}
              autoComplete="off"
              onChange={(e) => {
                setNoticeInput(e.target.value);
                setNoticeSuggestionsOpen(true);
              }}
              onFocus={() => noticeSuggestions.length > 0 && setNoticeSuggestionsOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setNoticeSuggestionsOpen(false);
                  loadTender();
                } else if (e.key === "Escape") {
                  setNoticeSuggestionsOpen(false);
                }
              }}
            />
            {noticeSuggestionsOpen && noticeSuggestions.length > 0 && (
              <ul className="suggestions-list">
                {noticeSuggestions.map((notice) => (
                  <li key={notice.publicationNumber}>
                    <button type="button" onClick={() => pickNoticeSuggestion(notice)}>
                      <span>{notice.title || "Udbud uden titel"}</span>
                      <span className="muted small">
                        {notice.buyerName || "Ukendt ordregiver"} · {formatDate(notice.date)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="button-row align-end">
            <button
              className="btn btn-primary"
              onClick={loadTender}
              disabled={status === "loading" || !noticeInput.trim()}
            >
              {status === "loading" ? <Working>Henter…</Working> : "Hent udbud"}
            </button>
          </div>
        </div>

        <div className="card-foot">
          <span className="eyebrow" style={{ margin: 0 }}>
            Kilder
          </span>
          <div className="source-row">
            <SourceBadge source="ted" label="TED · eForms-XML" />
            <SourceBadge source="cvr" />
            <SourceBadge source="erst" />
          </div>
        </div>
      </section>

      {status === "error" && (
        <section className="empty-state">
          <span className="empty-state__icon">
            <Icon name="inbox" size={22} />
          </span>
          <h4>Kunne ikke hente udbuddet</h4>
          <p className="muted">{message}</p>
        </section>
      )}

      {status === "found" && requirements && (
        <>
          <section className="card">
            <div className="section-header">
              <div>
                <h3>{requirements.title || "Udbuddet"}</h3>
                <p className="muted small">{requirements.buyerName || "Ukendt ordregiver"}</p>
              </div>
              <SourceBadge source="ted" />
            </div>

            {requirements.description && (
              <p className="muted small">
                {requirements.description.length > 500
                  ? `${requirements.description.slice(0, 500)}…`
                  : requirements.description}
              </p>
            )}

            {requirements.cpvCodes.length > 0 && (
              <div className="tag-row">
                {requirements.cpvCodes.map((cpv) => (
                  <span className="tag tag--code" key={cpv}>
                    {cpv}
                  </span>
                ))}
              </div>
            )}

            {requirements.lots.length > 1 && (
              <div className="stack stack-tight inner-gap">
                <p className="eyebrow" style={{ margin: 0 }}>
                  Lots ({requirements.lots.length})
                </p>
                {requirements.lots.map((lot) => (
                  <div key={lot.id}>
                    <p className="small" style={{ margin: 0 }}>
                      <strong>{lot.title || lot.id}</strong>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <h3>Egnethedskrav</h3>
                <p className="muted small">
                  Ordregiverens egen tekst, kategoriseret — ikke et automatisk opfylder/opfylder
                  ikke-tjek. Der findes ikke noget struktureret talfelt at læse et minimumskrav ud af i
                  TED's data, kun fri tekst.
                </p>
              </div>
            </div>

            {requirements.criteria.length === 0 && (
              <p className="muted small">
                Ingen strukturerede egnethedskrav fundet i denne bekendtgørelse — de kan stadig stå i
                selve udbudsmaterialet (bilag), som TED ikke indeholder.
              </p>
            )}

            <div className="stack">
              {requirements.criteria.map((criterion, i) => {
                const open = expandedCriterion === i;
                const isLong = criterion.description.length > 300;
                return (
                  <div className="subcard" key={i}>
                    <p className="small" style={{ margin: 0 }}>
                      <strong>{criterion.category}</strong>
                    </p>
                    <p className="muted small" style={{ margin: "6px 0 0" }}>
                      {open || !isLong ? criterion.description : `${criterion.description.slice(0, 300)}…`}
                    </p>
                    {isLong && (
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        style={{ marginTop: 8 }}
                        onClick={() => setExpandedCriterion(open ? null : i)}
                      >
                        {open ? "Vis mindre" : "Vis hele kravet"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <h3>Konkurrentfeltet</h3>
                <p className="muted small">
                  Virksomheder der historisk har vundet flest kontrakter i dette CPV-felt
                  {requirements.buyerName ? ` hos ${requirements.buyerName}` : ""}. Dette er historiske
                  VINDERE — TED har ingen data om hvem der rent faktisk byder på netop dette udbud.
                </p>
              </div>
              <SourceBadge source="ted" />
            </div>

            {marketLoading && <SkeletonRows rows={5} />}
            {marketError && <p className="muted small">{marketError}</p>}

            {!marketLoading && !marketError && market.length === 0 && (
              <p className="muted small">
                Ingen tidligere TED-tildelinger fundet for dette CPV-felt — enten et nyt marked, eller
                kontrakterne har hidtil ligget under EU's tærskelværdi (og findes derfor ikke i TED).
              </p>
            )}

            {market.length > 0 && (
              <div className="scroll-x">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Virksomhed</th>
                      <th>Kontrakter i feltet</th>
                      <th>Samlet enkeltkontraktværdi</th>
                      <th>Omsætning</th>
                      <th>Soliditetsgrad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {market.map((player) => (
                      <tr key={player.name}>
                        <td>
                          {onGoToCompany ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => onGoToCompany(player.name)}
                            >
                              <Icon name="search" size={12} />
                              {player.name}
                            </button>
                          ) : (
                            player.name
                          )}
                        </td>
                        <td className="mono">{player.winCount}</td>
                        <td>
                          {player.singleContractValueDkk > 0
                            ? formatDkkMio(player.singleContractValueDkk)
                            : "–"}
                        </td>
                        <td>
                          {player.financials?.status === "ok"
                            ? formatDkkMio(player.financials.topline)
                            : player.cvr
                              ? "Ikke tilgængeligt"
                              : "CVR ikke fundet"}
                        </td>
                        <td>
                          {player.financials?.status === "ok"
                            ? formatPercent(player.financials.solvencyPct)
                            : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <ul className="trace" style={{ marginTop: 14 }}>
              <li>
                "Kontrakter i feltet" tæller hver navngiven vinder i op til 50 nylige tildelinger på
                CPV-koden — for en rammeaftale med flere vindere tælles alle med, men rammens loftværdi
                lægges ALDRIG til "Samlet enkeltkontraktværdi" (se getMarketPlayers i tedService.js).
              </li>
              <li>Omsætning/soliditetsgrad er selskabets seneste indberettede regnskab hos Erhvervsstyrelsen.</li>
            </ul>
          </section>
        </>
      )}

      <section className="card">
        <div className="section-header">
          <div>
            <h3>Jeres profil</h3>
            <p className="muted small">
              Slå jeres eget selskab op for at holde jeres tal op mod konkurrentfeltet ovenfor.
            </p>
          </div>
        </div>

        <div className="filters-grid">
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="own-query">Firmanavn eller CVR-nummer</label>
            <input
              id="own-query"
              className="input"
              placeholder="Jeres eget firmanavn eller CVR-nummer"
              value={ownQuery}
              onChange={(e) => setOwnQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runOwnSearch()}
            />
          </div>
          <div className="button-row align-end">
            <button
              className="btn btn-primary"
              onClick={runOwnSearch}
              disabled={ownStatus === "loading" || !ownQuery.trim()}
            >
              {ownStatus === "loading" ? <Working>Slår op…</Working> : "Slå op"}
            </button>
          </div>
        </div>

        {ownStatus === "candidates" && (
          <div className="stack inner-gap">
            {ownCandidates.map((kandidat) => (
              <div className="subcard" key={kandidat.cvr}>
                <div className="space-between mobile-stack">
                  <div>
                    <strong>{kandidat.navn}</strong>
                    <p className="muted small">CVR {kandidat.cvr}</p>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => loadOwnCompany(kandidat.cvr)}>
                    Vælg →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {(ownStatus === "not_found" || ownStatus === "error") && (
          <p className="muted small inner-gap">Kunne ikke finde selskabet.</p>
        )}

        {ownStatus === "found" && ownCompany && (
          <div className="stack inner-gap">
            <div className="subcard">
              <div className="space-between mobile-stack">
                <div>
                  <strong>{ownCompany.name}</strong>
                  <p className="muted small">CVR {ownCompany.cvr}</p>
                </div>
                <SourceBadge source="cvr" />
              </div>

              <div className="metric">
                <span className="metric__label">Omsætning (seneste regnskab)</span>
                <span className="metric__value num">
                  {ownFinancials?.status === "ok" ? formatDkkMio(ownFinancials.topline) : "Ikke tilgængeligt"}
                </span>
              </div>
              <div className="metric">
                <span className="metric__label">Soliditetsgrad</span>
                <span className="metric__value num">
                  {ownFinancials?.status === "ok" ? formatPercent(ownFinancials.solvencyPct) : "–"}
                  {ownFinancials?.status === "ok" && ownBenchmarkForYear?.solvencyPct != null && (
                    <span className="muted small" style={{ marginLeft: 8 }}>
                      (branchen {ownBenchmarkForYear.year}: {formatPercent(ownBenchmarkForYear.solvencyPct)})
                    </span>
                  )}
                </span>
              </div>
              <div className="metric">
                <span className="metric__label">Egne vundne EU-udbud (TED)</span>
                <span className="metric__value num">
                  {ownContracts
                    ? `${ownContracts.total} kontrakt${ownContracts.total === 1 ? "" : "er"}${
                        ownSingleContractValueInField > 0
                          ? ` · ${formatDkkMio(ownSingleContractValueInField)}`
                          : ""
                      }`
                    : <SkeletonRows rows={1} />}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
