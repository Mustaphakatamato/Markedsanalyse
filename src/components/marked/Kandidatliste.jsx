import { useEffect, useMemo, useState } from "react";
import { resolveMany } from "../../services/companyEnrichmentService";
import { KLASSE_ETIKET } from "../../services/markedService";
import KildeVaelger from "./KildeVaelger";
import Icon from "../ui/Icon";
import SourceBadge from "../ui/SourceBadge";
import { Working, SkeletonRows } from "../ui/Loading";
import { formatDkkMio, formatPercent } from "../../lib/format";

// Kandidater til markedsdialog — de største i markedet først.
//
// HVAD LISTEN ER: en forsortering. Rækkefølgen bygger på antal aktive
// forretningssteder og selskabsform, som er de eneste størrelsessignaler CVR
// udstiller for hele populationen. Det måler organisationens UDSTRÆKNING, ikke
// dens omsætning: et rådgivningshus med 300 ansatte på én adresse står i samme
// klasse som et enmands-ApS. Derfor står forbeholdet i UI'et, og derfor er
// regnskabsberigelsen stadig næste skridt.
//
// HVORFOR AFGRÆNSNINGEN SKER I DATABASEN: i rengøringsbranchen er 7.388
// virksomheder aktive, og 293 af dem er A/S eller har mere end ét sted.
// Hentede vi 200 vilkårlige og filtrerede dem her, ville brugeren se ca. otte.
// Derfor udløser et skift af størrelsesfilteret et nyt opslag.
//
// HVORFOR LISTEN SIDES OP: 200 rækker i ét stræk gjorde alt under
// kandidatlisten praktisk talt uopnåeligt — man skulle scrolle forbi hele
// markedet for at nå kontrakttildelingerne. Siden viser 25 ad gangen.

const SIDESTOERRELSE = 25;

const KLASSE_TONE = {
  landsdaekkende: "pill-ok",
  flere_adresser: "pill-ok",
  selskab: "",
  mikro: ""
};

function Stoerrelsesmaerke({ klasse, antalPenheder }) {
  if (!klasse || klasse === "mikro") return null;
  const etiket =
    antalPenheder >= 2 ? `${antalPenheder} adresser` : KLASSE_ETIKET[klasse] ?? klasse;
  return (
    <span
      className={`pill ${KLASSE_TONE[klasse] ?? ""}`}
      title={
        antalPenheder >= 2
          ? `${antalPenheder} aktive produktionsenheder registreret i CVR`
          : "Selskabsform med begrænset ansvar — ikke enkeltmandsvirksomhed"
      }
    >
      {etiket}
    </span>
  );
}

export default function Kandidatliste({
  virksomheder,
  status,
  fejl,
  shortliste,
  stoerrelsesfilter,
  onSkiftStoerrelsesfilter,
  sortering,
  onSkiftSortering,
  klassefordeling,
  markedIalt,
  kilde,
  onSkiftKilde,
  onSkiftShortliste,
  onGoToCompany,
  onPrøvIgen
}) {
  const [visKun, setVisKun] = useState("alle"); // alle | hoved | shortliste
  const [filterTekst, setFilterTekst] = useState("");
  const [antalVist, setAntalVist] = useState(SIDESTOERRELSE);
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

  // Uden nulstillingen ville et skift af filter efterlade "vis flere"-tælleren
  // et vilkårligt sted nede i en liste, brugeren lige har skiftet ud.
  useEffect(() => {
    setAntalVist(SIDESTOERRELSE);
  }, [visKun, filterTekst, stoerrelsesfilter, sortering, virksomheder]);

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
      <section className="card is-working" id="kandidater">
        <div className="section-header">
          <h3>Kandidater</h3>
          <SourceBadge source="cvr" label="CVR-register" />
        </div>
        <KildeVaelger kilde={kilde} onSkift={onSkiftKilde} />
        <Working>Finder virksomheder i markedet…</Working>
        <div style={{ marginTop: 14 }}>
          <SkeletonRows rows={6} />
        </div>
      </section>
    );
  }

  if (status === "fejl") {
    return (
      <section className="card" id="kandidater">
        <div className="section-header">
          <h3>Kandidater</h3>
        </div>
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

  const antalIKlassen = (klasse) => {
    if (!klassefordeling) return null;
    if (klasse === "alle") return markedIalt ?? null;
    if (klasse === "selskab") {
      return (
        klassefordeling.selskab + klassefordeling.flere_adresser + klassefordeling.landsdaekkende
      );
    }
    if (klasse === "flere_adresser") {
      return klassefordeling.flere_adresser + klassefordeling.landsdaekkende;
    }
    return klassefordeling.landsdaekkende;
  };

  // Shortlistede kandidater vises altid, også når de ligger uden for den
  // viste side. To grunde: brugerens egne valg må ikke forsvinde under et
  // "vis flere"-loft, og den printede analyse består netop af shortlisten —
  // en række, der ikke er i DOM'en, kommer heller ikke med på papiret.
  const paaSiden = synlige.slice(0, antalVist);
  const shortlistetUdenfor = synlige.slice(antalVist).filter((v) => shortlisteSet.has(v.cvr));
  const visteRaekker = [...paaSiden, ...shortlistetUdenfor];
  const resterer = synlige.length - visteRaekker.length;

  return (
    <section className="card" id="kandidater">
      <div className="section-header">
        <div>
          <h3>Kandidater til markedsdialog</h3>
          <p className="muted small">
            De største først, målt på antal forretningssteder og selskabsform.{" "}
            {markedIalt != null && virksomheder.length > 0 && (
              <>
                Viser {virksomheder.length.toLocaleString("da-DK")} af{" "}
                {markedIalt.toLocaleString("da-DK")} virksomheder i markedet.
              </>
            )}
          </p>
        </div>
        <SourceBadge source="cvr" label="CVR-register" />
      </div>

      <KildeVaelger kilde={kilde} onSkift={onSkiftKilde} />

      {/* Størrelsesfilteret er det eneste, der udløser et nyt databaseopslag —
          resten filtrerer det hentede. Derfor står det for sig selv. */}
      <div className="kandidat-filter">
        <span className="kandidat-filter__label eyebrow">Størrelse</span>
        <div className="seg" role="group" aria-label="Afgræns markedet efter størrelse">
          {[
            ["alle", "Alle"],
            ["selskab", "Ikke enkeltmand"],
            ["flere_adresser", "Flere adresser"],
            ["landsdaekkende", "10+ adresser"]
          ].map(([vaerdi, etiket]) => {
            const antal = antalIKlassen(vaerdi);
            return (
              <button
                key={vaerdi}
                type="button"
                className={`nav-button ${stoerrelsesfilter === vaerdi ? "active" : ""}`}
                onClick={() => onSkiftStoerrelsesfilter(vaerdi)}
              >
                {etiket}
                {antal != null && <span className="nav-button__tal"> {antal.toLocaleString("da-DK")}</span>}
              </button>
            );
          })}
        </div>
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
          style={{ maxWidth: 220 }}
          placeholder="Filtrér på navn"
          value={filterTekst}
          aria-label="Filtrér kandidater på navn"
          onChange={(e) => setFilterTekst(e.target.value)}
        />

        <div className="field field--inline">
          <label htmlFor="kandidat-sortering" className="muted small">
            Sortér
          </label>
          <select
            id="kandidat-sortering"
            className="input"
            style={{ width: "auto" }}
            value={sortering}
            onChange={(e) => onSkiftSortering(e.target.value)}
          >
            <option value="stoerrelse">Størrelse</option>
            <option value="navn">Navn</option>
          </select>
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

      {!virksomheder.length && (
        <div className="empty-state">
          <span className="empty-state__icon">
            <Icon name="inbox" size={22} />
          </span>
          <h4>Ingen virksomheder i denne størrelse</h4>
          <p className="muted">
            Markedet rummer ingen virksomheder over den valgte grænse. Det er i sig selv
            et svar: skal opgaven udbydes samlet, findes leverandøren ikke i disse
            brancher — prøv en bredere afgrænsning eller flere branchekoder.
          </p>
        </div>
      )}

      {virksomheder.length > 0 && !synlige.length && (
        <p className="muted small" style={{ marginTop: 14 }}>
          Ingen kandidater matcher filteret.
        </p>
      )}

      <ul className="kandidat-liste">
        {visteRaekker.map((v) => {
          const paaShortliste = shortlisteSet.has(v.cvr);
          const beriget = berigelse.get(v.navn);
          const regnskab = beriget?.financials;
          const stiftet = v.startdato ? String(v.startdato).slice(0, 4) : null;

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
                  <Stoerrelsesmaerke
                    klasse={v.stoerrelsesklasse}
                    antalPenheder={v.antalPenheder}
                  />
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
                  {stiftet && ` · stiftet ${stiftet}`}
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

      {resterer > 0 && (
        <div className="kandidat-mere no-print">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setAntalVist((n) => n + SIDESTOERRELSE)}
          >
            Vis {Math.min(SIDESTOERRELSE, resterer)} flere
          </button>
          <span className="muted small">
            {visteRaekker.length} af {synlige.length} vist
          </span>
        </div>
      )}

      <ul className="trace" style={{ marginTop: 14 }}>
        <li>
          <strong>Størrelsen måler udstrækning, ikke omsætning.</strong> CVR udstiller
          hverken ansatte eller omsætning i bulk, så rangeringen bygger på antal aktive
          forretningssteder og selskabsform. En stor arbejdsplads på én adresse ser
          derfor lille ud her — hent nøgletal for shortlisten for at få de rigtige tal.
        </li>
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
