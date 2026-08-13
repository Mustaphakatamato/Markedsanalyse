import { useMemo, useState } from "react";
import { resolveMany } from "../../services/companyEnrichmentService";
import Icon from "../ui/Icon";
import SourceBadge from "../ui/SourceBadge";
import { Working, SkeletonRows } from "../ui/Loading";
import { formatDkkMio, formatPercent } from "../../lib/format";

// Kandidater til markedsdialog.
//
// HVAD LISTEN IKKE ER: en rangering. Rækkefølgen er hovedbranche før
// bibranche og derefter vilkårlig-men-stabil. En meningsfuld rangering kræver
// økonomi, kapacitet og track record — og de tal findes kun for de
// virksomheder, man vælger at hente dem for. At sortere alfabetisk ville se
// ordnet ud uden at være det, og det er værre end tydelig vilkårlighed.
//
// HVORFOR BERIGELSEN ER ET SEPARAT KLIK: hvert opslag koster to kald
// (navneindeks + regnskab). For 200 kandidater ville det være 400 kald mod
// Erhvervsstyrelsens registre, som i forvejen svarer langsomt. Shortlisten er
// den delmængde, brugeren rent faktisk skal vurdere.

export default function Kandidatliste({
  virksomheder,
  status,
  fejl,
  shortliste,
  onSkiftShortliste,
  onGoToCompany,
  onPrøvIgen
}) {
  const [visKun, setVisKun] = useState("alle"); // alle | hoved | shortliste
  const [filterTekst, setFilterTekst] = useState("");
  const [berigelse, setBerigelse] = useState(new Map());
  const [beriger, setBeriger] = useState(false);

  const shortlisteSet = useMemo(() => new Set(shortliste), [shortliste]);

  const synlige = useMemo(() => {
    const tekst = filterTekst.trim().toLowerCase();
    return virksomheder.filter((v) => {
      if (visKun === "hoved" && !v.trafHovedbranche) return false;
      if (visKun === "shortliste" && !shortlisteSet.has(v.cvr)) return false;
      if (tekst && !v.navn.toLowerCase().includes(tekst)) return false;
      return true;
    });
  }, [virksomheder, visKun, filterTekst, shortlisteSet]);

  const berigShortliste = async () => {
    const navne = virksomheder.filter((v) => shortlisteSet.has(v.cvr)).map((v) => v.navn);
    if (!navne.length) return;
    setBeriger(true);
    try {
      const resultat = await resolveMany(navne, { maks: 25 });
      setBerigelse((forrige) => new Map([...forrige, ...resultat]));
    } finally {
      setBeriger(false);
    }
  };

  if (status === "henter") {
    return (
      <section className="card is-working">
        <div className="section-header">
          <h3>Kandidater</h3>
          <SourceBadge source="cvr" label="CVR-register" />
        </div>
        <Working>Finder virksomheder i markedet…</Working>
        <div style={{ marginTop: 14 }}>
          <SkeletonRows rows={6} />
        </div>
      </section>
    );
  }

  if (status === "fejl") {
    return (
      <section className="card">
        <div className="section-header">
          <h3>Kandidater</h3>
        </div>
        <p className="muted small">{fejl}</p>
        <div className="button-row">
          <button className="btn btn-secondary btn-sm" onClick={onPrøvIgen}>
            Prøv igen
          </button>
        </div>
      </section>
    );
  }

  if (!virksomheder.length) return null;

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h3>Kandidater til markedsdialog</h3>
          <p className="muted small">
            Et udsnit på {virksomheder.length} af markedet — ikke en rangering. Rækkefølgen
            er hovedbranche først og derefter vilkårlig, fordi en meningsfuld rangering
            kræver tal, vi først henter for dem, du vælger.
          </p>
        </div>
        <SourceBadge source="cvr" label="CVR-register" />
      </div>

      <div className="kandidat-styring">
        <div className="seg" role="group" aria-label="Filtrér kandidater">
          {[
            ["alle", `Alle (${virksomheder.length})`],
            ["hoved", `Hovedbranche (${virksomheder.filter((v) => v.trafHovedbranche).length})`],
            ["shortliste", `Shortliste (${shortliste.length})`]
          ].map(([vaerdi, etiket]) => (
            <button
              key={vaerdi}
              type="button"
              className={`nav-button ${visKun === vaerdi ? "active" : ""}`}
              onClick={() => setVisKun(vaerdi)}
            >
              {etiket}
            </button>
          ))}
        </div>

        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="Filtrér på navn"
          value={filterTekst}
          aria-label="Filtrér kandidater på navn"
          onChange={(e) => setFilterTekst(e.target.value)}
        />

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

      {!synlige.length && (
        <p className="muted small" style={{ marginTop: 14 }}>
          Ingen kandidater matcher filteret.
        </p>
      )}

      <ul className="kandidat-liste">
        {synlige.map((v) => {
          const paaShortliste = shortlisteSet.has(v.cvr);
          const beriget = berigelse.get(v.navn);
          const regnskab = beriget?.financials;

          return (
            <li key={v.cvr} className={`kandidat ${paaShortliste ? "is-shortlistet" : ""}`}>
              <button
                type="button"
                className="kandidat__marker"
                aria-pressed={paaShortliste}
                aria-label={
                  paaShortliste
                    ? `Fjern ${v.navn} fra shortlisten`
                    : `Sæt ${v.navn} på shortlisten`
                }
                onClick={() => onSkiftShortliste(v.cvr)}
              >
                <Icon name={paaShortliste ? "check" : "plus"} size={14} />
              </button>

              <div className="kandidat__krop">
                <div className="kandidat__top">
                  <button
                    type="button"
                    className="kandidat__navn"
                    onClick={() => onGoToCompany(v.navn)}
                    title="Åbn fuld virksomhedsprofil"
                  >
                    {v.navn}
                    <Icon name="arrow" size={12} />
                  </button>
                  {!v.trafHovedbranche && (
                    <span className="pill" title="Branchen er registreret som bibranche">
                      bibranche
                    </span>
                  )}
                </div>

                <p className="kandidat__meta muted small">
                  {v.branchetekst || v.branchekode}
                  {v.postdistrikt && ` · ${v.postnummer} ${v.postdistrikt}`}
                  {v.virksomhedsform && ` · ${v.virksomhedsform}`}
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
                    ) : beriget.cvr ? (
                      <span className="muted">Intet regnskab kunne udtrækkes.</span>
                    ) : (
                      <span className="muted">Kunne ikke matches entydigt i CVR.</span>
                    )}
                  </p>
                )}
              </div>

              <span className="kandidat__cvr mono small muted">{v.cvr}</span>
            </li>
          );
        })}
      </ul>

      <ul className="trace" style={{ marginTop: 14 }}>
        <li>
          At en virksomhed står i branchen betyder ikke, at den kan eller vil løfte
          opgaven. Listen er et udgangspunkt for dialog, ikke en egnethedsvurdering.
        </li>
        <li>
          Nøgletal hentes kun for shortlisten, fordi hvert opslag koster to kald mod
          Erhvervsstyrelsens registre.
        </li>
      </ul>
    </section>
  );
}
