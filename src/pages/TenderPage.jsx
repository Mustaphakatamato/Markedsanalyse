import { useEffect, useState } from "react";
import { useProjects } from "../context/ProjectsContext";
import {
  hentMarkedsstatistik,
  soegMarked,
  hentVindere,
  beregnKoncentration
} from "../services/markedService";
import { searchByCPV } from "../services/tedService";
import CpvVaelger from "../components/marked/CpvVaelger";
import BrancheVaelger from "../components/marked/BrancheVaelger";
import Markedsbillede from "../components/marked/Markedsbillede";
import Kandidatliste from "../components/marked/Kandidatliste";
import Vinderliste from "../components/marked/Vinderliste";
import Icon from "../components/ui/Icon";
import SourceBadge from "../components/ui/SourceBadge";
import StatusChip from "../components/ui/StatusChip";
import { SkeletonRows } from "../components/ui/Loading";
import { formatDkkMio, formatDanishDate, formatAmount } from "../lib/format";

// Udbud & markedsanalyse — ordregiverens flow før et udbud.
//
// Rækkefølgen følger den faktiske arbejdsgang: hvad skal købes (CPV) → hvilket
// marked er det (brancher) → hvor stort og hvordan ser det ud → hvem kan
// inviteres til dialog → dokumentation.
//
// Det er bevidst IKKE en trinvis guide, der låser rækkefølgen. En
// markedsanalyse laves ikke i ét stræk: man vender tilbage, retter
// branchekoder når markedsbilledet ser forkert ud, og udvider shortlisten
// efter en samtale. Derfor er alle sektioner åbne hele tiden, og udbuddet
// gemmes ved hver ændring.

function tolkVaerdi(tekst) {
  const rent = String(tekst ?? "").replace(/\./g, "").replace(",", ".").trim();
  if (!rent) return null;
  const n = Number(rent.match(/-?\d+(\.\d+)?/)?.[0]);
  if (!Number.isFinite(n)) return null;
  if (/mia|milliard/i.test(tekst)) return Math.round(n * 1_000_000_000);
  if (/mio|million/i.test(tekst)) return Math.round(n * 1_000_000);
  return Math.round(n);
}

function OpretForm({ onOpret, onFortryd }) {
  const [titel, setTitel] = useState("");
  const [beskrivelse, setBeskrivelse] = useState("");
  const [cpvKoder, setCpvKoder] = useState([]);
  const [vaerdi, setVaerdi] = useState("");
  const [deadline, setDeadline] = useState("");

  const kanOprette = titel.trim().length > 0 && cpvKoder.length > 0;

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h3>Nyt udbud</h3>
          <p className="muted small">
            Titel og mindst én CPV-kode er nok til at komme i gang. Alt kan rettes bagefter.
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="field">
          <label htmlFor="udbud-titel">Titel</label>
          <input
            id="udbud-titel"
            className="input"
            placeholder="Fx Drift og vedligehold af kommunens IT-arbejdspladser"
            value={titel}
            onChange={(e) => setTitel(e.target.value)}
          />
        </div>

        <CpvVaelger valgte={cpvKoder} onAendret={setCpvKoder} />

        <div className="grid two-col">
          <div className="field">
            <label htmlFor="udbud-vaerdi">Anslået værdi (valgfri)</label>
            <input
              id="udbud-vaerdi"
              className="input"
              placeholder="Fx 25 mio."
              value={vaerdi}
              onChange={(e) => setVaerdi(e.target.value)}
            />
            <p className="muted small" style={{ margin: "6px 0 0" }}>
              {tolkVaerdi(vaerdi) != null
                ? `Tolkes som ${formatAmount(tolkVaerdi(vaerdi))} kr.`
                : "Skriv fx “25 mio.” eller “25000000”."}
            </p>
          </div>

          <div className="field">
            <label htmlFor="udbud-deadline">Forventet udbudsdato (valgfri)</label>
            <input
              id="udbud-deadline"
              className="input"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="udbud-beskrivelse">Beskrivelse (valgfri)</label>
          <textarea
            id="udbud-beskrivelse"
            className="input"
            rows={3}
            placeholder="Hvad skal anskaffes, og hvad er formålet?"
            value={beskrivelse}
            onChange={(e) => setBeskrivelse(e.target.value)}
          />
        </div>

        <div className="button-row">
          <button
            className="btn btn-primary"
            disabled={!kanOprette}
            onClick={() =>
              onOpret({
                titel,
                beskrivelse,
                cpvKoder,
                anslaaetVaerdi: tolkVaerdi(vaerdi),
                deadline
              })
            }
          >
            <Icon name="plus" size={14} />
            Opret udbud
          </button>
          <button className="btn btn-ghost" onClick={onFortryd}>
            Fortryd
          </button>
          {!kanOprette && (
            <span className="muted small">Titel og mindst én CPV-kode mangler.</span>
          )}
        </div>
      </div>
    </section>
  );
}

function Analyse({ udbud, opdater, skiftShortliste, onGoToCompany, onTilbage, onSlet }) {
  const [statistik, setStatistik] = useState(null);
  const [statistikStatus, setStatistikStatus] = useState("idle");
  const [statistikFejl, setStatistikFejl] = useState(null);

  const [kandidater, setKandidater] = useState([]);
  const [kandidatStatus, setKandidatStatus] = useState("idle");
  const [kandidatFejl, setKandidatFejl] = useState(null);

  const [tedNotices, setTedNotices] = useState([]);
  const [tedStatus, setTedStatus] = useState("idle");

  // Størrelsesafgrænsningen ligger her og ikke i Kandidatlisten, fordi den
  // udløser et nyt databaseopslag: de store udgør nogle få procent af et
  // marked, så et filter anvendt på 200 allerede hentede rækker ville filtrere
  // de forkerte 200. Standard er "alle" — listen er rangeret efter størrelse,
  // så de store ligger øverst uden at markedets små skjules. Netop deres antal
  // er grundlaget for "opdel eller forklar".
  const [stoerrelsesfilter, setStoerrelsesfilter] = useState("alle");
  const [sortering, setSortering] = useState("stoerrelse");

  // Hvor kandidaterne kommer fra: hele markedet (CVR) eller dem der har
  // vundet før (TED). Standard er CVR, fordi det er den eneste liste, der
  // viser markedets sammensætning — og dermed den eneste, der kan bære
  // "opdel eller forklar". Vinderlisten er skarpere på kapacitet, men blind
  // for alt under EU's tærskelværdi, og må derfor ikke være det, man ser
  // uden at have valgt det.
  const [kilde, setKilde] = useState("cvr");

  const [vindere, setVindere] = useState([]);
  const [vindereKilde, setVindereKilde] = useState(null);
  const [vindereStatus, setVindereStatus] = useState("idle");
  const [vindereFejl, setVindereFejl] = useState(null);

  const [redigerer, setRedigerer] = useState(false);
  // Tælles op af "Prøv igen". Uden den ville et gentaget forsøg ikke ændre
  // noget, effekten afhænger af — branchekoderne er de samme — og knappen
  // ville se ud som om den virkede uden at gøre noget.
  const [forsoeg, setForsoeg] = useState(0);

  const branchekoder = udbud.branchekoder.map((b) => b.kode);
  const branchenoegle = branchekoder.join(",");
  const kommunenoegle = udbud.kommunekoder.join(",");

  // Markedsbilledet afhænger kun af branchekoderne og geografien — ikke af
  // størrelsesfilteret. Det er hele pointen: fordelingen skal blive stående
  // som markedets sande sammensætning, mens man skruer på kandidatlisten.
  // Ellers ville "kun store" få markedet til at se ud som om det bestod af
  // store virksomheder.
  //
  // cancelled-flaget beskytter mod at et langsomt svar fra et tidligere sæt
  // koder overskriver et nyere — brugeren retter ofte koderne flere gange.
  useEffect(() => {
    if (!branchekoder.length) {
      setStatistik(null);
      setStatistikStatus("idle");
      return;
    }

    let annulleret = false;
    setStatistikStatus("henter");

    hentMarkedsstatistik(branchekoder, { kommunekoder: udbud.kommunekoder })
      .then((data) => {
        if (annulleret) return;
        setStatistik(data);
        setStatistikStatus("faerdig");
      })
      .catch((err) => {
        if (annulleret) return;
        setStatistikFejl(err.message || "Kunne ikke hente markedsbilledet.");
        setStatistikStatus("fejl");
      });

    return () => {
      annulleret = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchenoegle, kommunenoegle, forsoeg]);

  // Kandidaterne hentes forfra, når størrelsesafgrænsningen ændrer sig.
  // Alternativet — at filtrere de hentede 200 — ser billigere ud, men er
  // forkert: de store udgør få procent af et marked, så de 200 vilkårlige
  // rækker rummer dem næsten ikke. Afgrænsningen skal ske dér, hvor hele
  // markedet er, altså i databasen.
  useEffect(() => {
    if (!branchekoder.length) {
      setKandidater([]);
      setKandidatStatus("idle");
      return;
    }

    let annulleret = false;
    setKandidatStatus("henter");

    soegMarked(branchekoder, {
      kommunekoder: udbud.kommunekoder,
      maks: 200,
      mindstKlasse: stoerrelsesfilter === "alle" ? null : stoerrelsesfilter,
      sortering
    })
      .then((data) => {
        if (annulleret) return;
        setKandidater(data);
        setKandidatStatus("faerdig");
      })
      .catch((err) => {
        if (annulleret) return;
        setKandidatFejl(err.message || "Kunne ikke hente kandidater.");
        setKandidatStatus("fejl");
      });

    return () => {
      annulleret = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchenoegle, kommunenoegle, forsoeg, stoerrelsesfilter, sortering]);

  // Vinderoptællingen hentes først når brugeren faktisk vælger kilden. Den
  // koster op til fire TED-kald bag Edge Function'en, og de fleste
  // markedsanalyser bliver aldrig skiftet over — så at hente den på forhånd
  // ville betale prisen hver gang for det, de færreste bruger. Svaret caches
  // et døgn i Postgres, så skiftet frem og tilbage er gratis bagefter.
  //
  // Bemærk at den hænger på CPV-koderne, ikke på branchekoderne: en tildeling
  // er registreret på hvad der blev KØBT, ikke på hvad vinderen laver til
  // daglig.
  useEffect(() => {
    const koder = udbud.cpvKoder.map((c) => c.kode);
    if (kilde !== "vindere" || !koder.length) return;

    let annulleret = false;
    setVindereStatus("henter");
    setVindereFejl(null);

    hentVindere(koder, { top: 25 })
      .then((data) => {
        if (annulleret) return;
        setVindere(data.vindere ?? []);
        setVindereKilde(data.kilde ?? null);
        setVindereStatus("faerdig");
      })
      .catch((err) => {
        if (annulleret) return;
        setVindereFejl(err.message || "Kunne ikke hente vindere.");
        setVindereStatus("fejl");
      });

    return () => {
      annulleret = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kilde, udbud.cpvKoder.map((c) => c.kode).join(","), forsoeg]);

  // Rigtige kontrakttildelinger i CPV-feltet. Beholdt fra den gamle side —
  // det var det eneste panel dér, der byggede på rigtige data.
  useEffect(() => {
    const koder = udbud.cpvKoder.map((c) => c.kode);
    if (!koder.length) return;

    let annulleret = false;
    setTedStatus("henter");
    searchByCPV(koder[0], { limit: 8 })
      .then((data) => {
        if (annulleret) return;
        setTedNotices(data.notices);
        setTedStatus("faerdig");
      })
      .catch(() => !annulleret && setTedStatus("fejl"));

    return () => {
      annulleret = true;
    };
  }, [udbud.cpvKoder.map((c) => c.kode).join(",")]);

  const koncentration = beregnKoncentration(statistik);

  return (
    <>
      <section className="console">
        <div className="console-head">
          <p className="eyebrow">Markedsanalyse</p>
          <h3>{udbud.titel}</h3>
          {udbud.beskrivelse && <p className="lede">{udbud.beskrivelse}</p>}
        </div>

        <div className="console-bay">
          <div className="tag-row">
            {udbud.cpvKoder.map((c) => (
              <span className="tag tag--code" key={c.kode} title={c.tekst || ""}>
                <span className="tag__key">CPV</span>
                {c.kode}
                {c.tekst && <span className="tag__tekst"> {c.tekst}</span>}
              </span>
            ))}
            {udbud.anslaaetVaerdi != null && (
              <span className="tag">{formatDkkMio(udbud.anslaaetVaerdi)}</span>
            )}
            {udbud.deadline && <span className="tag">Udbud {formatDanishDate(udbud.deadline)}</span>}
            {udbud.vaerdiRaa && (
              <span className="tag tag--warn" title="Værdien kunne ikke tolkes som et tal ved opgraderingen">
                Værdi: “{udbud.vaerdiRaa}” — ret den
              </span>
            )}
          </div>

          <div className="button-row no-print" style={{ marginTop: 14 }}>
            <button className="btn btn-ghost btn-sm" onClick={onTilbage}>
              <Icon name="back" size={13} />
              Alle udbud
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setRedigerer((v) => !v)}>
              <Icon name="doc" size={13} />
              {redigerer ? "Luk redigering" : "Redigér grundlag"}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>
              <Icon name="table" size={13} />
              Udskriv som bilag
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onSlet}>
              Slet udbud
            </button>
          </div>

          <div className="card-foot">
            <span className="eyebrow" style={{ margin: 0 }}>
              Kilder
            </span>
            <div className="source-row">
              <SourceBadge source="cvr" label="CVR-register" />
              <SourceBadge source="ted" />
            </div>
          </div>
        </div>
      </section>

      {/* Kandidatlisten er lang af natur — den er et marked. Uden en genvej
          skal man scrolle forbi hele leverandørfeltet for at nå det, der står
          under det. Ankrene gør analysen til et dokument, man kan bladre i,
          frem for en rulle. */}
      {(branchekoder.length > 0 || kilde === "vindere") && (
        <nav className="sektion-nav no-print" aria-label="Spring til afsnit i analysen">
          <a href="#brancher">Brancher</a>
          <a href="#markedsbillede">
            Markedsbillede
            {statistik?.ialt ? (
              <span className="sektion-nav__tal">{statistik.ialt.toLocaleString("da-DK")}</span>
            ) : null}
          </a>
          <a href="#kandidater">
            Kandidater
            {(kilde === "vindere" ? vindere.length : kandidater.length) ? (
              <span className="sektion-nav__tal">
                {kilde === "vindere" ? vindere.length : kandidater.length}
              </span>
            ) : null}
          </a>
          <a href="#tildelinger">
            Tildelinger
            {tedNotices.length ? (
              <span className="sektion-nav__tal">{tedNotices.length}</span>
            ) : null}
          </a>
        </nav>
      )}

      {redigerer && (
        <section className="card no-print">
          <div className="section-header">
            <h3>Udbuddets grundlag</h3>
          </div>
          <div className="stack">
            <div className="field">
              <label htmlFor="rediger-titel">Titel</label>
              <input
                id="rediger-titel"
                className="input"
                value={udbud.titel}
                onChange={(e) => opdater({ titel: e.target.value })}
              />
            </div>
            <CpvVaelger
              valgte={udbud.cpvKoder}
              onAendret={(cpvKoder) => opdater({ cpvKoder })}
            />
            <div className="field">
              <label htmlFor="rediger-vaerdi">Anslået værdi (kr.)</label>
              <input
                id="rediger-vaerdi"
                className="input num"
                inputMode="numeric"
                value={udbud.anslaaetVaerdi ?? ""}
                onChange={(e) =>
                  opdater({
                    anslaaetVaerdi: e.target.value.trim() ? Number(e.target.value.replace(/\D/g, "")) : null,
                    vaerdiRaa: null
                  })
                }
              />
            </div>
          </div>
        </section>
      )}

      <BrancheVaelger
        cpvKoder={udbud.cpvKoder}
        valgte={udbud.branchekoder}
        onAendret={(branchekoder) => opdater({ branchekoder })}
      />

      {!branchekoder.length && kilde !== "vindere" && (
        <section className="empty-state">
          <span className="empty-state__icon">
            <Icon name="scales" size={22} />
          </span>
          <h4>Vælg branchekoder for at se markedet</h4>
          <p className="muted">
            Markedsbilledet og kandidatlisten bygger på de branchekoder, du bekræfter
            ovenfor — ikke på CPV-koden direkte. Der findes ingen officiel oversættelse
            mellem de to, så valget skal være dit.
          </p>
          {/* Vinderlisten hænger på CPV-koden og har derfor ikke brug for
              branchevalget. Genvejen står her, fordi kildeskiftet ellers ville
              være låst inde i en sektion, der ikke vises endnu. */}
          <div className="button-row" style={{ justifyContent: "center" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setKilde("vindere")}>
              Se hvem der har vundet før i stedet
              <Icon name="arrow" size={13} />
            </button>
          </div>
        </section>
      )}

      <Markedsbillede
        statistik={statistik}
        koncentration={koncentration}
        status={statistikStatus === "idle" ? null : statistikStatus}
        fejl={statistikFejl}
        onPrøvIgen={() => setForsoeg((n) => n + 1)}
      />

      {kilde === "vindere" ? (
        <Vinderliste
          vindere={vindere}
          kildeinfo={vindereKilde}
          status={vindereStatus === "idle" ? "henter" : vindereStatus}
          fejl={vindereFejl}
          shortliste={udbud.shortliste}
          kilde={kilde}
          onSkiftKilde={setKilde}
          onSkiftShortliste={skiftShortliste}
          onGoToCompany={onGoToCompany}
          onPrøvIgen={() => setForsoeg((n) => n + 1)}
        />
      ) : (
        <Kandidatliste
          virksomheder={kandidater}
          status={kandidatStatus === "idle" ? null : kandidatStatus}
          fejl={kandidatFejl}
          shortliste={udbud.shortliste}
          stoerrelsesfilter={stoerrelsesfilter}
          onSkiftStoerrelsesfilter={setStoerrelsesfilter}
          sortering={sortering}
          onSkiftSortering={setSortering}
          klassefordeling={koncentration?.antalPrKlasse}
          markedIalt={statistik?.ialt}
          kilde={kilde}
          onSkiftKilde={setKilde}
          onSkiftShortliste={skiftShortliste}
          onGoToCompany={onGoToCompany}
          onPrøvIgen={() => setForsoeg((n) => n + 1)}
        />
      )}

      <section id="tildelinger" className={`card ${tedStatus === "henter" ? "is-working" : ""}`}>
        <div className="section-header">
          <div>
            <h3>Seneste kontrakttildelinger i markedet</h3>
            <p className="muted small">
              Rigtige EU-udbud under {udbud.cpvKoder[0]?.kode}. Viser hvad der faktisk er
              købt, og til hvilke beløb.
            </p>
          </div>
          <SourceBadge source="ted" />
        </div>

        {tedStatus === "henter" && <SkeletonRows rows={4} />}
        {tedStatus === "fejl" && (
          <p className="muted small">Kunne ikke hente kontrakttildelinger fra TED.</p>
        )}
        {tedStatus === "faerdig" && !tedNotices.length && (
          <p className="muted small">
            Ingen tildelinger fundet. TED dækker kun udbud over EU's tærskelværdi.
          </p>
        )}

        {tedNotices.length > 0 && (
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vinder</th>
                  <th>Ordregiver</th>
                  <th>Dato</th>
                  <th style={{ textAlign: "right" }}>Værdi</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tedNotices.map((n) => (
                  <tr key={n.id}>
                    <td>
                      {n.winnerName || "Ukendt vinder"}
                      {n.isMultiWinner && (
                        <span className="pill" style={{ marginLeft: 6 }}>
                          {n.winnerCount} vindere
                        </span>
                      )}
                    </td>
                    <td className="muted">{n.buyerName || "–"}</td>
                    <td className="num">{formatDanishDate(n.date)}</td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {n.value != null && !n.isMultiWinner
                        ? `${formatAmount(n.value)} ${n.currency || ""}`
                        : n.isMultiWinner
                          ? "rammeaftale"
                          : "–"}
                    </td>
                    <td>
                      {n.url && (
                        <a href={n.url} target="_blank" rel="noreferrer" className="small">
                          Notice <Icon name="external" size={11} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ul className="trace" style={{ marginTop: 12 }}>
          <li>
            For rammeaftaler med flere vindere vises intet beløb: notice'ens værdi er
            rammens samlede loft, ikke hvad den enkelte vinder fik.
          </li>
        </ul>
      </section>
    </>
  );
}

export default function TenderPage({ onGoToCompany }) {
  const { udbud, gemtFejl, opretUdbud, opdaterUdbud, sletUdbud, skiftShortliste } = useProjects();
  const [tilstand, setTilstand] = useState("liste");
  const [valgtId, setValgtId] = useState(null);

  const valgt = udbud.find((u) => u.id === valgtId) || null;

  if (valgt) {
    return (
      <main className="page">
        {gemtFejl && (
          <div className="verdict verdict--alert no-print">
            <span className="verdict__icon">
              <Icon name="alert" size={18} />
            </span>
            <div className="verdict__body">
              <p className="verdict__label">Ikke gemt</p>
              <p className="verdict__value">{gemtFejl}</p>
            </div>
          </div>
        )}
        <Analyse
          udbud={valgt}
          opdater={(aendringer) => opdaterUdbud(valgt.id, aendringer)}
          skiftShortliste={(cvr) => skiftShortliste(valgt.id, cvr)}
          onGoToCompany={onGoToCompany}
          onTilbage={() => setValgtId(null)}
          onSlet={() => {
            sletUdbud(valgt.id);
            setValgtId(null);
          }}
        />
      </main>
    );
  }

  return (
    <main className="page">
      <section className="console">
        <div className="console-head">
          <p className="eyebrow">Markedsbillede</p>
          <h3>Udbud &amp; markedsanalyse</h3>
          <p className="lede">
            Afdæk leverandørmarkedet før et udbud. Fra CPV-kode til de brancher markedet
            reelt består af, hvor stort det er, og hvem der kan inviteres til
            markedsdialog — bygget på hele CVR-registret, ikke kun på dem der har vundet
            et EU-udbud før.
          </p>
        </div>

        <div className="console-bay">
          <div className="button-row">
            <button
              className="btn btn-primary"
              onClick={() => setTilstand(tilstand === "opret" ? "liste" : "opret")}
            >
              <Icon name="plus" size={14} />
              Opret nyt udbud
            </button>
          </div>

          <div className="card-foot">
            <span className="eyebrow" style={{ margin: 0 }}>
              Kilder
            </span>
            <div className="source-row">
              <SourceBadge source="cvr" label="CVR-register" />
              <SourceBadge source="ted" />
            </div>
          </div>
        </div>
      </section>

      {tilstand === "opret" && (
        <OpretForm
          onFortryd={() => setTilstand("liste")}
          onOpret={(felter) => {
            const nyt = opretUdbud(felter);
            setTilstand("liste");
            setValgtId(nyt.id);
          }}
        />
      )}

      {!udbud.length && tilstand !== "opret" && (
        <section className="empty-state">
          <span className="empty-state__icon">
            <Icon name="inbox" size={22} />
          </span>
          <h4>Ingen udbud endnu</h4>
          <p className="muted">
            Opret et udbud med en CPV-kode, så finder vi markedet bag den.
          </p>
        </section>
      )}

      {udbud.length > 0 && (
        <section className="grid two-col">
          {udbud.map((u) => (
            <article className="card udbud-kort" key={u.id}>
              <div className="space-between">
                <h3 style={{ margin: 0 }}>{u.titel}</h3>
                {u.shortliste.length > 0 && (
                  <StatusChip tone="ok" icon="check">
                    {u.shortliste.length} på shortliste
                  </StatusChip>
                )}
              </div>

              {u.beskrivelse && <p className="muted small">{u.beskrivelse}</p>}

              <div className="tag-row">
                {u.cpvKoder.slice(0, 3).map((c) => (
                  <span className="tag tag--code" key={c.kode}>
                    {c.kode}
                  </span>
                ))}
                {u.cpvKoder.length > 3 && (
                  <span className="tag">+{u.cpvKoder.length - 3}</span>
                )}
                {u.branchekoder.length > 0 && (
                  <span className="tag">{u.branchekoder.length} brancher valgt</span>
                )}
              </div>

              <div className="button-row">
                <button className="btn btn-secondary btn-sm" onClick={() => setValgtId(u.id)}>
                  Åbn markedsanalyse
                  <Icon name="arrow" size={13} />
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
