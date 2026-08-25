import { useEffect, useMemo, useState } from "react";
import { soegUdbud, ARTER, KILDER, dageSiden } from "../services/udbudService";
import {
  MIT_FELT_KODER,
  ADVARSEL_PR_KODE,
  OVERVAAGEDE_FELTER,
  OVERVAAGEDE_KODER,
  VINDUER,
  STANDARD_VINDUE
} from "../data/cpvOvervaagning";
import { cpvPraefiks } from "../lib/cpv";
import CpvVaelger from "../components/marked/CpvVaelger";
import UdbudKort from "../components/marked/UdbudKort";
import Icon from "../components/ui/Icon";
import SourceBadge from "../components/ui/SourceBadge";
import StatusChip from "../components/ui/StatusChip";
import { Working, SkeletonRows } from "../components/ui/Loading";
import { formatDanishDate } from "../lib/format";

// Søg i alle bekendtgørelser på udbud.dk og filtrér på CPV.
//
// HVEM SIDEN ER TIL: en tilbudsgiver, der leder efter opgaver. De to øvrige
// flows researcher markedet FOR en ordregiver; dette er det modsatte, og
// indgangen er derfor "hvad kan vi byde på", ikke "hvem kan levere".
//
// HVORFOR CPV ER DET PRIMÆRE FILTER: en virksomhed leverer inden for et
// afgrænset felt, og feltet ER CPV-koder. Fritekst finder de udbud, der
// tilfældigvis bruger ens egne ord; CPV finder dem, ordregiveren har
// klassificeret som ens felt — også når titlen hedder noget helt andet.
//
// CPV-VALGET ER HIERARKISK. Vælger man 72000000 (It-tjenester), kommer alt
// under den med, fordi konkrete udbud altid er kodet dybere. Uden det ville
// et valg på en overordnet kode ramme ingenting — se cpv_praefiks() i
// migrationen.
//
// OVERVÅGNINGEN BOR HER NU. "Nye udbud i mit felt" var en selvstændig side,
// men den læste samme tabel gennem samme soeg_udbud() og viste samme
// UdbudKort som denne side. Forskellen var to ting: at CPV-koderne var
// fastlagt på forhånd, og at der var et tidsvindue på registreringen. Begge
// er nu kontroller her — feltet som et GEMT FILTER, vinduet som et filter ved
// siden af de øvrige. Det, der gik tabt ved flytningen, var 60 linjer CSS til
// et sæt feltknapper, der gjorde det samme som CPV-vælgeren kunne i forvejen.
//
// TO TING FRA OVERVÅGNINGEN SKAL OVERLEVE, ellers er sammenlægningen et tab:
//
//   1. Nul valg for at komme i gang. Filtrene gemmes i localStorage, så den
//      der forlod siden på "Nyt i mit felt" lander dér igen — uden et klik,
//      ligesom den gamle side gav via sit eget menupunkt.
//   2. Forskellen mellem "ro på markedet" og "synken er gået i stå". Et
//      tidsvindue gør et tomt svar tvetydigt, og derfor står indeksets alder
//      øverst, når et vindue er aktivt — ikke søgningens, men tabellens.

const SIDESTOERRELSE = 25;

// Synken kører dagligt. Er det nyeste vi har over to døgn gammelt, er det ikke
// en stille dag hos udbud.dk — så er der noget i vejen med synken.
const STALE_DAGE = 2;

// Samme "markedsanalyse.*"-nøglemønster som ThemeToggle/App.jsx. Fritekst
// gemmes IKKE: et filter er en indstilling, man vender tilbage til, mens en
// søgetekst er et spørgsmål, man stillede én gang — og en genopstået søgetekst
// ligner en tom database, hvis man har glemt at man skrev den.
const FILTER_STORAGE_KEY = "markedsanalyse.udbudsfiltre";

// De gemte filtre. Et gemt filter sætter ALLE felter, det nævner — også dem
// det sætter til standardværdien. Ellers ville et klik give forskellige
// resultater afhængigt af hvad der stod i felterne før, og så er det ikke et
// gemt filter.
const GEMTE_FILTRE = [
  {
    id: "nyt-i-mit-felt",
    etiket: "Nyt i mit felt",
    beskrivelse: `Registreret de sidste ${STANDARD_VINDUE} dage inden for husets CPV-felter`,
    filtre: {
      cpvKoder: MIT_FELT_KODER,
      kilder: [],
      arter: ["udbud"],
      kunAabne: false,
      sortering: "nyeste",
      dage: STANDARD_VINDUE
    }
  },
  {
    id: "alt-i-mit-felt",
    etiket: "Alt i mit felt",
    beskrivelse: "Alle åbne udbud i husets CPV-felter, nærmeste frist først",
    filtre: {
      cpvKoder: MIT_FELT_KODER,
      kilder: [],
      arter: ["udbud"],
      kunAabne: true,
      sortering: "frist",
      dage: null
    }
  }
];

const STANDARDFILTRE = {
  cpvKoder: [],
  kilder: [],
  arter: ["udbud"],
  kunAabne: true,
  sortering: "frist",
  dage: null
};

// Signaturen afgør hvilket gemt filter der står som aktivt. Den sammenligner
// de felter, filtrene sætter — ikke fritekst og ikke sidenummer, som ikke er
// en del af filteret.
function filterSignatur({ cpvKoder, kilder, arter, kunAabne, sortering, dage }) {
  return [
    cpvKoder.map((c) => c.kode).sort().join(","),
    [...kilder].sort().join(","),
    [...arter].sort().join(","),
    kunAabne,
    sortering,
    dage ?? "alle"
  ].join("|");
}

function laesGemteFiltre() {
  try {
    const raa = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raa) return STANDARDFILTRE;
    const gemt = JSON.parse(raa);

    // Valideres felt for felt frem for at blive stolet på: nøglen kan være
    // skrevet af en ældre udgave af siden, og et ugyldigt filter ville her
    // give en tom liste, der ligner et svar.
    const koder = Array.isArray(gemt.cpvKoder)
      ? gemt.cpvKoder.filter((c) => c && typeof c.kode === "string")
      : [];
    const gyldigeArter = ARTER.map((a) => a.vaerdi);
    const gyldigeKilder = KILDER.map((k) => k.vaerdi);

    return {
      cpvKoder: koder,
      kilder: Array.isArray(gemt.kilder) ? gemt.kilder.filter((k) => gyldigeKilder.includes(k)) : [],
      arter: Array.isArray(gemt.arter) ? gemt.arter.filter((a) => gyldigeArter.includes(a)) : [],
      kunAabne: gemt.kunAabne === true,
      sortering: ["frist", "nyeste", "vaerdi"].includes(gemt.sortering) ? gemt.sortering : "frist",
      dage: VINDUER.some((v) => v.dage === gemt.dage) ? gemt.dage : null
    };
  } catch {
    return STANDARDFILTRE;
  }
}

// Grupperet på registreringsdag, fordi det er den akse listen læses i, når
// man sorterer på nyeste: "kom der noget i dag" er spørgsmålet, ikke "hvad er
// nummer 14 på listen".
function grupperPrDag(udbud) {
  const grupper = [];
  for (const u of udbud) {
    const dage = dageSiden(u.registreret);
    const etiket =
      dage === 0 ? "I dag" : dage === 1 ? "I går" : formatDanishDate(u.registreret) || "Uden dato";
    const sidste = grupper[grupper.length - 1];
    if (sidste?.etiket === etiket) sidste.poster.push(u);
    else grupper.push({ etiket, poster: [u] });
  }
  return grupper;
}

export default function UdbudssoegningPage() {
  const [start] = useState(laesGemteFiltre);
  const [soegetekst, setSoegetekst] = useState("");
  const [cpvKoder, setCpvKoder] = useState(start.cpvKoder);
  const [kilder, setKilder] = useState(start.kilder);
  const [arter, setArter] = useState(start.arter);
  const [kunAabne, setKunAabne] = useState(start.kunAabne);
  const [sortering, setSortering] = useState(start.sortering);
  const [dage, setDage] = useState(start.dage);
  const [side, setSide] = useState(0);
  const [visFeltkoder, setVisFeltkoder] = useState(false);

  const [resultat, setResultat] = useState(null);
  const [status, setStatus] = useState("idle");
  const [fejl, setFejl] = useState(null);

  // Søgeteksten sendes ikke ved hvert tastetryk — men CPV, filtre og
  // sortering slår igennem med det samme, fordi de er valg og ikke skrivning.
  const [aktivTekst, setAktivTekst] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAktivTekst(soegetekst), 300);
    return () => clearTimeout(timer);
  }, [soegetekst]);

  const cpvNoegle = cpvKoder.map((c) => c.kode).join(",");
  const filterNoegle = `${aktivTekst}|${cpvNoegle}|${kilder.join(",")}|${arter.join(",")}|${kunAabne}|${sortering}|${dage ?? "alle"}`;

  const anvendFiltre = (filtre) => {
    setCpvKoder(filtre.cpvKoder);
    setKilder(filtre.kilder);
    setArter(filtre.arter);
    setKunAabne(filtre.kunAabne);
    setSortering(filtre.sortering);
    setDage(filtre.dage);
    setSoegetekst("");
  };

  useEffect(() => {
    try {
      localStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify({ cpvKoder, kilder, arter, kunAabne, sortering, dage })
      );
    } catch {
      /* private mode — filtrene holder bare kun sessionen ud */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpvNoegle, kilder, arter, kunAabne, sortering, dage]);

  // Et skift i filtrene skal altid føre tilbage til første side. Uden dette
  // lander man på side 4 af et resultat, der måske kun har én.
  useEffect(() => {
    setSide(0);
  }, [filterNoegle]);

  useEffect(() => {
    let annulleret = false;
    setStatus("henter");

    soegUdbud({
      soegetekst: aktivTekst,
      cpvKoder,
      kilder,
      arter,
      kunAabne,
      sortering,
      dage,
      maks: SIDESTOERRELSE,
      springOver: side * SIDESTOERRELSE
    })
      .then((data) => {
        if (annulleret) return;
        setResultat(data);
        setStatus("faerdig");
      })
      .catch((err) => {
        if (annulleret) return;
        setFejl(err.message || "Søgningen fejlede.");
        setStatus("fejl");
      });

    return () => {
      annulleret = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterNoegle, side]);

  const skiftIListe = (liste, saet, vaerdi) =>
    saet(liste.includes(vaerdi) ? liste.filter((v) => v !== vaerdi) : [...liste, vaerdi]);

  const udbud = resultat?.udbud ?? [];
  const ialt = resultat?.ialt ?? 0;
  const sidsteSide = Math.max(0, Math.ceil(ialt / SIDESTOERRELSE) - 1);

  const harFilter = useMemo(
    () =>
      Boolean(
        aktivTekst.trim() || cpvKoder.length || kilder.length || arter.length !== 1 || !kunAabne || dage
      ),
    [aktivTekst, cpvKoder, kilder, arter, kunAabne, dage]
  );

  const aktuelSignatur = filterSignatur({ cpvKoder, kilder, arter, kunAabne, sortering, dage });
  const aktivtGemtFilter = GEMTE_FILTRE.find(
    (g) => filterSignatur(g.filtre) === aktuelSignatur
  )?.id;

  // Markerer de CPV-koder på hvert kort, der rent faktisk fik udbuddet med i
  // listen. Uden det kan et kort vise seks koder, hvor ingen af dem er den,
  // man søgte på.
  const praefikser = useMemo(
    () => cpvKoder.map((c) => cpvPraefiks(c.kode)).filter(Boolean),
    [cpvNoegle] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Advarsler hører til de valgte koder, ikke til siden: 79400000 tager som
  // præfiks ALT under 794 med, inkl. HR- og marketingrådgivning. Den skal
  // stå, når koden er valgt — og kun da.
  const advarsler = cpvKoder.map((c) => ADVARSEL_PR_KODE.get(c.kode)).filter(Boolean);

  // Vinduet gør et tomt svar tvetydigt, og indeksets alder er den eneste måde
  // at skelne "der kom intet" fra "synken er gået i stå".
  const visIndeksAlder = dage != null;
  const indeksAlder = dageSiden(resultat?.senesteRegistrering);
  const vindue = VINDUER.find((v) => v.dage === dage) ?? null;

  // Sortering på nyeste betyder, at listen læses på registreringsaksen — så
  // grupperes den pr. dag, og hvert kort får sit alders-mærke. Sorterer man
  // på frist eller værdi, ville begge være støj ved siden af det, man valgte.
  const paaNyhedsakse = sortering === "nyeste";
  const grupper = useMemo(
    () => (paaNyhedsakse ? grupperPrDag(udbud) : [{ etiket: null, poster: udbud }]),
    [udbud, paaNyhedsakse]
  );

  return (
    <main className="page">
      <section className="console">
        <div className="console-head">
          <p className="eyebrow">Udbudssøgning</p>
          <h3>Find udbud du kan byde på</h3>
          <p className="lede">
            Alle bekendtgørelser fra udbud.dk, søgbare på CPV-kode. Både EU-udbud fra
            TED og de danske udbud under tærskelværdien, som ikke findes i TED —
            afgrænset til dit felt frem for til det, der tilfældigvis står i titlen.
          </p>
        </div>

        <div className="console-bay">
          <div className="card-foot">
            <span className="eyebrow" style={{ margin: 0 }}>
              Kilde
            </span>
            <div className="source-row">
              <SourceBadge source="ted" label="udbud.dk (TED + DKUDBUD)" />
            </div>
          </div>

          {/* Indeksets alder, ikke søgningens: se noten øverst i filen. */}
          {visIndeksAlder && status === "faerdig" && (
            <div className="card-foot">
              <span className="eyebrow" style={{ margin: 0 }}>
                Indeks
              </span>
              {resultat?.senesteRegistrering ? (
                <StatusChip
                  tone={indeksAlder > STALE_DAGE ? "warn" : "ok"}
                  icon={indeksAlder > STALE_DAGE ? "alert" : "check"}
                >
                  {indeksAlder === 0
                    ? "opdateret i dag"
                    : indeksAlder === 1
                      ? "opdateret i går"
                      : `nyeste er ${indeksAlder} dage gammel`}
                </StatusChip>
              ) : (
                <StatusChip tone="warn" icon="alert">
                  indekset er tomt
                </StatusChip>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h3>Afgræns søgningen</h3>
            <p className="muted small">
              CPV-valget er hierarkisk: vælger du “It-tjenester” (72000000), kommer alle
              underliggende koder med.
            </p>
          </div>
        </div>

        <div className="stack">
          <div>
            <p className="eyebrow">Gemte filtre</p>
            <div className="button-row">
              {GEMTE_FILTRE.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`btn btn-sm ${aktivtGemtFilter === g.id ? "btn-primary" : "btn-secondary"}`}
                  aria-pressed={aktivtGemtFilter === g.id}
                  title={g.beskrivelse}
                  onClick={() => anvendFiltre(g.filtre)}
                >
                  <Icon name="spark" size={13} />
                  {g.etiket}
                </button>
              ))}
              {harFilter && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => anvendFiltre(STANDARDFILTRE)}
                >
                  Nulstil
                </button>
              )}
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              “Mit felt” er husets CPV-områder, fastlagt i{" "}
              <span className="mono">src/data/cpvOvervaagning.js</span> — ikke en
              indstilling, der kan forsvinde med en ryddet browser. Filtrene herunder
              huskes til næste gang.
            </p>
          </div>

          <CpvVaelger valgte={cpvKoder} onAendret={setCpvKoder} />

          {advarsler.map((tekst) => (
            <p className="muted small" key={tekst}>
              <Icon name="info" size={12} /> {tekst}
            </p>
          ))}

          {/* Kun relevant når feltet faktisk er valgt: listen dokumenterer hvad
              de tre brede koder dækker, og er ellers bare 79 linjer støj. */}
          {cpvKoder.some((c) => ADVARSEL_PR_KODE.has(c.kode) || MIT_FELT_KODER.some((m) => m.kode === c.kode)) && (
            <details
              className="kode-liste"
              open={visFeltkoder}
              onToggle={(e) => setVisFeltkoder(e.currentTarget.open)}
            >
              <summary>Vis hvad mit felt dækker ({OVERVAAGEDE_KODER.length} koder)</summary>
              <p className="muted small">
                De tre brede koder afgør søgningen. Resten er dækket af dem, fordi
                CPV-matchet er hierarkisk: 72000000 rammer alt, der begynder med 72 —
                de står her, fordi de er den liste, feltet blev defineret ud fra.
              </p>
              {OVERVAAGEDE_FELTER.map((f) => (
                <div key={f.id} className="kode-liste__felt">
                  <p className="eyebrow">
                    {f.kort}{" "}
                    {!cpvKoder.some((c) => c.kode === f.kode) && "· ikke valgt"}
                  </p>
                  <ul>
                    {f.koder.map((k) => (
                      <li key={k.kode} className={k.kode === f.kode ? "er-bred" : ""}>
                        <span className="tag tag--code">{k.kode}</span> {k.tekst}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </details>
          )}

          <div className="field">
            <label htmlFor="udbud-fritekst">Fritekst i titel og beskrivelse (valgfri)</label>
            <input
              id="udbud-fritekst"
              className="input"
              placeholder="Fx cloud, journalsystem, rådgivning"
              value={soegetekst}
              onChange={(e) => setSoegetekst(e.target.value)}
            />
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
                    {resultat?.prArt?.[a.vaerdi] ? (
                      <span className="nav-button__tal"> {resultat.prArt[a.vaerdi]}</span>
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
                    {resultat?.prKilde?.[k.vaerdi] ? (
                      <span className="nav-button__tal"> {resultat.prKilde[k.vaerdi]}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            {/* Vinduet måler på REGISTRERINGEN hos udbud.dk, ikke på fristen.
                Det er den akse, "er der kommet noget nyt" kan besvares på —
                et genudbud med kort frist er nyt, et gammelt udbud med lang
                frist er ikke. */}
            <div>
              <p className="eyebrow">Registreret</p>
              <div className="seg" role="group" aria-label="Hvor langt tilbage">
                <button
                  type="button"
                  className={`nav-button ${dage == null ? "active" : ""}`}
                  aria-pressed={dage == null}
                  onClick={() => setDage(null)}
                >
                  Hele indekset
                </button>
                {VINDUER.map((v) => (
                  <button
                    key={v.dage}
                    type="button"
                    className={`nav-button ${dage === v.dage ? "active" : ""}`}
                    aria-pressed={dage === v.dage}
                    onClick={() => setDage(v.dage)}
                  >
                    {v.etiket}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="eyebrow">Frist</p>
              <div className="seg" role="group" aria-label="Filtrér på frist">
                <button
                  type="button"
                  className={`nav-button ${kunAabne ? "active" : ""}`}
                  onClick={() => setKunAabne(true)}
                >
                  Kun åbne
                </button>
                <button
                  type="button"
                  className={`nav-button ${!kunAabne ? "active" : ""}`}
                  onClick={() => setKunAabne(false)}
                >
                  Alle, også lukkede
                </button>
              </div>
            </div>

            <div>
              <p className="eyebrow">Sortér</p>
              <div className="seg" role="group" aria-label="Sortering">
                {[
                  ["frist", "Frist"],
                  ["nyeste", "Nyeste"],
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

          {/* "Kun åbne" udelader bekendtgørelser helt uden frist. Det er
              rigtigt for udbud, men det betyder også at forhåndsmeddelelser
              og tildelinger forsvinder, og det skal siges frem for at ligne
              en tom database. */}
          {kunAabne && arter.some((a) => a !== "udbud") && (
            <p className="muted small">
              “Kun åbne” viser kun bekendtgørelser med en frist, der ikke er udløbet.
              Forhåndsmeddelelser og tildelinger har sjældent en frist og udelades derfor.
            </p>
          )}
        </div>
      </section>

      <section className={`card ${status === "henter" ? "is-working" : ""}`}>
        <div className="section-header">
          <div>
            <h3>
              {status !== "faerdig"
                ? "Resultater"
                : vindue
                  ? `${ialt.toLocaleString("da-DK")} nye inden for ${vindue.etiket.toLowerCase()}`
                  : `${ialt.toLocaleString("da-DK")} bekendtgørelser`}
            </h3>
            {status === "faerdig" && resultat?.prKilde && (
              <p className="muted small">
                {(resultat.prKilde.DKUDBUD ?? 0).toLocaleString("da-DK")} danske under
                tærskelværdien · {(resultat.prKilde.TED ?? 0).toLocaleString("da-DK")} fra TED
              </p>
            )}
          </div>
          {status === "faerdig" && resultat?.aabne > 0 && (
            <StatusChip tone="ok" icon="check">
              {resultat.aabne.toLocaleString("da-DK")} med åben frist
            </StatusChip>
          )}
        </div>

        {status === "henter" && (
          <>
            <Working>Søger i udbud.dk…</Working>
            <div style={{ marginTop: 14 }}>
              <SkeletonRows rows={6} />
            </div>
          </>
        )}

        {status === "fejl" && (
          <>
            <p className="muted small">{fejl}</p>
            <div className="button-row">
              <button className="btn btn-secondary btn-sm" onClick={() => setSide((n) => n)}>
                Prøv igen
              </button>
            </div>
          </>
        )}

        {/* Med et vindue er en tom liste to forskellige ting, og forskellen er
            hele forskellen mellem "ro på markedet" og "synken er gået i stå". */}
        {status === "faerdig" && !udbud.length && (
          <div className="empty-state">
            <span className="empty-state__icon">
              <Icon
                name={visIndeksAlder && !resultat?.senesteRegistrering ? "alert" : "inbox"}
                size={22}
              />
            </span>
            <h4>
              {!resultat?.senesteRegistrering
                ? "Indekset er tomt"
                : vindue
                  ? `Ingen nye inden for ${vindue.etiket.toLowerCase()}`
                  : "Ingen bekendtgørelser matcher"}
            </h4>
            <p className="muted">
              {!resultat?.senesteRegistrering
                ? "Kør scripts/indlaes-udbud-dk.mjs --fuld én gang, så holder den daglige synk den ajour derefter."
                : indeksAlder > STALE_DAGE && visIndeksAlder
                  ? `Bemærk at det nyeste i indekset er ${indeksAlder} dage gammelt — den daglige synk kan være gået i stå.`
                  : vindue
                    ? "Prøv et bredere vindue, eller slå forhåndsmeddelelser til for at se udbuddene tidligere."
                    : harFilter
                      ? "Prøv en bredere CPV-kode, eller slå “Kun åbne” fra for også at se lukkede udbud."
                      : "Indekset er tomt — er scripts/indlaes-udbud-dk.mjs kørt?"}
            </p>
          </div>
        )}

        {udbud.length > 0 &&
          grupper.map((gruppe) => (
            <div key={gruppe.etiket ?? "alle"} className={gruppe.etiket ? "dag-gruppe" : undefined}>
              {gruppe.etiket && (
                <p className="dag-gruppe__hoved">
                  {gruppe.etiket}
                  <span className="muted small"> · {gruppe.poster.length}</span>
                </p>
              )}
              <ul className="udbud-liste">
                {gruppe.poster.map((u) => (
                  <UdbudKort
                    key={`${u.noticeId}-${u.version}`}
                    udbud={u}
                    visRegistreret={paaNyhedsakse}
                    fremhaevedeCpv={praefikser}
                  />
                ))}
              </ul>
            </div>
          ))}

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

        <ul className="trace" style={{ marginTop: 14 }}>
          <li>
            <strong>Kilde:</strong> udbud.dk's eksterne API. Bekendtgørelserne indlæses og
            parses lokalt, fordi API'et hverken kan søges eller filtreres — det leverer
            base64-encoded eForms-XML og kan kun afgrænses på tidspunkt.
          </li>
          <li>
            <strong>DKUDBUD</strong> er danske udbud under EU's tærskelværdi. De findes
            ikke i TED og dermed ikke i appens øvrige flows.
          </li>
          {visIndeksAlder && (
            <>
              <li>
                <strong>“Nyt” måles på registreringstidspunktet</strong> hos udbud.dk — ikke
                på fristen. Et genudbud med kort frist er nyt; et gammelt udbud med lang
                frist er ikke.
              </li>
              <li>
                <strong>Indekset holdes ajour af en daglig synk</strong> (Vercel cron →
                api/synk-udbud.js), der kun henter det, der er registreret siden sidst.
                Chippen øverst viser hvor frisk grundlaget er.
              </li>
            </>
          )}
          <li>
            Anslået værdi er ordregiverens eget skøn fra bekendtgørelsen, ikke en
            kontraktværdi. Mange angiver 0 eller udelader feltet.
          </li>
        </ul>
      </section>
    </main>
  );
}
