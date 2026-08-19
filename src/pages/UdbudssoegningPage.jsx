import { useEffect, useMemo, useState } from "react";
import { soegUdbud, ARTER, KILDER } from "../services/udbudService";
import CpvVaelger from "../components/marked/CpvVaelger";
import UdbudKort from "../components/marked/UdbudKort";
import Icon from "../components/ui/Icon";
import SourceBadge from "../components/ui/SourceBadge";
import StatusChip from "../components/ui/StatusChip";
import { Working, SkeletonRows } from "../components/ui/Loading";

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

const SIDESTOERRELSE = 25;

export default function UdbudssoegningPage() {
  const [soegetekst, setSoegetekst] = useState("");
  const [cpvKoder, setCpvKoder] = useState([]);
  const [kilder, setKilder] = useState([]);
  const [arter, setArter] = useState(["udbud"]);
  const [kunAabne, setKunAabne] = useState(true);
  const [sortering, setSortering] = useState("frist");
  const [side, setSide] = useState(0);

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
  const filterNoegle = `${aktivTekst}|${cpvNoegle}|${kilder.join(",")}|${arter.join(",")}|${kunAabne}|${sortering}`;

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
    () => Boolean(aktivTekst.trim() || cpvKoder.length || kilder.length || arter.length !== 1 || !kunAabne),
    [aktivTekst, cpvKoder, kilder, arter, kunAabne]
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
          <CpvVaelger valgte={cpvKoder} onAendret={setCpvKoder} />

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
              {status === "faerdig" ? `${ialt.toLocaleString("da-DK")} bekendtgørelser` : "Resultater"}
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

        {status === "faerdig" && !udbud.length && (
          <div className="empty-state">
            <span className="empty-state__icon">
              <Icon name="inbox" size={22} />
            </span>
            <h4>Ingen bekendtgørelser matcher</h4>
            <p className="muted">
              {harFilter
                ? "Prøv en bredere CPV-kode, eller slå “Kun åbne” fra for også at se lukkede udbud."
                : "Indekset er tomt — er scripts/indlaes-udbud-dk.mjs kørt?"}
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
          <li>
            Anslået værdi er ordregiverens eget skøn fra bekendtgørelsen, ikke en
            kontraktværdi. Mange angiver 0 eller udelader feltet.
          </li>
        </ul>
      </section>
    </main>
  );
}
