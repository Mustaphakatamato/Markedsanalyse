// Kontraktopslaget: skriv et CVR-nummer og et kontraktnavn i fri tekst, få
// kontrakten og leverandøren foldet ud.
//
// HVORFOR EN SAMTALE OG IKKE ET SØGEFELT: fordi brugeren sjældent kender
// bekendtgørelsens nummer, men næsten altid kender et CVR-nummer og et
// omtrentligt navn. Samtalen gør det muligt at sige "nej, den anden" og
// snævre ind, uden at skulle forstå TED's felter.
//
// HVAD MODELLEN MÅ, OG HVAD DEN IKKE MÅ — det er sidens vigtigste præmis:
// sprogmodellen læser KUN beskeden og udfylder søgekriterier. Hvert tal, navn
// og hver dato på siden kommer fra TED eller CVR, aldrig fra modellen. Derfor
// står fortolkningen eksplicit øverst i svaret ("sådan læste jeg din
// besked"), så en forkert læsning kan ses med det samme frem for at blive
// opdaget som et mærkeligt resultat længere nede.

import { useEffect, useRef, useState } from "react";
import { spoergAgent, hentKontrakt, artEtiket } from "../services/kontraktAgentService";
import { statistikEtiket } from "../services/tedNoticeService";
import { formatDkkMio, formatPercent, formatAmount, formatDanishDate } from "../lib/format";
import SourceBadge from "../components/ui/SourceBadge";
import MetricRow from "../components/ui/Metric";

const EKSEMPLER = [
  "CVR 33963556, It-konsulentydelser til Programmet Nyt SIS",
  "Danmarks Tekniske Universitet, It-konsulenter til Programmet Nyt SIS",
  "25511484 toner og blækpatroner"
];

// En tildeling kan være afsluttet UDEN vinder. Står der ingen vindere på en
// can-notice, er det næsten altid en annullering — ikke manglende data. Se
// clos-nw/chan-need i eForms. Det skal siges, ellers læses den tomme
// vinderliste som en fejl i opslaget.
function erSandsynligvisAnnulleret(kandidat) {
  return (
    typeof kandidat.art === "string" &&
    kandidat.art.startsWith("can-") &&
    (!kandidat.vindere || kandidat.vindere.length === 0)
  );
}

function Kandidatkort({ kandidat, valgt, onVaelg }) {
  const annulleret = erSandsynligvisAnnulleret(kandidat);

  return (
    <button
      type="button"
      className={`udbud-kort${valgt ? " udbud-kort--valgt" : ""}`}
      onClick={() => onVaelg(kandidat)}
      aria-pressed={valgt}
    >
      <div className="row space-between">
        <span className="chip chip-info">{artEtiket(kandidat.art)}</span>
        <span className="small muted mono">{kandidat.publikationsnummer}</span>
      </div>

      <strong className="kandidat-titel">{kandidat.titel || "Uden titel"}</strong>

      <div className="small muted">
        {kandidat.ordregiver || "Ordregiver ukendt"}
        {kandidat.dato ? ` · ${formatDanishDate(kandidat.dato)}` : ""}
      </div>

      <div className="tag-row">
        {annulleret ? (
          <span className="chip chip-warn">Afsluttet uden vinder</span>
        ) : kandidat.vindere?.length ? (
          <span className="chip chip-ok">
            {kandidat.vindere.length === 1
              ? kandidat.vindere[0]
              : `${kandidat.vindere.length} vindere`}
          </span>
        ) : null}
        {kandidat.vaerdi != null && (
          <span className="chip">{formatAmount(kandidat.vaerdi, kandidat.valuta)}</span>
        )}
      </div>
    </button>
  );
}

function Leverandoerkort({ navn, leverandoer }) {
  const f = leverandoer?.financials;

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <p className="eyebrow">Leverandør</p>
          <h3>{navn}</h3>
        </div>
        <SourceBadge source="cvr" />
      </div>

      {!leverandoer?.cvr && (
        <p className="muted small">
          Ingen dansk CVR-registrering fundet for dette navn. Det er normalt for udenlandske
          leverandører — og det betyder, at nøgletallene nedenfor ikke kan hentes.
        </p>
      )}

      {leverandoer?.cvr && (
        <>
          <MetricRow label="CVR-nummer" value={leverandoer.cvr} />
          {f?.status === "ok" ? (
            <>
              <MetricRow
                label={f.toplineLabel || "Omsætning/bruttofortjeneste"}
                value={formatDkkMio(f.topline)}
              />
              <MetricRow label="Årets resultat" value={formatDkkMio(f.result)} />
              <MetricRow label="Egenkapital" value={formatDkkMio(f.equity)} />
              <MetricRow label="Soliditetsgrad" value={formatPercent(f.solvencyPct)} />
              <div className="card-foot">
                <span className="small muted">
                  Seneste regnskab: {f.fiscalYearEnd?.slice(0, 4) || "–"}
                </span>
                {f.sourceUrl && (
                  <a className="link-knap" href={f.sourceUrl} target="_blank" rel="noreferrer">
                    Se årsrapporten
                  </a>
                )}
              </div>
            </>
          ) : (
            <p className="muted small">
              {f?.status === "facts_unavailable"
                ? "Årsrapporten findes, men uden maskinlæsbare nøgletal (ingen XBRL)."
                : "Intet regnskab fundet for dette CVR-nummer."}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Kontraktkort({ kandidat, detalje, krav }) {
  const annulleret = erSandsynligvisAnnulleret(kandidat);
  // companyAwards er de delkontrakter, DENNE leverandør vandt, med rigtig
  // værdi hver især — det er dem, der må tilskrives virksomheden. Notice'ens
  // total-value er rammens fælles loft og siger intet om den enkelte vinder,
  // når der er flere.
  const egneTildelinger = detalje?.companyAwards ?? [];
  const periode = detalje?.periode ?? null;
  const bud = detalje?.bud ?? null;

  // Alle andre statistik-koder end "tenders", uden dubletter på tværs af
  // delkontrakter — de samme koder går igen pr. lot med samme tal.
  const andreBudtal = [];
  const setKoder = new Set();
  for (const lot of bud?.perLot ?? []) {
    for (const t of lot.tal) {
      if (t.kode === "tenders" || setKoder.has(t.kode)) continue;
      setKoder.add(t.kode);
      andreBudtal.push(t);
    }
  }

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <p className="eyebrow">{artEtiket(kandidat.art)}</p>
          <h3>{detalje?.title || krav?.title || kandidat.titel}</h3>
        </div>
        <SourceBadge source="ted" label="TED · eForms-XML" />
      </div>

      {annulleret && (
        <p className="verdict verdict--warn">
          Denne tildeling er afsluttet <strong>uden vinder</strong> — udbuddet blev annulleret.
          Begrundelsen står i selve bekendtgørelsen.
        </p>
      )}

      <div className="marked-noegletal">
        <MetricRow label="Publikationsnummer" value={kandidat.publikationsnummer} />
        <MetricRow
          label="Offentliggjort"
          value={kandidat.dato ? formatDanishDate(kandidat.dato) : "–"}
        />
        <MetricRow
          label="Samlet værdi"
          value={kandidat.vaerdi != null ? formatAmount(kandidat.vaerdi, kandidat.valuta) : "–"}
        />

        {/* Løbetid og udløb holdes adskilt, fordi kilden holder dem adskilt:
            en varighed på "4 år" siger intet om hvornår den løber fra, og de
            fleste bekendtgørelser oplyser kun det ene. At regne en slutdato ud
            af publiceringsdatoen ville være et gæt sat op som en dato. */}
        {periode?.varierer ? (
          <MetricRow label="Løbetid" value="Varierer pr. delkontrakt" />
        ) : (
          <>
            {periode?.varighed && <MetricRow label="Løbetid" value={periode.varighed.tekst} />}
            {periode?.start && (
              <MetricRow label="Træder i kraft" value={formatDanishDate(periode.start)} />
            )}
            {periode?.slut && <MetricRow label="Udløber" value={formatDanishDate(periode.slut)} />}
            {!periode && <MetricRow label="Løbetid" value="Ikke oplyst" />}
          </>
        )}

        {/* Kun koden "tenders" må vises som totalen. Summen af
            størrelsesopdelingen ville være forkert: kategorierne overlapper,
            og opdelingen kan være delvis. */}
        {bud?.tendersIalt != null ? (
          <MetricRow label="Antal bud" value={bud.tendersIalt} />
        ) : (
          <MetricRow label="Antal bud" value="Ikke oplyst" />
        )}
      </div>

      {/* Står totalen ikke i bekendtgørelsen, men en opdeling gør, vises
          opdelingen for sig — den er stadig et svar, bare ikke på "hvor mange
          bød". */}
      {bud?.tendersIalt == null && andreBudtal.length > 0 && (
        <p className="small muted">
          Bekendtgørelsen oplyser ikke det samlede antal bud, men:{" "}
          {andreBudtal.map((t) => `${statistikEtiket(t.kode).toLowerCase()} ${t.antal}`).join(", ")}.
        </p>
      )}

      {kandidat.ordregiverCvr?.length > 1 && (
        <p className="small muted">
          Fællesudbud med {kandidat.ordregiverCvr.length} ordregivere:{" "}
          {kandidat.ordregiver}
        </p>
      )}

      {(detalje?.description || krav?.description) && (
        <>
          <h4>Beskrivelse</h4>
          <p className="kravtekst">{detalje?.description || krav?.description}</p>
        </>
      )}

      {egneTildelinger.length > 0 && (
        <>
          <h4>Hvad denne leverandør fik tildelt</h4>
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Delkontrakt</th>
                  <th className="align-right">Værdi</th>
                  <th>Tildelt</th>
                </tr>
              </thead>
              <tbody>
                {egneTildelinger.map((a, i) => (
                  <tr key={a.tenderId ?? i}>
                    <td>{a.lotTitle || a.lotId || "–"}</td>
                    <td className="align-right num">
                      {a.value != null ? formatAmount(a.value, a.currency) : "–"}
                    </td>
                    <td>{a.awardDate ? formatDanishDate(a.awardDate) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {krav?.lots?.length > 1 && (
        <>
          <h4>Delkontrakter ({krav.lots.length})</h4>
          <div className="kode-liste">
            {krav.lots.map((lot) => (
              <div key={lot.id} className="subcard">
                <strong>{lot.title || lot.id}</strong>
                {lot.periode?.varighed && (
                  <p className="small muted">Løbetid: {lot.periode.varighed.tekst}</p>
                )}
                {lot.description && <p className="small muted">{lot.description}</p>}
                {lot.cpvCodes?.length > 0 && (
                  <div className="tag-row">
                    {lot.cpvCodes.slice(0, 6).map((k) => (
                      <span key={k} className="tag tag--code">{k}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {krav?.criteria?.length > 0 && (
        <>
          <h4>Egnethedskrav</h4>
          <p className="small muted">
            Ordregiverens egen, ukommenterede tekst. Der findes ikke et struktureret talfelt
            bag kravene, så de er ikke vurderet op imod leverandørens nøgletal.
          </p>
          <div className="krav-liste">
            {krav.criteria.map((c, i) => (
              <p key={i} className="kravtekst">{c.description}</p>
            ))}
          </div>
        </>
      )}

      <div className="card-foot">
        {kandidat.url && (
          <a className="link-knap" href={kandidat.url} target="_blank" rel="noreferrer">
            Åbn bekendtgørelsen i TED
          </a>
        )}
      </div>
    </section>
  );
}

export default function KontraktAgentPage() {
  const [besked, setBesked] = useState("");
  const [samtale, setSamtale] = useState([]);
  const [arbejder, setArbejder] = useState(false);
  const [fejl, setFejl] = useState(null);

  const [valgt, setValgt] = useState(null);
  const [detalje, setDetalje] = useState(null);
  const [henterDetalje, setHenterDetalje] = useState(false);

  const bundRef = useRef(null);

  useEffect(() => {
    bundRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [samtale, henterDetalje]);

  async function send(tekst) {
    const t = (tekst ?? besked).trim();
    if (!t || arbejder) return;

    setBesked("");
    setFejl(null);
    setValgt(null);
    setDetalje(null);
    setSamtale((s) => [...s, { rolle: "bruger", tekst: t }]);
    setArbejder(true);

    try {
      const svar = await spoergAgent(t);
      setSamtale((s) => [...s, { rolle: "agent", svar }]);

      // Er der præcis ét klart træf, foldes det ud med det samme — at tvinge
      // et klik på en liste med én ting er spildt arbejde for brugeren.
      if (svar.kandidater?.length === 1) {
        vaelg(svar.kandidater[0]);
      }
    } catch (e) {
      setFejl(e.message);
    } finally {
      setArbejder(false);
    }
  }

  async function vaelg(kandidat) {
    setValgt(kandidat);
    setDetalje(null);
    setHenterDetalje(true);
    try {
      setDetalje(await hentKontrakt(kandidat));
    } catch (e) {
      setFejl(e.message);
    } finally {
      setHenterDetalje(false);
    }
  }

  const leverandoerNavn = valgt?.vindere?.[0] ?? null;

  return (
    <div className="page">
      <header className="section-header">
        <div>
          <p className="eyebrow">Kontraktopslag</p>
          <h2>Find en kontrakt i TED</h2>
          <p className="lede">
            Skriv et CVR-nummer og et kontraktnavn — gerne i fri tekst. Agenten læser din
            besked og slår op i TED; alle tal og navne på siden kommer fra TED og CVR, ikke
            fra sprogmodellen.
          </p>
        </div>
      </header>

      <div className="console">
        <div className="console-bay">
          {samtale.length === 0 && (
            <div className="empty-state">
              <p>Prøv for eksempel:</p>
              <div className="button-row">
                {EKSEMPLER.map((e) => (
                  <button key={e} type="button" className="btn btn-ghost btn-sm" onClick={() => send(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          {samtale.map((m, i) =>
            m.rolle === "bruger" ? (
              <p key={i} className="samtale samtale--bruger">{m.tekst}</p>
            ) : (
              <div key={i} className="samtale samtale--agent">
                <p className="small">{m.svar.fortolkning?.kommentar}</p>

                <div className="tag-row">
                  {m.svar.fortolkning?.cvr && (
                    <span className="tag tag--traf">CVR {m.svar.fortolkning.cvr}</span>
                  )}
                  {m.svar.fortolkning?.kontraktnavn && (
                    <span className="tag">« {m.svar.fortolkning.kontraktnavn} »</span>
                  )}
                  {m.svar.fortolkning?.ordregiver && (
                    <span className="tag">{m.svar.fortolkning.ordregiver}</span>
                  )}
                  {m.svar.fortolkning?.aar && <span className="tag">{m.svar.fortolkning.aar}</span>}
                </div>

                {m.svar.mangler ? (
                  <p className="verdict verdict--warn">{m.svar.mangler}</p>
                ) : (
                  <>
                    {/* Nedgraderingen står FØR listen, ikke under den: læses den
                        først bagefter, har brugeren allerede taget resultatet
                        for et fuldtræf. */}
                    {m.svar.nedgradering && (
                      <p className="verdict verdict--warn">{m.svar.nedgradering}</p>
                    )}
                    <p className="small muted">
                      {m.svar.kandidater.length === 1
                        ? "Ét træf:"
                        : `${m.svar.kandidater.length} mulige kontrakter — vælg den rigtige:`}
                    </p>
                    <div className="kandidat-liste">
                      {m.svar.kandidater.map((k, ki) => (
                        <Kandidatkort
                          key={k.publikationsnummer ?? `kandidat-${ki}`}
                          kandidat={k}
                          valgt={valgt?.publikationsnummer === k.publikationsnummer}
                          onVaelg={vaelg}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )
          )}

          {arbejder && <p className="working">Læser din besked og søger i TED …</p>}
          {fejl && <p className="verdict verdict--alert">{fejl}</p>}
          <div ref={bundRef} />
        </div>

        <form
          className="soeg-linje"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            className="input"
            value={besked}
            onChange={(e) => setBesked(e.target.value)}
            placeholder="fx: CVR 33963556, It-konsulentydelser til Programmet Nyt SIS"
            aria-label="Din besked til agenten"
            disabled={arbejder}
          />
          <button className="btn btn-primary" type="submit" disabled={arbejder || !besked.trim()}>
            Slå op
          </button>
        </form>
      </div>

      {henterDetalje && <p className="working">Henter kontraktens eForms-XML og leverandørens regnskab …</p>}

      {valgt && detalje && (
        <div className="two-one">
          <Kontraktkort kandidat={valgt} detalje={detalje.detalje} krav={detalje.krav} />
          {leverandoerNavn ? (
            <Leverandoerkort navn={leverandoerNavn} leverandoer={detalje.leverandoer} />
          ) : (
            <section className="card">
              <p className="eyebrow">Leverandør</p>
              <p className="muted small">
                Bekendtgørelsen har ingen navngiven vinder, så der er ingen leverandør at slå op.
              </p>
            </section>
          )}
        </div>
      )}

      {detalje?.fejl?.length > 0 && (
        <p className="small muted">
          Delvist hentet — {detalje.fejl.join(" · ")}
        </p>
      )}
    </div>
  );
}
