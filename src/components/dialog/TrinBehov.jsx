import { useState } from "react";
import { foreslaaMarked } from "../../services/markedService";
import { søgVirksomheder } from "../../services/cvrService";
import CpvVaelger from "../marked/CpvVaelger";
import Icon from "../ui/Icon";
import { Working } from "../ui/Loading";
import { formatAmount, formatDkkMio } from "../../lib/format";

// Trin 1 — behovsopgørelsen.
//
// Ordregiveren beskriver opgaven i sit eget sprog, og AI oversætter den til
// CPV-nomenklaturen. Det er det ene sted i markedsanalysen, hvor en model
// bidrager: at finde de rigtige koder blandt 9.454 er det svære første skridt,
// og alt efter det bygger på registre. Forslaget anvendes aldrig automatisk —
// koderne skal vælges til, og CPV-vælgeren står nedenunder til rettelser.
//
// Spørgsmålene er delt i tre grupper, én ad gangen, så formularen ikke ligner
// et skema på tredive felter. Kun det første felt er påkrævet; resten skærper
// forslaget og bruges senere (værdien til økonomikravet, leveringsstedet til
// "lokal", den nuværende leverandør til mærket på leverandørlisten).

export function tolkVaerdi(tekst) {
  const rent = String(tekst ?? "").replace(/\./g, "").replace(",", ".").trim();
  if (!rent) return null;
  const n = Number(rent.match(/-?\d+(\.\d+)?/)?.[0]);
  if (!Number.isFinite(n)) return null;
  if (/mia|milliard/i.test(tekst)) return Math.round(n * 1_000_000_000);
  if (/mio|million/i.test(tekst)) return Math.round(n * 1_000_000);
  return Math.round(n);
}

const GRUPPER = [
  { id: "opgaven", titel: "Opgaven" },
  { id: "rammer", titel: "Rammer" },
  { id: "marked", titel: "Markedet i dag" }
];

// Forslaget gemmes sammen med det behov, det blev lavet ud fra. Ændres
// behovet bagefter, siger kortet det — ellers ville et gammelt forslag stå og
// se ud som svaret på den nye beskrivelse.
function behovNoegle(behov) {
  return JSON.stringify([
    behov.hvad,
    behov.formaal,
    behov.geografi,
    behov.varighedAar,
    behov.opdeling,
    behov.saerligeKrav
  ]);
}

function NuvaerendeLeverandoer({ valgt, onVaelg }) {
  const [tekst, setTekst] = useState("");
  const [traf, setTraf] = useState(null);
  const [besked, setBesked] = useState(null);
  const [soeger, setSoeger] = useState(false);

  if (valgt) {
    return (
      <div className="valgt-leverandoer">
        <span>
          <strong>{valgt.navn}</strong> <span className="mono small muted">{valgt.cvr}</span>
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onVaelg(null)}>
          Fjern
        </button>
      </div>
    );
  }

  const soeg = async () => {
    setSoeger(true);
    setBesked(null);
    const svar = await søgVirksomheder(tekst);
    setSoeger(false);
    if (svar.status === "ok") setTraf(svar.traf);
    else if (svar.status === "cvr") setTraf([{ cvr: svar.cvr, navn: `CVR ${svar.cvr}` }]);
    else {
      setTraf(null);
      setBesked(svar.message);
    }
  };

  return (
    <div className="stack stack-tight">
      <div className="soeg-linje">
        <input
          id="behov-nuvaerende"
          className="input"
          placeholder="Firmanavn eller CVR-nummer"
          value={tekst}
          onChange={(e) => setTekst(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && tekst.trim() && soeg()}
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={soeg} disabled={!tekst.trim() || soeger}>
          <Icon name="search" size={13} />
          Søg
        </button>
      </div>
      {soeger && <Working>Søger i CVR…</Working>}
      {besked && <p className="muted small">{besked}</p>}
      {traf && (
        <ul className="vaelg-liste">
          {traf.slice(0, 6).map((t) => (
            <li key={t.cvr}>
              <button type="button" onClick={() => onVaelg({ cvr: t.cvr, navn: t.navn })}>
                {t.navn} <span className="mono small muted">{t.cvr}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AiForslag({ dialog, opdater, behovAendret }) {
  const forslag = dialog.aiForslag;
  const valgte = new Set(dialog.cpvKoder.map((c) => c.kode));

  const tilfoej = (koder) => {
    const nye = koder.filter((k) => !valgte.has(k.kode)).map((k) => ({ kode: k.kode, tekst: k.tekst }));
    if (nye.length) opdater({ cpvKoder: [...dialog.cpvKoder, ...nye] });
  };

  const ikkeValgte = forslag.cpvForslag.filter((f) => !valgte.has(f.kode));

  return (
    <section className="card ai-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Forslag til marked</p>
          <h3>Sådan læser AI dit behov</h3>
          <p className="muted small">
            Koderne er slået op i den officielle CPV-nomenklatur, og betegnelserne er de
            officielle. Intet bruges, før du har valgt det til.
          </p>
        </div>
        <span className="pill pill--ai">AI-genereret</span>
      </div>

      {behovAendret && (
        <p className="ai-forslag__aendret small">
          <Icon name="info" size={13} /> Behovet er ændret, siden forslaget blev lavet. Find
          markedet igen for at få et forslag til den nye beskrivelse.
        </p>
      )}

      {forslag.cpvForslag.length > 0 ? (
        <ul className="ai-koder">
          {forslag.cpvForslag.map((f) => {
            const er = valgte.has(f.kode);
            return (
              <li key={f.kode} className={er ? "is-valgt" : ""}>
                <button
                  type="button"
                  className="ai-koder__knap"
                  aria-pressed={er}
                  onClick={() =>
                    er
                      ? opdater({ cpvKoder: dialog.cpvKoder.filter((c) => c.kode !== f.kode) })
                      : tilfoej([f])
                  }
                >
                  <Icon name={er ? "check" : "plus"} size={13} />
                </button>
                <div>
                  <p className="ai-koder__titel">
                    <span className="mono">{f.kode}</span> {f.tekst}
                  </p>
                  <p className="muted small">{f.begrundelse}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">
          Ingen af modellens kodeforslag fandtes i nomenklaturen. Brug søgeforslagene
          herunder eller CPV-vælgeren.
        </p>
      )}

      {ikkeValgte.length > 1 && (
        <div className="button-row">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => tilfoej(ikkeValgte)}>
            Brug alle {ikkeValgte.length} foreslåede koder
          </button>
        </div>
      )}

      {forslag.kasseredeKoder > 0 && (
        <p className="muted small">
          {forslag.kasseredeKoder} kode{forslag.kasseredeKoder === 1 ? "" : "r"} fra modellen fandtes
          ikke i nomenklaturen og er sorteret fra.
        </p>
      )}

      {forslag.flereMuligheder?.length > 0 && (
        <div className="stack stack-tight">
          <p className="eyebrow" style={{ margin: 0 }}>
            Beslægtede koder fra søgningen
          </p>
          <div className="tag-row">
            {forslag.flereMuligheder.map((m) => (
              <button
                key={m.kode}
                type="button"
                className={`tag tag--code tag--knap ${valgte.has(m.kode) ? "is-valgt" : ""}`}
                title={`Fundet på søgeordet "${m.soegeord}"`}
                onClick={() => tilfoej([m])}
                disabled={valgte.has(m.kode)}
              >
                <span className="tag__key">{valgte.has(m.kode) ? "✓" : "+"}</span>
                {m.kode}
                <span className="tag__tekst"> {m.tekst}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(forslag.afgraensning?.omfatter?.length > 0 || forslag.afgraensning?.omfatterIkke?.length > 0) && (
        <div className="grid two-col afgraensning">
          <div>
            <p className="eyebrow">Markedet omfatter</p>
            <ul className="trace">
              {forslag.afgraensning.omfatter.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow">Ligger tæt på, men udenfor</p>
            <ul className="trace">
              {forslag.afgraensning.omfatterIkke.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {forslag.opdelingsforslag && (
        <p className="small">
          <strong>Delkontrakter: </strong>
          {forslag.opdelingsforslag}
        </p>
      )}
    </section>
  );
}

export default function TrinBehov({ dialog, opdater, onVidere }) {
  const [gruppe, setGruppe] = useState(0);
  const [vaerdiTekst, setVaerdiTekst] = useState(
    dialog.anslaaetVaerdi != null ? formatAmount(dialog.anslaaetVaerdi) : ""
  );
  const [aiStatus, setAiStatus] = useState("idle");
  const [aiFejl, setAiFejl] = useState(null);

  const behov = dialog.behov;
  const saetBehov = (felter) => opdater({ behov: { ...behov, ...felter } });

  const findMarkedet = async () => {
    setAiStatus("henter");
    setAiFejl(null);
    try {
      const svar = await foreslaaMarked(behov);
      opdater({ aiForslag: { ...svar, behovNoegle: behovNoegle(behov), lavet: new Date().toISOString() } });
      setAiStatus("idle");
    } catch (err) {
      setAiFejl(err.message);
      setAiStatus("fejl");
    }
  };

  const kanFinde = behov.hvad.trim().length >= 5;
  const vaerdi = tolkVaerdi(vaerdiTekst);
  const aarlig = vaerdi && behov.varighedAar ? vaerdi / behov.varighedAar : null;

  return (
    <>
      <section className="card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Trin 1 · Behovsopgørelse</p>
            <h3>Hvad skal der købes?</h3>
            <p className="muted small">
              Beskriv opgaven med dine egne ord. Kun det første felt er påkrævet — resten
              skærper forslaget og bruges senere i analysen.
            </p>
          </div>
        </div>

        <div className="seg behov-grupper" role="tablist" aria-label="Spørgsmålsgrupper">
          {GRUPPER.map((g, i) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={gruppe === i}
              className={`nav-button ${gruppe === i ? "active" : ""}`}
              onClick={() => setGruppe(i)}
            >
              {i + 1}. {g.titel}
            </button>
          ))}
        </div>

        {gruppe === 0 && (
          <div className="stack">
            <div className="field">
              <label htmlFor="behov-titel">Arbejdstitel</label>
              <input
                id="behov-titel"
                className="input"
                placeholder="Fx Rengøring af skoler og daginstitutioner"
                value={dialog.titel}
                onChange={(e) => opdater({ titel: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="behov-hvad">Hvad skal anskaffes?</label>
              <textarea
                id="behov-hvad"
                className="input"
                rows={4}
                placeholder="Fx Daglig rengøring af 14 skoler og 22 daginstitutioner, ca. 180.000 m², inkl. vinduespolering to gange årligt og hovedrengøring i sommerferien."
                value={behov.hvad}
                onChange={(e) => saetBehov({ hvad: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="behov-formaal">Hvad er formålet — hvilket problem løser det?</label>
              <textarea
                id="behov-formaal"
                className="input"
                rows={2}
                placeholder="Fx Den nuværende kontrakt udløber, og vi vil samle tre kontrakter i én med fælles kvalitetsstandard."
                value={behov.formaal}
                onChange={(e) => saetBehov({ formaal: e.target.value })}
              />
            </div>
          </div>
        )}

        {gruppe === 1 && (
          <div className="stack">
            <div className="grid two-col">
              <div className="field">
                <label htmlFor="behov-vaerdi">Anslået samlet kontraktværdi</label>
                <input
                  id="behov-vaerdi"
                  className="input"
                  placeholder="Fx 25 mio."
                  value={vaerdiTekst}
                  onChange={(e) => {
                    setVaerdiTekst(e.target.value);
                    opdater({ anslaaetVaerdi: tolkVaerdi(e.target.value), vaerdiRaa: null });
                  }}
                />
                <p className="muted small field__hjaelp">
                  {vaerdi != null
                    ? `Tolkes som ${formatAmount(vaerdi)} kr.`
                    : "Skriv fx “25 mio.” eller “25000000”. Bruges til kravet om økonomisk formåen."}
                </p>
              </div>
              <div className="field">
                <label htmlFor="behov-varighed">Varighed inkl. optioner (år)</label>
                <input
                  id="behov-varighed"
                  className="input num"
                  inputMode="decimal"
                  placeholder="Fx 4"
                  value={behov.varighedAar ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(",", "."));
                    saetBehov({ varighedAar: e.target.value.trim() && n > 0 ? n : null });
                  }}
                />
                <p className="muted small field__hjaelp">
                  {aarlig
                    ? `Svarer til ca. ${formatDkkMio(aarlig)} om året.`
                    : "Bruges til at regne den årlige værdi ud."}
                </p>
              </div>
            </div>
            <div className="grid two-col">
              <div className="field">
                <label htmlFor="behov-geografi">Leveringssted</label>
                <input
                  id="behov-geografi"
                  className="input"
                  placeholder="Fx Aarhus Kommune"
                  value={behov.geografi}
                  onChange={(e) => saetBehov({ geografi: e.target.value })}
                />
                <p className="muted small field__hjaelp">
                  Nævn kommunen — leverandører derfra får mærket “Lokal”.
                </p>
              </div>
              <div className="field">
                <label htmlFor="behov-dato">Forventet udbudsdato</label>
                <input
                  id="behov-dato"
                  className="input"
                  type="date"
                  value={dialog.deadline ?? ""}
                  onChange={(e) => opdater({ deadline: e.target.value || null })}
                />
              </div>
            </div>
          </div>
        )}

        {gruppe === 2 && (
          <div className="stack">
            <div className="field">
              <label htmlFor="behov-nuvaerende">Har I en kontrakt i dag? Hvem har den?</label>
              <NuvaerendeLeverandoer
                valgt={behov.nuvaerende}
                onVaelg={(nuvaerende) => saetBehov({ nuvaerende })}
              />
            </div>
            <div className="field">
              <span className="field__label">Overvejer I at dele opgaven i delkontrakter?</span>
              <div className="seg" role="radiogroup" aria-label="Delkontrakter">
                {[
                  ["ja", "Ja"],
                  ["nej", "Nej, ét samlet udbud"],
                  ["ved_ikke", "Ved ikke endnu"]
                ].map(([v, etiket]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={behov.opdeling === v}
                    className={`nav-button ${behov.opdeling === v ? "active" : ""}`}
                    onClick={() => saetBehov({ opdeling: v })}
                  >
                    {etiket}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="behov-krav">Særlige krav</label>
              <textarea
                id="behov-krav"
                className="input"
                rows={2}
                placeholder="Fx Svanemærkede midler, sikkerhedsgodkendt personale, ISO 14001"
                value={behov.saerligeKrav}
                onChange={(e) => saetBehov({ saerligeKrav: e.target.value })}
              />
            </div>
          </div>
        )}

        <div className="button-row behov-fod">
          {gruppe > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGruppe(gruppe - 1)}>
              <Icon name="back" size={13} />
              Forrige
            </button>
          )}
          {gruppe < GRUPPER.length - 1 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setGruppe(gruppe + 1)}>
              Næste: {GRUPPER[gruppe + 1].titel}
              <Icon name="arrow" size={13} />
            </button>
          )}
          <span className="behov-fod__skub" />
          <button
            type="button"
            className="btn btn-primary"
            onClick={findMarkedet}
            disabled={!kanFinde || aiStatus === "henter"}
            title={kanFinde ? undefined : "Beskriv først, hvad der skal anskaffes"}
          >
            <Icon name="spark" size={14} />
            {dialog.aiForslag ? "Find markedet igen" : "Find markedet"}
          </button>
        </div>
        {aiStatus === "henter" && <Working>Oversætter behovet til CPV-koder…</Working>}
        {aiStatus === "fejl" && <p className="muted small">{aiFejl}</p>}
      </section>

      {dialog.aiForslag && (
        <AiForslag
          dialog={dialog}
          opdater={opdater}
          behovAendret={dialog.aiForslag.behovNoegle !== behovNoegle(behov)}
        />
      )}

      <section className="card">
        <div className="section-header">
          <div>
            <h3>Valgte CPV-koder</h3>
            <p className="muted small">
              Markedet afgrænses af disse koder. Søg selv, hvis forslaget ikke rammer.
            </p>
          </div>
        </div>
        <CpvVaelger valgte={dialog.cpvKoder} onAendret={(cpvKoder) => opdater({ cpvKoder })} />
        {dialog.cpvKoder.length > 0 && (
          <div className="button-row" style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-primary" onClick={onVidere}>
              Videre til markedet
              <Icon name="arrow" size={14} />
            </button>
          </div>
        )}
      </section>
    </>
  );
}
