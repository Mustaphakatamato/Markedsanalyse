import { useMemo, useState } from "react";
import { resolveMany } from "../../services/companyEnrichmentService";
import KildeVaelger from "./KildeVaelger";
import Icon from "../ui/Icon";
import SourceBadge from "../ui/SourceBadge";
import { Working, SkeletonRows } from "../ui/Loading";
import { formatDkkMio, formatPercent, formatDanishDate, formatAmount } from "../../lib/format";

// De virksomheder der rent faktisk har vundet kontrakter i CPV-feltet hos
// danske ordregivere.
//
// HVORFOR RANGERINGEN ER TO TAL OG IKKE ÉT: antal kontrakter alene belønner
// den leverandør, én enkelt stor ordregiver køber alt hos. Antal FORSKELLIGE
// ordregivere skelner mellem "kan levere til mange" og "har én stor kunde" —
// og for en ny ordregiver er den første egenskab den relevante.
//
// HVORFOR BELØB IKKE ER RANGERINGSNØGLEN: for en rammeaftale med flere
// vindere er notice'ens værdi rammens fælles loft, ikke hvad den enkelte
// leverandør fik. Summen her tæller derfor kun enkeltleverandør-kontrakter i
// DKK, og den er ufuldstændig med vilje. At rangere på et ufuldstændigt
// beløbstal ville se præcist ud og være forkert.

export default function Vinderliste({
  vindere,
  kildeinfo,
  status,
  fejl,
  shortliste,
  kilde,
  onSkiftKilde,
  onSkiftShortliste,
  onGoToCompany,
  onPrøvIgen
}) {
  const [kunMatchede, setKunMatchede] = useState(false);
  const [berigelse, setBerigelse] = useState(new Map());
  const [beriger, setBeriger] = useState(false);

  const shortlisteSet = useMemo(() => new Set(shortliste), [shortliste]);

  const synlige = useMemo(
    () => (kunMatchede ? vindere.filter((v) => v.cvr) : vindere),
    [vindere, kunMatchede]
  );

  const antalUmatchede = vindere.filter((v) => !v.cvr).length;

  const berigShortliste = async () => {
    const navne = vindere.filter((v) => v.cvr && shortlisteSet.has(v.cvr)).map((v) => v.cvrNavn || v.navn);
    if (!navne.length) return;
    setBeriger(true);
    try {
      const resultat = await resolveMany(navne, { maks: 25 });
      setBerigelse((forrige) => new Map([...forrige, ...resultat]));
    } finally {
      setBeriger(false);
    }
  };

  const hoved = (
    <div className="section-header">
      <div>
        <h3>Kandidater til markedsdialog</h3>
        <p className="muted small">
          Rangeret efter antal vundne kontrakter hos danske ordregivere, derefter
          efter hvor mange forskellige ordregivere de har leveret til.
        </p>
      </div>
      <SourceBadge source="ted" />
    </div>
  );

  if (status === "henter") {
    return (
      <section className="card is-working" id="kandidater">
        {hoved}
        <KildeVaelger kilde={kilde} onSkift={onSkiftKilde} />
        <Working>Tæller vindere i CPV-feltet…</Working>
        <div style={{ marginTop: 14 }}>
          <SkeletonRows rows={6} />
        </div>
      </section>
    );
  }

  if (status === "fejl") {
    return (
      <section className="card" id="kandidater">
        {hoved}
        <KildeVaelger kilde={kilde} onSkift={onSkiftKilde} />
        <p className="muted small">{fejl}</p>
        <div className="button-row">
          <button className="btn btn-secondary btn-sm" onClick={onPrøvIgen}>
            Prøv igen
          </button>
        </div>
      </section>
    );
  }

  if (!status) return null;

  return (
    <section className="card" id="kandidater">
      {hoved}
      <KildeVaelger kilde={kilde} onSkift={onSkiftKilde} />

      {!vindere.length && (
        <div className="empty-state">
          <span className="empty-state__icon">
            <Icon name="inbox" size={22} />
          </span>
          <h4>Ingen danske tildelinger i CPV-feltet</h4>
          <p className="muted">
            TED har ingen kontrakttildelinger fra danske ordregivere under de valgte
            CPV-koder. Det betyder ikke at markedet er tomt — det betyder at der ikke
            har været udbud over EU's tærskelværdi her. Skift til “Hele markedet” for
            at se leverandørerne i CVR.
          </p>
        </div>
      )}

      {vindere.length > 0 && (
        <>
          <div className="kandidat-styring">
            <div className="seg" role="group" aria-label="Filtrér vindere">
              {[
                [false, `Alle vindere (${vindere.length})`],
                [true, `Med dansk CVR-match (${vindere.length - antalUmatchede})`]
              ].map(([vaerdi, etiket]) => (
                <button
                  key={String(vaerdi)}
                  type="button"
                  className={`nav-button ${kunMatchede === vaerdi ? "active" : ""}`}
                  onClick={() => setKunMatchede(vaerdi)}
                >
                  {etiket}
                </button>
              ))}
            </div>

            <button
              className="btn btn-secondary btn-sm"
              onClick={berigShortliste}
              disabled={!shortliste.length || beriger}
              title="Henter seneste regnskab for de shortlistede virksomheder"
            >
              {beriger ? (
                <Working>Henter regnskaber…</Working>
              ) : (
                <>
                  <Icon name="database" size={13} />
                  Hent nøgletal for shortlisten
                </>
              )}
            </button>
          </div>

          <ul className="kandidat-liste">
            {synlige.map((v, i) => {
              const paaShortliste = v.cvr ? shortlisteSet.has(v.cvr) : false;
              const beriget = berigelse.get(v.cvrNavn || v.navn);
              const regnskab = beriget?.financials;

              return (
                <li
                  key={`${v.navn}-${i}`}
                  className={`kandidat ${paaShortliste ? "is-shortlistet" : ""}`}
                >
                  {/* Uden CVR-nummer kan virksomheden ikke shortlistes: nøglen
                      deles med kandidatlisten fra CVR, og en shortliste med to
                      slags identiteter ville ikke kunne slås sammen. */}
                  <button
                    type="button"
                    className="kandidat__marker"
                    disabled={!v.cvr}
                    aria-pressed={paaShortliste}
                    aria-label={
                      !v.cvr
                        ? `${v.navn} kan ikke shortlistes — intet entydigt CVR-match`
                        : paaShortliste
                          ? `Fjern ${v.navn} fra shortlisten`
                          : `Sæt ${v.navn} på shortlisten`
                    }
                    title={
                      v.cvr ? undefined : "Kan ikke shortlistes — intet entydigt CVR-nummer"
                    }
                    onClick={() => v.cvr && onSkiftShortliste(v.cvr)}
                  >
                    <Icon name={paaShortliste ? "check" : "plus"} size={14} />
                  </button>

                  <div className="kandidat__krop">
                    <div className="kandidat__top">
                      {v.cvr ? (
                        <button
                          type="button"
                          className="kandidat__navn"
                          onClick={() => onGoToCompany(v.cvrNavn || v.navn)}
                          title="Åbn fuld virksomhedsprofil"
                        >
                          {v.cvrNavn || v.navn}
                          <Icon name="arrow" size={12} />
                        </button>
                      ) : (
                        <span className="kandidat__navn kandidat__navn--flad">{v.navn}</span>
                      )}

                      <span className="pill pill-ok" title="Vundne kontrakter i CPV-feltet">
                        {v.antalKontrakter}{" "}
                        {v.antalKontrakter === 1 ? "kontrakt" : "kontrakter"}
                      </span>

                      <span
                        className="pill"
                        title="Antal forskellige danske ordregivere der har tildelt til dem"
                      >
                        {v.antalOrdregivere}{" "}
                        {v.antalOrdregivere === 1 ? "ordregiver" : "ordregivere"}
                      </span>

                      {v.trafAntal > 1 && (
                        <span
                          className="pill pill-warn"
                          title={`${v.trafAntal} aktive selskaber i CVR bærer dette navn — vi gætter ikke på hvilket`}
                        >
                          flertydigt navn
                        </span>
                      )}
                      {v.trafAntal === 0 && (
                        <span
                          className="pill"
                          title="Ingen aktiv dansk virksomhed med dette navn — typisk en udenlandsk leverandør"
                        >
                          intet CVR-match
                        </span>
                      )}
                    </div>

                    <p className="kandidat__meta muted small">
                      {v.branchetekst && `${v.branchetekst} · `}
                      {v.postdistrikt && `${v.postnummer} ${v.postdistrikt} · `}
                      {v.senesteDato && `seneste tildeling ${formatDanishDate(v.senesteDato)}`}
                      {v.antalRammeaftaler > 0 &&
                        ` · ${v.antalRammeaftaler} som rammeaftale med flere leverandører`}
                    </p>

                    <p className="kandidat__meta muted small">
                      {v.sumEnkeltkontrakterDkk != null ? (
                        <>
                          {formatAmount(v.sumEnkeltkontrakterDkk)} kr. i
                          enkeltleverandør-kontrakter
                        </>
                      ) : (
                        "Ingen beløb kan tilskrives entydigt (rammeaftaler eller anden valuta)"
                      )}
                      {v.senesteNotice?.url && (
                        <>
                          {" · "}
                          <a href={v.senesteNotice.url} target="_blank" rel="noreferrer">
                            seneste notice <Icon name="external" size={11} />
                          </a>
                          {v.senesteNotice.ordregiver && ` (${v.senesteNotice.ordregiver})`}
                        </>
                      )}
                    </p>

                    {beriget && (
                      <p className="kandidat__tal small">
                        {regnskab?.status === "ok" ? (
                          <>
                            <span className="num">{formatDkkMio(regnskab.topline)}</span>
                            <span className="muted"> omsætning · </span>
                            <span className="num">{formatPercent(regnskab.solvencyPct)}</span>
                            <span className="muted"> soliditet</span>
                          </>
                        ) : (
                          <span className="muted">Intet regnskab kunne udtrækkes.</span>
                        )}
                      </p>
                    )}
                  </div>

                  {v.cvr && <span className="kandidat__cvr mono small muted">{v.cvr}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ul className="trace" style={{ marginTop: 14 }}>
        {kildeinfo && (
          <li>
            <strong>Grundlag:</strong> {kildeinfo.noticesLaest.toLocaleString("da-DK")}{" "}
            {kildeinfo.afkortet
              ? `af ${kildeinfo.noticesIalt.toLocaleString("da-DK")} danske tildelinger`
              : "danske tildelinger"}{" "}
            under CPV {kildeinfo.cpvKoder.join(", ")}
            {kildeinfo.fraDato && kildeinfo.tilDato && (
              <>
                , {formatDanishDate(kildeinfo.fraDato)}–{formatDanishDate(kildeinfo.tilDato)}
              </>
            )}
            . {kildeinfo.vindereIalt.toLocaleString("da-DK")} forskellige virksomheder har
            vundet mindst én.
            {kildeinfo.afkortet && (
              <>
                {" "}
                Kun de nyeste er talt med — en leverandør, der var stor for ti år siden,
                kan derfor mangle.
              </>
            )}
          </li>
        )}
        <li>
          <strong>TED kender kun udbud over EU's tærskelværdi.</strong> En leverandør,
          der aldrig har vundet et EU-udbud, findes ikke på denne liste — heller ikke
          hvis den kan løfte opgaven. Brug “Hele markedet” til markedets faktiske
          sammensætning, og dermed til “opdel eller forklar”.
        </li>
        <li>
          At have vundet før er ikke det samme som at ville byde igen. Der findes ingen
          offentlig kilde til bud-hensigt, kun til tildelinger.
        </li>
        <li>
          Navnematchet mod CVR er konservativt: bærer flere aktive selskaber samme navn,
          udelades CVR-nummeret frem for at gætte. Et forkert nummer ville tilskrive én
          virksomhed en andens historik.
        </li>
      </ul>
    </section>
  );
}
