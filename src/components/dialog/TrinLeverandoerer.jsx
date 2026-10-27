import { useEffect, useMemo, useState } from "react";
import {
  smvStatus,
  stoerrelsePasser,
  SMV_ETIKET,
  MAERKE_ETIKET,
  ANTAL_SANDSYNLIGE
} from "../../services/leverandoerService";
import { aarligVaerdi } from "../../services/oekonomikrav";
import Icon from "../ui/Icon";
import SourceBadge from "../ui/SourceBadge";
import { Working, SkeletonRows } from "../ui/Loading";
import { formatDkkMio, formatPercent, formatDanishDate, formatAmount } from "../../lib/format";

// Trin 3 — hvem vil sandsynligvis byde?
//
// Mærkerne er neutrale pills. Grøn betyder "live kilde" i hele appen (se
// index.css) og må ikke bruges til at fremhæve en god leverandør — kun det
// verificerede SMV-svar, der netop ER et opslag i en live kilde, får farve.
//
// Én liste i stedet for to faner: CVR-markedet (hvem FINDES) og TED-vinderne
// (hvem har VUNDET) slås sammen i leverandoerService.samlLeverandoerer, og hver
// leverandør får mærker, der hver for sig kan efterprøves. De øverste 25 er
// "sandsynlige tilbudsgivere": dem hentes der nøgletal for automatisk, og dem
// regner kravsimulatoren i trin 4 på.

// TED fik først strukturerede vinderfelter ved eForms-skiftet i oktober
// 2023, og marked-vindere læser netop de felter. Ældste tildeling, der
// overhovedet kan tælles, er 2023-12-21 (målt 2026-10-27 på CPV 90910000).
// Derfor gav 3, 5 og 10 år NØJAGTIG samme tal — 152 vindere, største med 61
// kontrakter — selv om 10 år hentede 932 bekendtgørelser mod 3 års 263. Tre
// knapper, hvor de to var uden virkning, og en etiket der lovede ti års
// historik.
//
// 1, 2 og 3 år giver derimod hver sit svar (102 / 138 / 152 vindere), så det
// er den spændvidde, der er data til.
const PERIODER = [1, 2, 3];
const SIDESTOERRELSE = 25;

const MAERKE_FORKLARING = {
  nuvaerende: "Den nuværende kontraktholder, angivet i behovet",
  vundet: "Har vundet mindst én EU-kontrakt i CPV-feltet i perioden",
  branche: "Registreret i en af de valgte branchekoder",
  lokal: "Ligger i en kommune, der er nævnt i leveringsstedet",
  stoerrelse: "Omsætningen er mindst én årlig kontraktværdi"
};

function Noegletal({ lev, tal, henter, onHent }) {
  if (!lev.cvr) {
    return <span className="muted small">Intet dansk CVR</span>;
  }
  if (henter) return <Working>Henter…</Working>;
  if (!tal) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onHent([lev.cvr])}>
        <Icon name="database" size={12} />
        Hent nøgletal
      </button>
    );
  }
  if (tal.status !== "ok") {
    return (
      <span className="muted small">
        {tal.status === "intet_regnskab"
          ? "Intet regnskab indberettet"
          : tal.status === "ingen_tal"
            ? "Tal kunne ikke udtrækkes"
            : "Opslaget fejlede"}
        {tal.kilde && (
          <>
            {" · "}
            <a href={tal.kilde} target="_blank" rel="noreferrer">
              regnskab
            </a>
          </>
        )}
      </span>
    );
  }
  return (
    <div className="lev-tal">
      <span className="num">
        {tal.omsaetning != null ? (
          formatDkkMio(tal.omsaetning)
        ) : tal.omsaetningNedre != null ? (
          <span title="Selskabet oplyser kun bruttofortjeneste. Omsætningen er mindst dette beløb.">
            ≥ {formatDkkMio(tal.omsaetningNedre)}
          </span>
        ) : (
          "–"
        )}
      </span>
      <span className="muted small">
        omsætning {tal.aar && `(${tal.aar})`} · soliditet{" "}
        <span className="num">{formatPercent(tal.soliditet)}</span>
      </span>
    </div>
  );
}

function Tildelinger({ sejre }) {
  if (!sejre.tildelinger.length) {
    return <p className="muted small">Tildelingerne er ikke med i svaret fra serveren endnu.</p>;
  }
  return (
    <div className="scroll-x">
      <table className="data-table lev-tildelinger">
        <thead>
          <tr>
            <th>Dato</th>
            <th>Ordregiver</th>
            <th style={{ textAlign: "right" }}>Værdi</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sejre.tildelinger.map((t, i) => (
            <tr key={`${t.url}-${i}`}>
              <td className="num">{formatDanishDate(t.dato)}</td>
              <td>{t.ordregiver || "–"}</td>
              <td className="num" style={{ textAlign: "right" }}>
                {t.ramme ? "rammeaftale" : t.beloebDkk != null ? `${formatAmount(t.beloebDkk)} DKK` : "–"}
              </td>
              <td>
                {t.url && (
                  <a href={t.url} target="_blank" rel="noreferrer" className="small">
                    TED <Icon name="external" size={11} />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sejre.antal > sejre.tildelinger.length && (
        <p className="muted small">Viser de {sejre.tildelinger.length} nyeste af {sejre.antal}.</p>
      )}
    </div>
  );
}

export default function TrinLeverandoerer({ dialog, opdater, skiftShortliste, data, onGaaTil }) {
  const [filter, setFilter] = useState("alle"); // alle | sejre | smv | shortliste
  const [navnefilter, setNavnefilter] = useState("");
  const [antalVist, setAntalVist] = useState(SIDESTOERRELSE);
  const [aaben, setAaben] = useState(null);

  const { leverandoerer, kandidater, vindere, henterNoegletal, hentNoegletal } = data;
  const shortliste = useMemo(() => new Set(dialog.shortliste), [dialog.shortliste]);
  const aarlig = aarligVaerdi(dialog);

  // Beriger listen med det, der afhænger af hentede nøgletal. Holdes uden for
  // samlLeverandoerer, så rækkefølgen ikke flytter sig, mens tallene kommer ind.
  const beriget = useMemo(
    () =>
      leverandoerer.map((l, i) => {
        const tal = l.cvr ? dialog.regnskaber[l.cvr] : null;
        const maerker = stoerrelsePasser(tal, aarlig) ? [...l.maerker, "stoerrelse"] : l.maerker;
        return { ...l, rang: i, tal, maerker, smv: smvStatus(l, tal) };
      }),
    [leverandoerer, dialog.regnskaber, aarlig]
  );

  const synlige = useMemo(() => {
    const tekst = navnefilter.trim().toLowerCase();
    return beriget.filter((l) => {
      if (filter === "sejre" && !l.sejre?.antal) return false;
      if (filter === "smv" && l.smv !== "smv" && l.smv !== "smv_estimat") return false;
      if (filter === "shortliste" && !shortliste.has(l.cvr)) return false;
      if (tekst && !l.navn.toLowerCase().includes(tekst)) return false;
      return true;
    });
  }, [beriget, filter, navnefilter, shortliste]);

  useEffect(() => {
    setAntalVist(SIDESTOERRELSE);
  }, [filter, navnefilter, leverandoerer]);

  if (!dialog.cpvKoder.length) {
    return (
      <section className="empty-state">
        <span className="empty-state__icon">
          <Icon name="building" size={22} />
        </span>
        <h4>Beskriv behovet først</h4>
        <p className="muted">Leverandørerne findes ud fra CPV-koderne og branchekoderne.</p>
        <div className="button-row" style={{ justifyContent: "center" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => onGaaTil("behov")}>
            <Icon name="back" size={13} />
            Til behovet
          </button>
        </div>
      </section>
    );
  }

  const henter = kandidater.status === "henter" || vindere.status === "henter";
  const kilde = vindere.data?.kilde;
  const antal = {
    sejre: beriget.filter((l) => l.sejre?.antal).length,
    smv: beriget.filter((l) => l.smv === "smv" || l.smv === "smv_estimat").length
  };

  // Shortlistede vises altid, også uden for den viste side: brugerens egne
  // valg må ikke forsvinde under et "vis flere"-loft.
  const paaSiden = synlige.slice(0, antalVist);
  const shortlistetUdenfor = synlige.slice(antalVist).filter((l) => shortliste.has(l.cvr));
  const viste = [...paaSiden, ...shortlistetUdenfor];
  const resterer = synlige.length - viste.length;
  const manglerTal = beriget
    .slice(0, ANTAL_SANDSYNLIGE)
    .filter((l) => l.cvr && !l.tal && !henterNoegletal.has(l.cvr));

  return (
    <>
      <section className={`card ${henter ? "is-working" : ""}`} id="leverandoerer">
        <div className="section-header">
          <div>
            <p className="eyebrow">Trin 3 · Leverandører</p>
            <h3>Hvem vil sandsynligvis byde?</h3>
            <p className="muted small">
              Markedets største virksomheder i de valgte brancher og alle, der har vundet
              EU-udbud i CPV-feltet, samlet i én liste. Mærkerne viser hvorfor —
              leverandører med flest mærker står øverst.
            </p>
          </div>
          <div className="source-row">
            <SourceBadge source="cvr" label="CVR-register" />
            <SourceBadge source="ted" />
            <SourceBadge source="erst" />
          </div>
        </div>

        <div className="lev-styring">
          <div className="lev-styring__gruppe">
            <span className="eyebrow">Sejre de seneste</span>
            <div className="seg" role="group" aria-label="Periode for vundne udbud">
              {PERIODER.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`nav-button ${dialog.periodeAar === p ? "active" : ""}`}
                  onClick={() => opdater({ periodeAar: p })}
                >
                  {p} år
                </button>
              ))}
            </div>
          </div>

          <div className="lev-styring__gruppe">
            <span className="eyebrow">Vis</span>
            <div className="seg" role="group" aria-label="Filtrér leverandører">
              {[
                ["alle", `Alle (${beriget.length})`],
                ["sejre", `Med sejre (${antal.sejre})`],
                ["smv", `SMV (${antal.smv})`],
                ["shortliste", `Shortliste (${dialog.shortliste.length})`]
              ].map(([v, etiket]) => (
                <button
                  key={v}
                  type="button"
                  className={`nav-button ${filter === v ? "active" : ""}`}
                  onClick={() => setFilter(v)}
                >
                  {etiket}
                </button>
              ))}
            </div>
          </div>

          <input
            className="input lev-styring__soeg"
            placeholder="Filtrér på navn"
            aria-label="Filtrér leverandører på navn"
            value={navnefilter}
            onChange={(e) => setNavnefilter(e.target.value)}
          />
        </div>

        {kilde && kilde.aar == null && (
          <p className="lev-note small">
            <Icon name="info" size={13} /> Serveren tæller endnu ikke på periode — sejrene er
            talt blandt de {kilde.noticesLaest.toLocaleString("da-DK")} nyeste tildelinger.
          </p>
        )}
        {kilde?.afkortet && (
          <p className="lev-note small">
            <Icon name="info" size={13} /> Feltet har {kilde.noticesIalt.toLocaleString("da-DK")}{" "}
            tildelinger i perioden; de {kilde.noticesLaest.toLocaleString("da-DK")} nyeste er talt med
            (tilbage til {formatDanishDate(kilde.fraDato)}).
          </p>
        )}
        {kandidater.status === "fejl" && <p className="muted small">CVR-markedet: {kandidater.fejl}</p>}
        {vindere.status === "fejl" && <p className="muted small">TED-vindere: {vindere.fejl}</p>}
        {(kandidater.status === "fejl" || vindere.status === "fejl") && (
          <button className="btn btn-secondary btn-sm" onClick={data.proevIgen}>
            Prøv igen
          </button>
        )}
        {!dialog.branchekoder.length && (
          <p className="lev-note small">
            <Icon name="info" size={13} /> Kun TED-vindere vises, fordi der ikke er valgt
            branchekoder.{" "}
            <button type="button" className="link-knap" onClick={() => onGaaTil("marked")}>
              Vælg brancher i trin 2
            </button>{" "}
            for at få hele markedet med.
          </p>
        )}

        {henter && !beriget.length && (
          <>
            <Working>Finder leverandører i markedet…</Working>
            <div style={{ marginTop: 14 }}>
              <SkeletonRows rows={6} />
            </div>
          </>
        )}

        {manglerTal.length > 0 && henterNoegletal.size === 0 && !henter && (
          <div className="button-row">
            <button className="btn btn-secondary btn-sm" onClick={() => hentNoegletal(manglerTal.map((l) => l.cvr))}>
              <Icon name="database" size={13} />
              Hent nøgletal for de {manglerTal.length} øverste
            </button>
          </div>
        )}
        {henterNoegletal.size > 0 && (
          <p className="small">
            <Working>Henter nøgletal for {henterNoegletal.size} leverandører fra Erhvervsstyrelsen…</Working>
          </p>
        )}

        {!henter && !beriget.length && kandidater.status !== "fejl" && vindere.status !== "fejl" && (
          <div className="empty-state">
            <span className="empty-state__icon">
              <Icon name="inbox" size={22} />
            </span>
            <h4>Ingen leverandører fundet</h4>
            <p className="muted">Prøv bredere CPV-koder, flere brancher eller en længere periode.</p>
          </div>
        )}

        {beriget.length > 0 && !synlige.length && (
          <p className="muted small">Ingen leverandører matcher filteret.</p>
        )}

        {viste.length > 0 && (
          <ul className="lev-liste">
            {viste.map((l, i) => {
              const paa = shortliste.has(l.cvr);
              const visSkillelinje =
                filter === "alle" && !navnefilter && l.rang === ANTAL_SANDSYNLIGE && i > 0;
              return (
                <li key={l.noegle} className={`lev ${paa ? "is-shortlistet" : ""}`}>
                  {visSkillelinje && (
                    <p className="lev-skillelinje eyebrow">
                      Resten af markedet — uden automatisk hentede nøgletal
                    </p>
                  )}
                  <div className="lev__raekke">
                    <button
                      type="button"
                      className="kandidat__marker"
                      aria-pressed={paa}
                      disabled={!l.cvr}
                      title={l.cvr ? undefined : "Kan ikke shortlistes uden et entydigt dansk CVR-nummer"}
                      aria-label={paa ? `Fjern ${l.navn} fra shortlisten` : `Sæt ${l.navn} på shortlisten`}
                      onClick={() => skiftShortliste(l.cvr)}
                    >
                      <Icon name={paa ? "check" : "plus"} size={14} />
                    </button>

                    <div className="lev__navn">
                      <p className="lev__titel">
                        {l.navn}
                        {l.cvr && <span className="mono small muted"> {l.cvr}</span>}
                      </p>
                      <p className="muted small">
                        {[
                          l.branchetekst,
                          l.postdistrikt && `${l.postnummer} ${l.postdistrikt}`,
                          l.virksomhedsform
                        ]
                          .filter(Boolean)
                          .join(" · ") || (l.ukendtCvr ? `TED-navn: ${l.tedNavn}` : "")}
                      </p>
                      {l.maerker.length > 0 && (
                        <div className="lev__maerker">
                          {l.maerker.map((m) => (
                            <span key={m} className="pill" title={MAERKE_FORKLARING[m]}>
                              {MAERKE_ETIKET[m]}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="lev__sejre">
                      {l.sejre?.antal ? (
                        <button
                          type="button"
                          className="lev__sejre-knap"
                          aria-expanded={aaben === l.noegle}
                          onClick={() => setAaben(aaben === l.noegle ? null : l.noegle)}
                        >
                          <span className="num lev__stort">{l.sejre.antal}</span>
                          <span className="muted small">
                            vundne · {l.sejre.ordregivere} ordregiver{l.sejre.ordregivere === 1 ? "" : "e"}
                            <br />
                            seneste {formatDanishDate(l.sejre.seneste)}
                          </span>
                          <Icon name="chevron" size={12} />
                        </button>
                      ) : (
                        <span className="muted small">Ingen EU-sejre i perioden</span>
                      )}
                    </div>

                    <div className="lev__oekonomi">
                      <Noegletal
                        lev={l}
                        tal={l.tal}
                        henter={henterNoegletal.has(l.cvr)}
                        onHent={hentNoegletal}
                      />
                    </div>

                    <div className="lev__smv">
                      <span
                        className={`pill ${l.smv === "smv" ? "pill-ok" : ""} ${l.smv === "smv_estimat" ? "pill--estimat" : ""}`}
                        title={
                          l.smv === "smv_estimat"
                            ? "Ingen nøgletal endnu — skønnet ud fra antal forretningssteder"
                            : l.smv === "smv"
                              ? "Under 250 ansatte og under EU's omsætnings- eller balancegrænse"
                              : undefined
                        }
                      >
                        {SMV_ETIKET[l.smv]}
                      </span>
                    </div>
                  </div>

                  {aaben === l.noegle && l.sejre && (
                    <div className="lev__detalje">
                      <Tildelinger sejre={l.sejre} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {resterer > 0 && (
          <div className="kandidat-mere no-print">
            <button className="btn btn-secondary btn-sm" onClick={() => setAntalVist((n) => n + SIDESTOERRELSE)}>
              Vis {Math.min(SIDESTOERRELSE, resterer)} flere
            </button>
            <span className="muted small">
              {viste.length} af {synlige.length} vist
            </span>
          </div>
        )}

        <ul className="trace" style={{ marginTop: 14 }}>
          <li>
            <strong>TED viser kun sejre over EU's tærskelværdi.</strong> En leverandør uden
            EU-sejre kan godt have vundet mindre, nationale udbud.
          </li>
          <li>
            Markedsdelen er de 200 største i branchen, målt på forretningssteder og
            selskabsform — ikke på omsætning. Nøgletallene giver de rigtige tal.
          </li>
          <li>
            SMV følger EU's definition: under 250 ansatte og en omsætning under 50 mio. EUR
            eller en balance under 43 mio. EUR. Uden nøgletal er det et estimat.
          </li>
          <li>
            Listen er et udgangspunkt for dialog, ikke en egnethedsvurdering.
          </li>
        </ul>
      </section>

      <div className="button-row trin-fod no-print">
        <button className="btn btn-primary" onClick={() => onGaaTil("oekonomi")}>
          Videre til økonomisk formåen
          <Icon name="arrow" size={14} />
        </button>
      </div>
    </>
  );
}
