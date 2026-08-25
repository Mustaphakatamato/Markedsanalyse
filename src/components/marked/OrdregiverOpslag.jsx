import { useEffect, useRef, useState } from "react";
import { søgOrdregivere } from "../../services/ordregiverService";
import { hentVirksomhed } from "../../services/cvrService";
import { soegUdbud, ARTER, KILDER, dageTil } from "../../services/udbudService";
import { searchNoticesByBuyer, TED_ARTER, tedTypeEtiket } from "../../services/tedService";
import UdbudKort from "./UdbudKort";
import Icon from "../ui/Icon";
import SourceBadge from "../ui/SourceBadge";
import StatusChip from "../ui/StatusChip";
import { Working, SkeletonRows } from "../ui/Loading";
import { formatDanishDate, formatAmount } from "../../lib/format";

// Ordregiveropslag: hvad har DENNE myndighed selv sendt i udbud.
//
// TO KILDER, TO LISTER — MED VILJE. De dækker forskellige perioder og kan
// ikke lægges sammen uden at lyve om den ene:
//
//   udbud.dk-indekset  Både EU-udbud (TED) og de danske udbud UNDER
//                      tærskelværdien (DKUDBUD), som TED aldrig har kendt.
//                      Men kun tilbage til november 2024, hvor vi begyndte at
//                      indlæse. Har CPV-koder, frister og link til
//                      udbudsmaterialet.
//
//   TED direkte        Kun EU-udbud, men hele historikken — for Københavns
//                      Kommune 2.419 bekendtgørelser tilbage til 2016 mod
//                      indeksets 887. Har vinderen på tildelingerne.
//
// De nyeste bekendtgørelser står derfor i BEGGE lister. Det siges eksplicit i
// UI'et frem for at blive skjult bag en dedublering, der ville kræve at man
// stolede på publikationsnummeret som fælles nøgle — og det findes ikke på
// DKUDBUD-rækkerne (se migrationen 20260814160000).

const SIDESTOERRELSE = 25;
const TED_SIDESTOERRELSE = 20;

// Fristmærke til TED-rækkerne. UdbudKort har sit eget til indeksrækkerne;
// dette er den samme oplysning på en anden datastruktur (TED giver fristen
// pr. delkontrakt, indekset som ét felt), og de to skal se ens ud.
function TedFrist({ dato }) {
  const dage = dageTil(dato);
  if (dage == null) return null;
  if (dage < 0) return <span className="pill">frist overskredet</span>;
  return (
    <span className={`pill ${dage <= 7 ? "pill-warn" : "pill-ok"}`}>
      {dage === 0 ? "frist i dag" : dage === 1 ? "1 dag tilbage" : `${dage} dage tilbage`}
    </span>
  );
}

function TedRaekke({ notice }) {
  return (
    <li className="udbud-kort">
      <div className="udbud-kort__top">
        <h4 className="udbud-kort__titel">{notice.title || "Uden titel"}</h4>
        <div className="tag-row">
          <TedFrist dato={notice.deadline} />
          <span className="pill">{tedTypeEtiket(notice.noticeType)}</span>
        </div>
      </div>

      <p className="udbud-kort__meta muted small">
        {notice.buyerName || "Ukendt ordregiver"}
        {notice.date && ` · offentliggjort ${formatDanishDate(notice.date)}`}
        {notice.deadline && ` · frist ${formatDanishDate(notice.deadline)}`}
      </p>

      {notice.winnerName && (
        <p className="udbud-kort__beskrivelse small">
          <strong>Vinder:</strong> {notice.winnerName}
          {notice.value != null && (
            <>
              {" · "}
              {notice.isMultiWinner ? "loftværdi " : ""}
              {formatAmount(notice.value, notice.currency)}
            </>
          )}
        </p>
      )}

      {notice.isMultiWinner && (
        <div className="tag-row">
          <StatusChip tone="warn">
            Rammeaftale/DPS med {notice.winnerCount} vindere — beløbet er rammens loft
          </StatusChip>
        </div>
      )}

      {notice.cpvCodes.length > 0 && (
        <div className="tag-row">
          {notice.cpvCodes.slice(0, 6).map((k) => (
            <span className="tag tag--code" key={k}>
              {k}
            </span>
          ))}
          {notice.cpvCodes.length > 6 && (
            <span className="tag">+{notice.cpvCodes.length - 6}</span>
          )}
        </div>
      )}

      <div className="button-row">
        {notice.url && (
          <a className="btn btn-secondary btn-sm" href={notice.url} target="_blank" rel="noreferrer">
            Se notice i TED
            <Icon name="external" size={12} />
          </a>
        )}
        {notice.publicationNumber && (
          <span className="tag tag--code">
            <span className="tag__key">Notice</span>
            {notice.publicationNumber}
          </span>
        )}
      </div>
    </li>
  );
}

export default function OrdregiverOpslag({ typeVaelger }) {
  const [tekst, setTekst] = useState("");
  const [forslag, setForslag] = useState([]);
  const [forslagAaben, setForslagAaben] = useState(false);
  const [soegeStatus, setSoegeStatus] = useState("idle");
  const [soegeBesked, setSoegeBesked] = useState(null);
  const soegeboksRef = useRef(null);
  // Beskytter mod at et langsomt, forældet svar overskriver et nyere — samme
  // grund som i CompanyLookupPage's forslagsliste.
  const forslagRef = useRef(0);

  const [valgt, setValgt] = useState(null);
  const [stamdata, setStamdata] = useState(null);

  // udbud.dk-listen
  const [arter, setArter] = useState([]);
  const [kilder, setKilder] = useState([]);
  const [kunAabne, setKunAabne] = useState(false);
  const [sortering, setSortering] = useState("nyeste");
  const [side, setSide] = useState(0);
  const [indeks, setIndeks] = useState(null);
  const [indeksStatus, setIndeksStatus] = useState("idle");
  const [indeksFejl, setIndeksFejl] = useState(null);

  // TED-listen
  const [tedArt, setTedArt] = useState("alle");
  const [tedSide, setTedSide] = useState(0);
  const [ted, setTed] = useState(null);
  const [tedStatus, setTedStatus] = useState("idle");
  const [tedFejl, setTedFejl] = useState(null);

  // Live forslag mens man skriver. 250 ms som på virksomhedsopslaget —
  // søgningen er to seq-scans over hele bekendtgørelsestabellen (~130 ms), og
  // ét kald pr. tastetryk ville være spild af begge ender.
  useEffect(() => {
    const term = tekst.trim();
    if (term.length < 2) {
      setForslag([]);
      return;
    }
    // At vælge en ordregiver skriver navnet i feltet. Uden dette ville netop
    // det skrive-hop udløse en ny søgning på et navn, der allerede er valgt.
    if (valgt && term === valgt.navn.trim()) return;

    const timer = setTimeout(async () => {
      const id = ++forslagRef.current;
      setSoegeStatus("soeger");
      const svar = await søgOrdregivere(term);
      if (id !== forslagRef.current) return; // et nyere kald er undervejs
      setForslag(svar.status === "ok" ? svar.ordregivere : []);
      setSoegeStatus(svar.status === "ok" ? "ok" : svar.status);
      setSoegeBesked(svar.status === "ok" ? null : svar.message);
    }, 250);

    return () => clearTimeout(timer);
  }, [tekst, valgt]);

  // Luk forslagsboksen ved klik udenfor — mousedown frem for onBlur, så et
  // klik PÅ et forslag ikke lukker boksen, før onClick er nået at køre.
  useEffect(() => {
    function udenfor(e) {
      if (soegeboksRef.current && !soegeboksRef.current.contains(e.target)) {
        setForslagAaben(false);
      }
    }
    document.addEventListener("mousedown", udenfor);
    return () => document.removeEventListener("mousedown", udenfor);
  }, []);

  const vaelgOrdregiver = (ordregiver) => {
    setValgt(ordregiver);
    setTekst(ordregiver.navn);
    setForslagAaben(false);
    setForslag([]);
    setStamdata(null);
    setArter([]);
    setKilder([]);
    setKunAabne(false);
    setSortering("nyeste");
    setSide(0);
    setTedArt("alle");
    setTedSide(0);
    setIndeks(null);
    setTed(null);
  };

  // Stamdata er et supplement, ikke en forudsætning: profilen står på
  // bekendtgørelserne. Fejler opslaget (eller har ordregiveren intet
  // CVR-nummer i kilden), vises resten uændret.
  useEffect(() => {
    if (!valgt?.cvr) return;
    let annulleret = false;
    hentVirksomhed(valgt.cvr)
      .then((svar) => {
        if (!annulleret && svar.status === "ok") setStamdata(svar.company);
      })
      .catch(() => {});
    return () => {
      annulleret = true;
    };
  }, [valgt?.cvr]);

  const filterNoegle = `${arter.join(",")}|${kilder.join(",")}|${kunAabne}|${sortering}`;

  // Et skift i filtrene skal føre tilbage til første side — ellers lander man
  // på side 4 af et resultat, der måske kun har én.
  useEffect(() => {
    setSide(0);
  }, [filterNoegle]);

  useEffect(() => {
    if (!valgt) return;
    let annulleret = false;
    setIndeksStatus("henter");
    setIndeksFejl(null);

    soegUdbud({
      ordregiverCvr: valgt.cvr,
      // Kun for de ordregivere kilden ikke har givet et CVR-nummer; ellers
      // ville navnet skære de øvrige navnevarianter væk.
      ordregiverNavn: valgt.cvr ? null : valgt.navn,
      arter,
      kilder,
      kunAabne,
      sortering,
      maks: SIDESTOERRELSE,
      springOver: side * SIDESTOERRELSE
    })
      .then((data) => {
        if (annulleret) return;
        setIndeks(data);
        setIndeksStatus("faerdig");
      })
      .catch((err) => {
        if (annulleret) return;
        setIndeksFejl(err.message || "Søgningen fejlede.");
        setIndeksStatus("fejl");
      });

    return () => {
      annulleret = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valgt, filterNoegle, side]);

  useEffect(() => {
    setTedSide(0);
  }, [tedArt]);

  useEffect(() => {
    if (!valgt) return;
    let annulleret = false;
    setTedStatus("henter");
    setTedFejl(null);

    searchNoticesByBuyer({
      cvr: valgt.cvr,
      navn: valgt.navn,
      art: tedArt,
      page: tedSide + 1,
      limit: TED_SIDESTOERRELSE
    })
      .then((data) => {
        if (annulleret) return;
        setTed(data);
        setTedStatus("faerdig");
      })
      .catch((err) => {
        if (annulleret) return;
        setTedFejl(err.message || "TED-søgningen fejlede.");
        setTedStatus("fejl");
      });

    return () => {
      annulleret = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valgt, tedArt, tedSide]);

  const skiftIListe = (liste, saet, vaerdi) =>
    saet(liste.includes(vaerdi) ? liste.filter((v) => v !== vaerdi) : [...liste, vaerdi]);

  const udbud = indeks?.udbud ?? [];
  const ialt = indeks?.ialt ?? 0;
  const sidsteSide = Math.max(0, Math.ceil(ialt / SIDESTOERRELSE) - 1);

  const tedNotices = ted?.notices ?? [];
  const tedIalt = ted?.total ?? 0;
  // TED's paginering rækker langt, men vi standser ved det API'et selv kan
  // levere frem for at love sider, der svarer med en fejl.
  const tedSidsteSide = Math.max(0, Math.ceil(tedIalt / TED_SIDESTOERRELSE) - 1);

  const indeksStart = indeks?.indeksStart || valgt?.foerste || null;

  // Tallene på filterknapperne følger DEN AKTUELLE søgning, ligesom på
  // Udbudssøgning — ikke ordregiverens totaler. Ellers ville "Udbud 190" stå
  // uændret, mens listen under viste 12, fordi kilden også var afgrænset.
  // Indtil første svar er hentet, bruges ordregiverens egne tal fra
  // forslagslisten, så knapperne ikke starter tomme.
  const prArt = indeks?.prArt ?? valgt?.prArt ?? {};
  const prKilde = indeks?.prKilde ?? valgt?.prKilde ?? {};

  return (
    <>
      <section className={`console ${soegeStatus === "soeger" ? "is-working" : ""}`}>
        <div className="console-head">
          {typeVaelger}
          <p className="eyebrow">Ordregiveropslag</p>
          <h3>Slå en ordregiver op</h3>
          <p className="lede">
            Se hvad en myndighed selv har sendt i udbud — både på udbud.dk (også de
            danske udbud under tærskelværdien) og i TED, hvor historikken rækker år
            længere tilbage. Slås op på CVR-nummer, så alle myndighedens navnevarianter
            kommer med.
          </p>
        </div>

        <div className="console-bay">
          <div className="filters-grid">
            <div className="search-field" ref={soegeboksRef}>
              <label htmlFor="ordregiver-query">Ordregiver eller CVR-nummer</label>
              <div className="search-field__control">
                <Icon name="search" size={16} className="search-field__icon" />
                <input
                  id="ordregiver-query"
                  className="input"
                  placeholder="Fx Københavns Kommune, Banedanmark eller 64942212"
                  value={tekst}
                  autoComplete="off"
                  onChange={(e) => {
                    setTekst(e.target.value);
                    setForslagAaben(true);
                  }}
                  onFocus={() => forslag.length > 0 && setForslagAaben(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setForslagAaben(false);
                    // Enter vælger det øverste forslag: der er ingen "søg"-knap
                    // at trykke på, fordi en ordregiver altid skal VÆLGES —
                    // søgeteksten alene er ikke en entydig myndighed.
                    if (e.key === "Enter" && forslag.length > 0) {
                      vaelgOrdregiver(forslag[0]);
                    }
                  }}
                />
              </div>
              {forslagAaben && forslag.length > 0 && (
                <ul className="suggestions-list">
                  {forslag.map((o) => (
                    <li key={o.cvr || o.navn}>
                      <button type="button" onClick={() => vaelgOrdregiver(o)}>
                        <span>
                          {o.navn}
                          {o.antalNavne > 1 && ` · ${o.antalNavne} navnevarianter`}
                        </span>
                        {/* Uden CVR-nummer kan rækken ikke slås sammen med
                            myndighedens øvrige bekendtgørelser, og samme navn
                            kan derfor optræde to gange i listen. Det skal
                            kunne læses, ikke gættes. */}
                        <span>
                          {o.cvr ? `CVR ${o.cvr} · ` : "uden CVR · "}
                          {o.antal.toLocaleString("da-DK")} bek.
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {soegeStatus === "not_found" && tekst.trim().length >= 2 && (
            <p className="muted small" style={{ marginTop: 12 }}>
              {soegeBesked}
            </p>
          )}
          {soegeStatus === "error" && (
            <p className="muted small" style={{ marginTop: 12 }}>
              {soegeBesked}
            </p>
          )}

          <div className="card-foot">
            <span className="eyebrow" style={{ margin: 0 }}>
              Kilder
            </span>
            <div className="source-row">
              <SourceBadge source="ted" label="udbud.dk (TED + DKUDBUD)" />
              <SourceBadge source="ted" label="TED · hele historikken" />
              <SourceBadge source="cvr" />
            </div>
          </div>
        </div>
      </section>

      {!valgt && (
        <section className="empty-state">
          <span className="empty-state__icon">
            <Icon name="building" size={22} />
          </span>
          <h4>Vælg en ordregiver</h4>
          <p className="muted">
            Skriv mindst to tegn. Forslagene er de ordregivere, der faktisk har
            offentliggjort bekendtgørelser — med antallet, så du kan se hvem af flere
            enslydende navne du er ved at ramme.
          </p>
        </section>
      )}

      {valgt && (
        <>
          <section className="card">
            <div className="space-between mobile-stack">
              <div>
                <p className="eyebrow">Ordregiver</p>
                <h2 className="hero-title-sm">{valgt.navn}</h2>
                <p className="muted small">
                  {stamdata?.fullAddress ||
                    (valgt.cvr ? "Henter adresse fra CVR…" : "Intet CVR-nummer oplyst i kilden")}
                </p>
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <SourceBadge source="cvr" />
                {valgt.aabne > 0 ? (
                  <StatusChip tone="ok" size="lg" icon="check">
                    {valgt.aabne} åbne udbud
                  </StatusChip>
                ) : (
                  <StatusChip tone="neutral" size="lg">
                    Ingen åbne udbud lige nu
                  </StatusChip>
                )}
              </div>
            </div>

            <div className="tag-row">
              {valgt.cvr && (
                <span className="tag tag--code">
                  <span className="tag__key">CVR</span>
                  {valgt.cvr}
                </span>
              )}
              {stamdata?.companyType && <span className="tag">{stamdata.companyType}</span>}
              {stamdata?.industryDesc && <span className="tag">{stamdata.industryDesc}</span>}
              {valgt.seneste && (
                <span className="tag">Seneste bekendtgørelse {formatDanishDate(valgt.seneste)}</span>
              )}
            </div>

            {/* Navnevarianterne er ikke pynt: de viser hvilke forvaltninger og
                enheder der udbyder under myndighedens CVR-nummer, og de er
                grunden til at tallene her er større end en navnesøgning giver. */}
            {valgt.antalNavne > 1 && (
              <div className="card-foot" style={{ display: "block" }}>
                <p className="eyebrow" style={{ marginBottom: 8 }}>
                  Optræder under {valgt.antalNavne} navne i bekendtgørelserne
                </p>
                <div className="tag-row">
                  {valgt.navnevarianter.map((n) => (
                    <span className="tag" key={n}>
                      {n}
                    </span>
                  ))}
                  {valgt.antalNavne > valgt.navnevarianter.length && (
                    <span className="tag">
                      +{valgt.antalNavne - valgt.navnevarianter.length} flere
                    </span>
                  )}
                </div>
              </div>
            )}
          </section>

          <div className="grid three-col" style={{ gap: 12 }}>
            <div className="stat">
              <p className="stat__label">På udbud.dk</p>
              <span className="stat__value stat__value--big">
                {(indeks?.ialt ?? valgt.antal).toLocaleString("da-DK")}
              </span>
              <p className="muted small" style={{ margin: "2px 0 0" }}>
                bekendtgørelser siden {indeksStart ? formatDanishDate(indeksStart) : "indlæsningens start"}
              </p>
            </div>
            <div className="stat">
              <p className="stat__label">Heraf under tærskelværdien</p>
              <span className="stat__value stat__value--big">
                {(valgt.prKilde?.DKUDBUD ?? 0).toLocaleString("da-DK")}
              </span>
              <p className="muted small" style={{ margin: "2px 0 0" }}>
                DKUDBUD — findes ikke i TED
              </p>
            </div>
            <div className="stat">
              <p className="stat__label">I TED</p>
              <span className="stat__value stat__value--big">
                {tedStatus === "faerdig" ? tedIalt.toLocaleString("da-DK") : "…"}
              </span>
              <p className="muted small" style={{ margin: "2px 0 0" }}>
                hele historikken, ikke kun indeksets periode
              </p>
            </div>
          </div>

          <section className={`card ${indeksStatus === "henter" ? "is-working" : ""}`}>
            <div className="section-header">
              <div>
                <h3>
                  {indeksStatus === "faerdig"
                    ? `${ialt.toLocaleString("da-DK")} bekendtgørelser på udbud.dk`
                    : "Bekendtgørelser på udbud.dk"}
                </h3>
                <p className="muted small">
                  Både EU-udbud og de danske udbud under tærskelværdien. Med CPV-koder,
                  frister og link til udbudsmaterialet.
                </p>
              </div>
              <SourceBadge source="ted" label="udbud.dk (TED + DKUDBUD)" />
            </div>

            <div className="udbud-filtre">
              <div>
                <p className="eyebrow">Type</p>
                <div className="seg" role="group" aria-label="Filtrér på bekendtgørelsestype">
                  {ARTER.map((a) => (
                    <button
                      key={a.vaerdi}
                      type="button"
                      className={`nav-button ${arter.includes(a.vaerdi) ? "active" : ""}`}
                      aria-pressed={arter.includes(a.vaerdi)}
                      onClick={() => skiftIListe(arter, setArter, a.vaerdi)}
                    >
                      {a.etiket}
                      {prArt[a.vaerdi] ? (
                        <span className="nav-button__tal"> {prArt[a.vaerdi]}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="eyebrow">Kilde</p>
                <div className="seg" role="group" aria-label="Filtrér på kilde">
                  {KILDER.map((k) => (
                    <button
                      key={k.vaerdi}
                      type="button"
                      className={`nav-button ${kilder.includes(k.vaerdi) ? "active" : ""}`}
                      aria-pressed={kilder.includes(k.vaerdi)}
                      onClick={() => skiftIListe(kilder, setKilder, k.vaerdi)}
                    >
                      {k.etiket}
                      {prKilde[k.vaerdi] ? (
                        <span className="nav-button__tal"> {prKilde[k.vaerdi]}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="eyebrow">Frist</p>
                <div className="seg" role="group" aria-label="Filtrér på frist">
                  <button
                    type="button"
                    className={`nav-button ${!kunAabne ? "active" : ""}`}
                    onClick={() => setKunAabne(false)}
                  >
                    Alle
                  </button>
                  <button
                    type="button"
                    className={`nav-button ${kunAabne ? "active" : ""}`}
                    onClick={() => setKunAabne(true)}
                  >
                    Kun åbne
                  </button>
                </div>
              </div>

              <div>
                <p className="eyebrow">Sortér</p>
                <div className="seg" role="group" aria-label="Sortering">
                  {[
                    ["nyeste", "Nyeste"],
                    ["frist", "Frist"],
                    ["vaerdi", "Værdi"]
                  ].map(([v, etiket]) => (
                    <button
                      key={v}
                      type="button"
                      className={`nav-button ${sortering === v ? "active" : ""}`}
                      onClick={() => setSortering(v)}
                    >
                      {etiket}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {indeksStatus === "henter" && (
              <>
                <Working>Søger i udbud.dk-indekset…</Working>
                <div style={{ marginTop: 14 }}>
                  <SkeletonRows rows={5} />
                </div>
              </>
            )}

            {indeksStatus === "fejl" && <p className="muted small">{indeksFejl}</p>}

            {indeksStatus === "faerdig" && !udbud.length && (
              <div className="empty-state">
                <span className="empty-state__icon">
                  <Icon name="inbox" size={22} />
                </span>
                <h4>Ingen bekendtgørelser matcher</h4>
                <p className="muted">
                  Prøv at slå filtrene fra. Indekset dækker udbud.dk fra{" "}
                  {indeksStart ? formatDanishDate(indeksStart) : "november 2024"} — ældre
                  udbud fra denne ordregiver står i TED-listen nedenfor.
                </p>
              </div>
            )}

            {udbud.length > 0 && (
              <ul className="udbud-liste">
                {udbud.map((u) => (
                  <UdbudKort key={`${u.noticeId}-${u.version}`} udbud={u} />
                ))}
              </ul>
            )}

            {ialt > SIDESTOERRELSE && (
              <div className="kandidat-mere">
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={side === 0}
                  onClick={() => setSide((n) => Math.max(0, n - 1))}
                >
                  Forrige
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={side >= sidsteSide}
                  onClick={() => setSide((n) => Math.min(sidsteSide, n + 1))}
                >
                  Næste
                </button>
                <span className="muted small">
                  Side {side + 1} af {sidsteSide + 1}
                </span>
              </div>
            )}
          </section>

          <section className={`card ${tedStatus === "henter" ? "is-working" : ""}`}>
            <div className="section-header">
              <div>
                <h3>
                  {tedStatus === "faerdig"
                    ? `${tedIalt.toLocaleString("da-DK")} bekendtgørelser i TED`
                    : "Bekendtgørelser i TED"}
                </h3>
                <p className="muted small">
                  {valgt.cvr
                    ? `Søgt på ordregiverens CVR-nummer (buyer-identifier=${valgt.cvr}), ikke på navnet — derfor er alle myndighedens enheder med.`
                    : "Ordregiveren har intet CVR-nummer i kilden, så her er søgt på navnet og hvert træf verificeret mod ordregivernavnet i TED."}
                </p>
              </div>
              <SourceBadge source="ted" />
            </div>

            <div className="udbud-filtre">
              <div>
                <p className="eyebrow">Type</p>
                <div className="seg" role="group" aria-label="Filtrér TED på bekendtgørelsestype">
                  {TED_ARTER.map((a) => (
                    <button
                      key={a.vaerdi}
                      type="button"
                      className={`nav-button ${tedArt === a.vaerdi ? "active" : ""}`}
                      aria-pressed={tedArt === a.vaerdi}
                      onClick={() => setTedArt(a.vaerdi)}
                    >
                      {a.etiket}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {tedStatus === "henter" && (
              <>
                <Working>Søger i TED…</Working>
                <div style={{ marginTop: 14 }}>
                  <SkeletonRows rows={5} />
                </div>
              </>
            )}

            {tedStatus === "fejl" && <p className="muted small">{tedFejl}</p>}

            {tedStatus === "faerdig" && !tedNotices.length && (
              <div className="empty-state">
                <span className="empty-state__icon">
                  <Icon name="inbox" size={22} />
                </span>
                <h4>Ingen bekendtgørelser i TED</h4>
                <p className="muted">
                  TED dækker kun udbud over EU's tærskelværdi. Udbyder ordregiveren
                  udelukkende under tærskelværdien, står alt i listen ovenfor.
                </p>
              </div>
            )}

            {tedNotices.length > 0 && (
              <ul className="udbud-liste">
                {tedNotices.map((n) => (
                  <TedRaekke key={n.publicationNumber || n.id} notice={n} />
                ))}
              </ul>
            )}

            {tedIalt > TED_SIDESTOERRELSE && (
              <div className="kandidat-mere">
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={tedSide === 0}
                  onClick={() => setTedSide((n) => Math.max(0, n - 1))}
                >
                  Forrige
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={tedSide >= tedSidsteSide}
                  onClick={() => setTedSide((n) => Math.min(tedSidsteSide, n + 1))}
                >
                  Næste
                </button>
                <span className="muted small">
                  Side {tedSide + 1} af {tedSidsteSide + 1}
                </span>
              </div>
            )}

            <ul className="trace" style={{ marginTop: 14 }}>
              <li>
                <strong>De to lister overlapper.</strong> Bekendtgørelser fra{" "}
                {indeksStart ? formatDanishDate(indeksStart) : "november 2024"} og frem står
                i begge — udbud.dk-listen har CPV-koder og link til materialet, TED-listen
                har vinderen og rækker år længere tilbage.
              </li>
              <li>
                <strong>Kilde:</strong> TED's søgning på <span className="mono">buyer-identifier</span>{" "}
                (ordregiverens nationale registreringsnummer) afgrænset til{" "}
                <span className="mono">buyer-country=DNK</span>. Landefilteret er med, fordi
                feltet ikke er dansk-specifikt og enkelte udenlandske ordregivere har
                indberettet numre, der kolliderer med et CVR-nummer.
              </li>
              <li>
                Værdien på en tildeling er notice'ens samlede beløb. Er der flere vindere
                (rammeaftale/DPS), er det rammens loft — ikke hvad den enkelte leverandør
                fik. Se en konkret leverandørs andel under Leverandør-opslaget.
              </li>
              {ted?.viaNavn && (
                <li>
                  Søgt på navn, ikke CVR-nummer. Antallet er efter vores egen verifikation
                  af ordregivernavnet, ikke TED's rå træfantal — det kan derfor være lavere
                  end det, TED selv ville rapportere.
                </li>
              )}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
