import { useEffect, useMemo, useState } from "react";
import { soegUdbud, dageSiden, ARTER } from "../services/udbudService";
import { minimerCpvKoder, cpvPraefiks } from "../lib/cpv";
import {
  OVERVAAGEDE_FELTER,
  OVERVAAGEDE_KODER,
  VINDUER,
  STANDARD_VINDUE
} from "../data/cpvOvervaagning";
import UdbudKort from "../components/marked/UdbudKort";
import Icon from "../components/ui/Icon";
import SourceBadge from "../components/ui/SourceBadge";
import StatusChip from "../components/ui/StatusChip";
import { Working, SkeletonRows } from "../components/ui/Loading";
import { formatDanishDate } from "../lib/format";

// Overvågning: hvad er kommet til inden for VORES felt, siden vi sidst så efter.
//
// HVORDAN DEN ER FORSKELLIG FRA UDBUDSSØGNING: dér vælger man selv CPV-koder
// hver gang og får hele historikken. Her er koderne givet på forhånd (se
// src/data/cpvOvervaagning.js), og tidsvinduet er filteret. Man kommer altså
// ikke for at SØGE, men for at se om der er sket noget — og så skal siden
// kunne åbnes og læses på ti sekunder uden et eneste valg.
//
// HVORFOR VINDUE FREM FOR "ULÆST": et rullende vindue har ingen tilstand at
// blive uenig med sig selv om. Et ulæst-mærke skal gemmes et sted, og gemmes
// det i browseren, nulstilles overvågningen af en ryddet cache eller en anden
// maskine — hvilket ser ud som "der er 400 nye udbud" og gør listen ubrugelig
// præcis den dag, man har brug for den.
//
// HVORFOR INDEKSETS ALDER STÅR ØVERST: listen fyldes af en daglig synk
// (api/synk-udbud.js). Holder den op med at køre, er svaret "0 nye i dag" —
// og det er ikke til at skelne fra "der var ingen udbud i dag", medmindre
// siden selv siger hvor gammelt dens grundlag er.

const SIDESTOERRELSE = 25;
// Synken kører dagligt. Er det nyeste vi har over to døgn gammelt, er det ikke
// en stille dag hos udbud.dk — så er der noget i vejen med synken.
const STALE_DAGE = 2;

// Grupperet på registreringsdag, fordi det er den akse listen læses i:
// "kom der noget i dag" er spørgsmålet, ikke "hvad er nummer 14 på listen".
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

export default function NyeUdbudPage() {
  const [slaaetFra, setSlaaetFra] = useState([]);
  const [dage, setDage] = useState(STANDARD_VINDUE);
  const [arter, setArter] = useState(["udbud"]);
  const [kunAabne, setKunAabne] = useState(false);
  const [visAlleKoder, setVisAlleKoder] = useState(false);
  const [side, setSide] = useState(0);

  const [resultat, setResultat] = useState(null);
  const [status, setStatus] = useState("idle");
  const [fejl, setFejl] = useState(null);

  const aktiveFelter = OVERVAAGEDE_FELTER.filter((f) => !slaaetFra.includes(f.id));

  // De 79 koder skæres ned til de bredeste, der afgør resultatet — tre, når
  // alle felter er slået til. Reduktionen ændrer ikke ét resultat, fordi
  // matchet er hierarkisk; den fjerner kun 76 overflødige LIKE-mønstre.
  const cpvKoder = useMemo(
    () => minimerCpvKoder(aktiveFelter.flatMap((f) => f.koder.map((k) => k.kode))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slaaetFra.join(",")]
  );
  const praefikser = useMemo(() => cpvKoder.map(cpvPraefiks).filter(Boolean), [cpvKoder]);

  const filterNoegle = `${cpvKoder.join(",")}|${dage}|${arter.join(",")}|${kunAabne}`;
  useEffect(() => {
    setSide(0);
  }, [filterNoegle]);

  useEffect(() => {
    let annulleret = false;

    // Alle felter slået fra er et gyldigt valg, ikke en søgning: uden vagten
    // ville et tomt cpvKoder-array betyde "intet CPV-filter" og trække HELE
    // indekset ind — altså det stik modsatte af det, man lige valgte.
    if (!cpvKoder.length) {
      setResultat(null);
      setStatus("intet-felt");
      return;
    }

    setStatus("henter");
    soegUdbud({
      cpvKoder,
      arter,
      kunAabne,
      sortering: "nyeste",
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
        setFejl(err.message || "Kunne ikke hente nye udbud.");
        setStatus("fejl");
      });

    return () => {
      annulleret = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterNoegle, side]);

  const udbud = resultat?.udbud ?? [];
  const ialt = resultat?.ialt ?? 0;
  const sidsteSide = Math.max(0, Math.ceil(ialt / SIDESTOERRELSE) - 1);
  const grupper = useMemo(() => grupperPrDag(udbud), [udbud]);

  const indeksAlder = dageSiden(resultat?.senesteRegistrering);
  const vindue = VINDUER.find((v) => v.dage === dage) ?? VINDUER[1];

  const skiftFelt = (id) =>
    setSlaaetFra((liste) => (liste.includes(id) ? liste.filter((v) => v !== id) : [...liste, id]));

  return (
    <main className="page">
      <section className="console">
        <div className="console-head">
          <p className="eyebrow">Nye udbud</p>
          <h3>Nyt i dit felt de sidste {vindue.etiket.toLowerCase()}</h3>
          <p className="lede">
            Fast overvågning af {OVERVAAGEDE_KODER.length} CPV-koder inden for programpakker,
            it-tjenester og rådgivning. Listen viser bekendtgørelser, der er{" "}
            <strong>registreret</strong> på udbud.dk inden for vinduet — ikke dem med den
            nærmeste frist. Både EU-udbud fra TED og de danske under tærskelværdien.
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
          {status === "faerdig" && (
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
            <h3>Overvågningen</h3>
            <p className="muted small">
              Koderne er fastlagt i koden ({OVERVAAGEDE_KODER.length} i alt fordelt på tre
              felter). Slå et felt fra her, hvis det støjer — det gælder kun denne session.
            </p>
          </div>
        </div>

        <div className="stack">
          <div className="felt-raekke">
            {OVERVAAGEDE_FELTER.map((f) => {
              const aktiv = !slaaetFra.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`felt-chip ${aktiv ? "active" : ""}`}
                  aria-pressed={aktiv}
                  onClick={() => skiftFelt(f.id)}
                  title={f.navn}
                >
                  <span className="felt-chip__kode">{f.kode}</span>
                  <span className="felt-chip__navn">{f.kort}</span>
                  <span className="felt-chip__tal">{f.koder.length} koder</span>
                </button>
              );
            })}
          </div>

          {/* Advarslen står på feltet i data-filen og vises kun når feltet er
              slået TIL — ellers ville den beskrive noget, der ikke sker. */}
          {OVERVAAGEDE_FELTER.filter((f) => f.advarsel && !slaaetFra.includes(f.id)).map((f) => (
            <p className="muted small" key={f.id}>
              <Icon name="info" size={12} /> {f.advarsel}
            </p>
          ))}

          <div className="udbud-filtre">
            <div>
              <p className="eyebrow">Vindue</p>
              <div className="seg" role="group" aria-label="Hvor langt tilbage">
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
              <p className="eyebrow">Type</p>
              <div className="seg" role="group" aria-label="Filtrér på bekendtgørelsestype">
                {ARTER.map((a) => (
                  <button
                    key={a.vaerdi}
                    type="button"
                    className={`nav-button ${arter.includes(a.vaerdi) ? "active" : ""}`}
                    aria-pressed={arter.includes(a.vaerdi)}
                    onClick={() =>
                      setArter((liste) =>
                        liste.includes(a.vaerdi)
                          ? liste.filter((v) => v !== a.vaerdi)
                          : [...liste, a.vaerdi]
                      )
                    }
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
              <p className="eyebrow">Frist</p>
              <div className="seg" role="group" aria-label="Filtrér på frist">
                <button
                  type="button"
                  className={`nav-button ${!kunAabne ? "active" : ""}`}
                  onClick={() => setKunAabne(false)}
                >
                  Alle nye
                </button>
                <button
                  type="button"
                  className={`nav-button ${kunAabne ? "active" : ""}`}
                  onClick={() => setKunAabne(true)}
                >
                  Kun med åben frist
                </button>
              </div>
            </div>
          </div>

          <details className="kode-liste" open={visAlleKoder} onToggle={(e) => setVisAlleKoder(e.currentTarget.open)}>
            <summary>Vis alle {OVERVAAGEDE_KODER.length} overvågede koder</summary>
            {/* De tre brede koder ER søgningen; de øvrige står her, fordi de er
                den liste feltet blev defineret ud fra. Markeringen viser
                hvilke der afgør resultatet, så listen ikke ser ud som 79
                selvstændige filtre. */}
            <p className="muted small">
              Markerede koder afgør søgningen. Resten er dækket af dem, fordi CPV-matchet er
              hierarkisk: 72000000 rammer alt, der begynder med 72.
            </p>
            {OVERVAAGEDE_FELTER.map((f) => (
              <div key={f.id} className="kode-liste__felt">
                <p className="eyebrow">
                  {f.kort} {slaaetFra.includes(f.id) && "· slået fra"}
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
        </div>
      </section>

      <section className={`card ${status === "henter" ? "is-working" : ""}`}>
        <div className="section-header">
          <div>
            <h3>
              {status === "faerdig"
                ? `${ialt.toLocaleString("da-DK")} nye ${ialt === 1 ? "bekendtgørelse" : "bekendtgørelser"}`
                : "Nye bekendtgørelser"}
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
            <Working>Henter nye bekendtgørelser…</Working>
            <div style={{ marginTop: 14 }}>
              <SkeletonRows rows={5} />
            </div>
          </>
        )}

        {status === "intet-felt" && (
          <div className="empty-state">
            <span className="empty-state__icon">
              <Icon name="inbox" size={22} />
            </span>
            <h4>Alle felter er slået fra</h4>
            <p className="muted">Slå mindst ét felt til for at se nye udbud.</p>
          </div>
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

        {/* Tom liste er to forskellige ting, og forskellen er hele forskellen
            mellem "ro på markedet" og "synken er gået i stå". */}
        {status === "faerdig" && !udbud.length && (
          <div className="empty-state">
            <span className="empty-state__icon">
              <Icon name={resultat?.senesteRegistrering ? "check" : "alert"} size={22} />
            </span>
            <h4>
              {resultat?.senesteRegistrering
                ? `Ingen nye inden for ${vindue.etiket.toLowerCase()}`
                : "Indekset er tomt"}
            </h4>
            <p className="muted">
              {resultat?.senesteRegistrering
                ? indeksAlder > STALE_DAGE
                  ? `Bemærk at det nyeste i indekset er ${indeksAlder} dage gammelt — den daglige synk kan være gået i stå.`
                  : "Prøv et bredere vindue, eller slå forhåndsmeddelelser til for at se dem tidligere."
                : "Kør scripts/indlaes-udbud-dk.mjs --fuld én gang, så holder den daglige synk den ajour derefter."}
            </p>
          </div>
        )}

        {grupper.map((gruppe) => (
          <div key={gruppe.etiket} className="dag-gruppe">
            <p className="dag-gruppe__hoved">
              {gruppe.etiket}
              <span className="muted small"> · {gruppe.poster.length}</span>
            </p>
            <ul className="udbud-liste">
              {gruppe.poster.map((u) => (
                <UdbudKort
                  key={`${u.noticeId}-${u.version}`}
                  udbud={u}
                  visRegistreret
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
            <strong>“Nyt” måles på registreringstidspunktet</strong> hos udbud.dk — ikke på
            fristen. Et genudbud med kort frist er nyt; et gammelt udbud med lang frist er
            ikke.
          </li>
          <li>
            <strong>Indekset holdes ajour af en daglig synk</strong> (Vercel cron →
            api/synk-udbud.js), der kun henter det, der er registreret siden sidst.
            Chippen øverst viser hvor frisk grundlaget er.
          </li>
          <li>
            De tre brede koder 48000000, 72000000 og 79400000 afgør søgningen; de øvrige{" "}
            {OVERVAAGEDE_KODER.length - 3} ligger under dem og kommer automatisk med.
          </li>
        </ul>
      </section>
    </main>
  );
}
