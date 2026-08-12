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
import { getGoNoGoAssessment, getClarifyingQuestions } from "../services/bidAssessmentService";
import Icon from "../components/ui/Icon";
import SourceBadge from "../components/ui/SourceBadge";
import StatusChip from "../components/ui/StatusChip";
import { Working, SkeletonRows } from "../components/ui/Loading";
import { formatDkkMio, formatPercent, formatDate } from "../lib/format";

// Denne udgave af appen er bygget til ÉN bestemt tilbudsgiver — Devoteam A/S
// — ikke et generelt "slå jeres firma op"-værktøj. Egen profil indlæses
// derfor automatisk én gang ved opstart (loadOwnProfile, nedenfor), og er
// altid med i konkurrentfeltet for ethvert udbud man slår op, uden at skulle
// søges op manuelt hver gang.
const OWN_COMPANY_NAME = "Devoteam A/S";

// Et refresh mistede tidligere HELE analysen — det udbud man havde hentet,
// konkurrentfeltet, alt. Vi gemmer derfor kun en "pointer" (notice-nummer +
// scope), ikke selve de hentede data: en frisk genhentning ved opstart er
// billig (samme server-side caches som selve opslaget rammer alligevel) og
// garanterer at tallene stadig er friske, i stedet for at vise noget der
// kan være blevet forældet siden sidst. Samme "markedsanalyse.*"-nøglemønster
// som ThemeToggle/ProjectsContext/App.jsx.
const NOTICE_STORAGE_KEY = "markedsanalyse.tilbudsgiverNotice";
const SCOPE_STORAGE_KEY = "markedsanalyse.tilbudsgiverScope";

function readStoredScope() {
  try {
    const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
    return stored === "EU" ? "EU" : "DK";
  } catch {
    return "DK";
  }
}

function readStoredNotice() {
  try {
    return localStorage.getItem(NOTICE_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

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

  // AI-vurdering (Groq, gratis tier) — hentes kun på tryk, ikke automatisk,
  // dels for ikke at bruge kvoten unødigt, dels fordi vurderingen kun giver
  // mening når egen profil (ownFinancials m.fl.) rent faktisk er indlæst.
  const [goNoGoStatus, setGoNoGoStatus] = useState("idle");
  const [goNoGo, setGoNoGo] = useState(null);
  const [goNoGoError, setGoNoGoError] = useState(null);

  const [questionsStatus, setQuestionsStatus] = useState("idle");
  const [questions, setQuestions] = useState(null);
  const [questionsError, setQuestionsError] = useState(null);

  // Ingen direkte søgning her — se OWN_COMPANY_NAME. Indlæses én gang ved
  // opstart (useEffect nedenfor), ikke pr. udbud.
  const [ownStatus, setOwnStatus] = useState("idle");
  const [ownCompany, setOwnCompany] = useState(null);
  const [ownFinancials, setOwnFinancials] = useState(null);
  const [ownBenchmark, setOwnBenchmark] = useState(null);
  const [ownContracts, setOwnContracts] = useState(null);

  // Vises når "Hent udbud" ikke gav et direkte notice-nummer OG fritekst-
  // søgningen heller ikke fandt noget entydigt — så man i det mindste får
  // "det der minder mest om" i stedet for en ren fejlmeddelelse.
  const [fallbackResults, setFallbackResults] = useState([]);

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

  // Udgangspunktet er kun danske ordregivere — appens primære formål. Kan
  // udvides til hele EU, fx hvis udbuddet ligger i udlandet eller en dansk
  // afdeling byder under et udenlandsk moderselskab. Gælder søgningen efter
  // SELVE udbuddet (searchActiveNotices); konkurrentfeltet for et allerede
  // valgt udbud er uafhængigt af dette valg, da det altid følger den
  // konkrete ordregiver.
  const [searchScope, setSearchScope] = useState(readStoredScope);

  useEffect(() => {
    try {
      localStorage.setItem(SCOPE_STORAGE_KEY, searchScope);
    } catch {
      /* private mode — scope-valget holder bare kun sessionen ud */
    }
  }, [searchScope]);

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
        const results = await searchActiveNotices(trimmed, { scope: searchScope });
        if (requestId !== noticeSuggestionRequestRef.current) return; // forældet svar
        setNoticeSuggestions(results);
      } catch {
        if (requestId === noticeSuggestionRequestRef.current) setNoticeSuggestions([]);
      }
    }, 350);

    return () => clearTimeout(timer);
    // Skift af scope skal opdatere forslagene med det samme, ligesom et nyt
    // tastetryk ville.
  }, [noticeInput, searchScope]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (noticeBoxRef.current && !noticeBoxRef.current.contains(e.target)) {
        setNoticeSuggestionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Indlæser Devoteams egen profil én gang ved opstart — ikke pr. udbud, da
  // den ikke ændrer sig undervejs i en session. Samme matching-disciplin som
  // konkurrenterne (pickBestCvrMatch): "Devoteam A/S" skal ramme CVR
  // 78068213 eksakt, ikke fx "Devoteam Data Driven ApS" eller "Devoteam
  // Technology Consulting A/S", som er andre, selvstændige CVR-numre.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setOwnStatus("loading");
      const search = await søgVirksomheder(OWN_COMPANY_NAME);
      const match = search.status === "ok" ? pickBestCvrMatch(search.traf, OWN_COMPANY_NAME) : null;
      if (!match) {
        if (!cancelled) setOwnStatus("not_found");
        return;
      }

      const result = await hentVirksomhed(match.cvr);
      if (cancelled) return;
      if (result.status !== "ok") {
        setOwnStatus("error");
        return;
      }
      setOwnCompany(result.company);
      setOwnStatus("found");

      const [financials, contracts, benchmark] = await Promise.all([
        findLatestRegnskab(match.cvr),
        searchWonContractsByCompany(result.company.name),
        getIndustryBenchmark(result.company.industryCode).catch(() => null)
      ]);
      if (cancelled) return;
      setOwnFinancials(financials);
      setOwnContracts(contracts);
      setOwnBenchmark(benchmark);
    })();

    return () => {
      cancelled = true;
    };
    // Kører kun ved opstart — OWN_COMPANY_NAME er en konstant, ikke noget
    // brugeren ændrer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTenderByPublicationNumber = async (publicationNumber) => {
    setStatus("loading");
    setMessage(null);
    setRequirements(null);
    setMarket([]);
    setMarketError(null);
    // Et nyt udbud gør en tidligere AI-vurdering irrelevant — den handlede om
    // det GAMLE udbuds krav, ikke det nye.
    setGoNoGoStatus("idle");
    setGoNoGo(null);
    setGoNoGoError(null);
    setQuestionsStatus("idle");
    setQuestions(null);
    setQuestionsError(null);

    try {
      const data = await getTenderRequirements(publicationNumber);
      if (!data) {
        setStatus("error");
        setMessage("Kunne ikke hente udbuddet.");
        return;
      }
      setRequirements(data);
      setStatus("found");
      // Kun gemt ved et RIGTIGT fund — en fejlet søgning skal ikke slette et
      // tidligere gyldigt udbud, man kan stadig ville se det igen efter et
      // refresh.
      try {
        localStorage.setItem(NOTICE_STORAGE_KEY, publicationNumber);
      } catch {
        /* private mode — udbuddet holder bare kun sessionen ud */
      }

      const primaryCpv = data.cpvCodes[0] || data.lots[0]?.cpvCodes[0];
      if (primaryCpv) {
        setMarketLoading(true);
        try {
          const players = await getMarketPlayers(primaryCpv, {
            buyerName: data.buyerName,
            top: 6,
            mustInclude: OWN_COMPANY_NAME
          });
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

  // "Hent udbud" med et rigtigt notice-nummer/link går direkte. Uden et
  // genkendeligt nummer falder den i stedet tilbage på samme fritekstsøgning
  // som forslagsboksen — så et tryk på Enter uden at have klikket et forslag
  // stadig giver "det der minder mest om" i stedet for bare en fejl.
  const loadTender = async () => {
    const publicationNumber = extractPublicationNumber(noticeInput);
    setNoticeSuggestionsOpen(false);
    setFallbackResults([]);

    if (publicationNumber) {
      loadTenderByPublicationNumber(publicationNumber);
      return;
    }

    setStatus("loading");
    setMessage(null);
    try {
      const results = await searchActiveNotices(noticeInput, { limit: 8, scope: searchScope });
      if (results.length === 1) {
        // Ét entydigt træf — spring mellemstationen over, samme som
        // CompanyLookupPage gør ved ét CVR-træf.
        loadTenderByPublicationNumber(results[0].publicationNumber);
        return;
      }
      if (results.length > 1) {
        setFallbackResults(results);
        setStatus("no_direct_match");
        return;
      }
      setStatus("error");
      setMessage(
        `Ingen udbud fundet der matcher "${noticeInput.trim()}" i ${
          searchScope === "EU" ? "hele EU" : "Danmark"
        }. Prøv ${
          searchScope === "DK" ? "Hele EU ovenfor, eller " : ""
        }færre/andre ord — et notice-nummer eller TED-link virker altid.`
      );
    } catch (err) {
      setStatus("error");
      setMessage(err.message || "Søgningen fejlede.");
    }
  };

  const pickNoticeSuggestion = (notice) => {
    setNoticeInput(notice.publicationNumber);
    setNoticeSuggestionsOpen(false);
    setNoticeSuggestions([]);
    setFallbackResults([]);
    loadTenderByPublicationNumber(notice.publicationNumber);
  };

  // Genindlæser det senest fundne udbud ved opstart, hvis der er ét gemt —
  // se NOTICE_STORAGE_KEY-kommentaren for hvorfor det genhentes frisk i
  // stedet for at gemme selve resultatet.
  useEffect(() => {
    const stored = readStoredNotice();
    if (!stored) return;
    setNoticeInput(stored);
    loadTenderByPublicationNumber(stored);
    // Skal kun køre ved opstart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ownCompanyFiscalYear = ownFinancials?.status === "ok" ? ownFinancials.fiscalYearEnd?.slice(0, 4) : null;
  const ownBenchmarkForYear =
    ownBenchmark && ownCompanyFiscalYear ? pickClosestBenchmarkYear(ownBenchmark, ownCompanyFiscalYear) : null;

  const ownSingleContractValueInField = ownContracts?.notices
    ?.filter((n) => n.value != null && n.currency === "DKK" && !n.isMultiWinner)
    .reduce((sum, n) => sum + n.value, 0);

  // Kompakt, LLM-venligt billede af egne tal — kun det AI-vurderingen reelt
  // skal bruge. Send ALDRIG mere end det vi selv kan stå inde for er rigtigt
  // (ingen gæt, ingen afrunding der ser ud som præcision).
  const ownCompanyForAssessment = {
    navn: OWN_COMPANY_NAME,
    omsætning_seneste_regnskab_dkk: ownFinancials?.status === "ok" ? ownFinancials.topline : null,
    soliditetsgrad_pct: ownFinancials?.status === "ok" ? ownFinancials.solvencyPct : null,
    branchens_soliditetsgrad_pct: ownBenchmarkForYear?.solvencyPct ?? null,
    antal_egne_vundne_eu_udbud: ownContracts?.total ?? null
  };

  const runGoNoGo = async () => {
    setGoNoGoStatus("loading");
    setGoNoGoError(null);
    try {
      const result = await getGoNoGoAssessment(requirements, ownCompanyForAssessment);
      setGoNoGo(result);
      setGoNoGoStatus("ok");
    } catch (err) {
      setGoNoGoError(err.message || "Vurderingen fejlede.");
      setGoNoGoStatus("error");
    }
  };

  const runQuestions = async () => {
    setQuestionsStatus("loading");
    setQuestionsError(null);
    try {
      const result = await getClarifyingQuestions(requirements);
      setQuestions(result.questions || []);
      setQuestionsStatus("ok");
    } catch (err) {
      setQuestionsError(err.message || "Kunne ikke generere spørgsmål.");
      setQuestionsStatus("error");
    }
  };

  return (
    <main className="page">
      <section className="card">
        <div className="section-header">
          <div>
            <h3>Tilbudsgiver-radar</h3>
            <p className="muted">
              Peg på et konkret, aktivt TED-udbud og få egnethedskravene samlet ét sted, samt hvilke
              virksomheder der historisk vinder i det marked — og hvordan {OWN_COMPANY_NAME} står i
              forhold til dem.
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

        <div className="space-between mobile-stack" style={{ marginTop: 14, alignItems: "center" }}>
          <span className="muted small">Søg blandt ordregivere i</span>
          <div className="seg">
            <button
              type="button"
              className={`nav-button ${searchScope === "DK" ? "active" : ""}`}
              aria-pressed={searchScope === "DK"}
              onClick={() => setSearchScope("DK")}
            >
              Danmark
            </button>
            <button
              type="button"
              className={`nav-button ${searchScope === "EU" ? "active" : ""}`}
              aria-pressed={searchScope === "EU"}
              onClick={() => setSearchScope("EU")}
            >
              Hele EU
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

      {status === "no_direct_match" && (
        <section className="card">
          <div className="section-header">
            <div>
              <h3>Intet direkte match</h3>
              <p className="muted small">
                Ingen entydigt træf på "{noticeInput.trim()}" — her er de udbud der minder mest om det.
              </p>
            </div>
          </div>

          <div className="stack">
            {fallbackResults.map((notice) => (
              <div className="subcard" key={notice.publicationNumber}>
                <div className="space-between mobile-stack">
                  <div>
                    <strong>{notice.title || "Udbud uden titel"}</strong>
                    <p className="muted small">
                      {notice.buyerName || "Ukendt ordregiver"} · {formatDate(notice.date)}
                    </p>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => pickNoticeSuggestion(notice)}
                  >
                    Vælg →
                  </button>
                </div>
              </div>
            ))}
          </div>
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
                <h3>AI-vurdering: Go/No-Go</h3>
                <p className="muted small">
                  Groqs gpt-oss-120b vurderer ud fra egnethedskravene ovenfor og {OWN_COMPANY_NAME}s egne
                  tal — intet andet. Den gætter aldrig på manglende data, kun flager det.
                </p>
              </div>
              <span className="pill">AI-genereret</span>
            </div>

            {goNoGoStatus === "idle" && (
              <button
                className="btn btn-primary"
                onClick={runGoNoGo}
                disabled={ownStatus !== "found"}
              >
                Vurdér vores chancer
              </button>
            )}

            {goNoGoStatus === "loading" && (
              <p className="muted small">
                <Working>Vurderer mod egnethedskravene…</Working>
              </p>
            )}

            {goNoGoStatus === "error" && (
              <div className="stack stack-tight">
                <p className="muted small">{goNoGoError}</p>
                <button className="btn btn-sm btn-secondary" onClick={runGoNoGo} style={{ alignSelf: "flex-start" }}>
                  Prøv igen
                </button>
              </div>
            )}

            {goNoGoStatus === "ok" && goNoGo && (
              <div className="stack">
                <StatusChip
                  tone={
                    goNoGo.recommendation === "go" ? "ok" : goNoGo.recommendation === "no-go" ? "alert" : "warn"
                  }
                  size="lg"
                >
                  {goNoGo.recommendation === "go"
                    ? "Go"
                    : goNoGo.recommendation === "no-go"
                      ? "No-go"
                      : "Usikkert"}
                </StatusChip>
                <p className="muted small" style={{ margin: 0 }}>
                  Konfidens: <strong>{goNoGo.confidence}</strong>
                </p>
                <p className="text-sm" style={{ margin: 0 }}>
                  {goNoGo.reasoning}
                </p>
                {goNoGo.key_points?.length > 0 && (
                  <ul className="trace">
                    {goNoGo.key_points.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                )}
                {goNoGo.missing_data?.length > 0 && (
                  <div className="subcard">
                    <p className="small" style={{ marginTop: 0 }}>
                      <strong>Data der mangler for en sikrere vurdering:</strong>
                    </p>
                    <ul className="trace" style={{ marginTop: 0 }}>
                      {goNoGo.missing_data.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <button className="btn btn-sm btn-secondary" onClick={runGoNoGo} style={{ alignSelf: "flex-start" }}>
                  Vurdér igen
                </button>
              </div>
            )}
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <h3>Foreslåede spørgsmål til ordregiver</h3>
                <p className="muted small">
                  Groqs llama-3.1-8b genererer forslag ud fra udbudsteksten — send dem gennem
                  udbudsplatformens egen spørgsmål/svar-fane, appen sender intet selv.
                </p>
              </div>
              <span className="pill">AI-genereret</span>
            </div>

            {questionsStatus === "idle" && (
              <button className="btn btn-primary" onClick={runQuestions}>
                Generér spørgsmål
              </button>
            )}

            {questionsStatus === "loading" && (
              <p className="muted small">
                <Working>Læser udbudsteksten igennem…</Working>
              </p>
            )}

            {questionsStatus === "error" && (
              <div className="stack stack-tight">
                <p className="muted small">{questionsError}</p>
                <button className="btn btn-sm btn-secondary" onClick={runQuestions} style={{ alignSelf: "flex-start" }}>
                  Prøv igen
                </button>
              </div>
            )}

            {questionsStatus === "ok" && questions && (
              <div className="stack">
                {questions.length === 0 ? (
                  <p className="muted small">Ingen forslag denne gang — prøv igen.</p>
                ) : (
                  <ol className="stack stack-tight" style={{ paddingLeft: 18 }}>
                    {questions.map((q, i) => (
                      <li key={i} className="text-sm">
                        {q}
                      </li>
                    ))}
                  </ol>
                )}
                <button className="btn btn-sm btn-secondary" onClick={runQuestions} style={{ alignSelf: "flex-start" }}>
                  Generér nye
                </button>
              </div>
            )}
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
                    {/* Devoteam-rækken lægges altid øverst — det er den man
                        først vil orientere sig ud fra, uanset hvor den ville
                        være placeret i en ren vindere-rangering. */}
                    {[...market]
                      .sort((a, b) => (b.isMustInclude ? 1 : 0) - (a.isMustInclude ? 1 : 0))
                      .map((player) => (
                        <tr key={player.name} className={player.isMustInclude ? "row-own" : undefined}>
                          <td>
                            {player.isMustInclude && <span className="pill pill-ok">Jer</span>}{" "}
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
            <h3>Jeres profil — {OWN_COMPANY_NAME}</h3>
            <p className="muted small">
              Indlæses automatisk og er altid med i konkurrentfeltet ovenfor, markeret "Jer".
            </p>
          </div>
        </div>

        {ownStatus === "loading" && (
          <p className="muted small">
            <Working>Slår {OWN_COMPANY_NAME} op…</Working>
          </p>
        )}

        {(ownStatus === "not_found" || ownStatus === "error") && (
          <p className="muted small">Kunne ikke finde {OWN_COMPANY_NAME} i CVR-navneindekset.</p>
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
