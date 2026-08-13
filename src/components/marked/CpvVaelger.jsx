import { useEffect, useId, useRef, useState } from "react";
import { soegCpv } from "../../services/cpvService";
import Icon from "../ui/Icon";
import { Working } from "../ui/Loading";

// Vælger CPV-koder til et udbud — flere ad gangen, søgt mod de 9.454
// officielle danske betegnelser.
//
// HVORFOR FLERE KODER: et udbud dækker sjældent præcis én CPV-kode. Et
// IT-driftsudbud rammer både 72222300 og 72400000, og markedet er foreningen
// af dem. Den gamle side tvang ét valg fra en dropdown med fire koder.
//
// HVORFOR BETEGNELSEN GEMMES MED: den skal med i dokumentationen, og den skal
// være den officielle. Gemte man kun koden, ville UI'et skulle slå op igen
// hver gang — og v1's opdigtede betegnelser viste, hvor galt det går, når de
// skrives af i hånden.
//
// TASTATUR: pil op/ned vælger, Enter tilføjer, Escape lukker. Det er ikke
// pynt — en ordregiver taster ofte flere koder i træk, og at skulle gribe
// musen mellem hver er den slags friktion, der får folk til at nøjes med én.

export default function CpvVaelger({ valgte, onAendret, autoFokus = false }) {
  const [soegetekst, setSoegetekst] = useState("");
  const [traf, setTraf] = useState([]);
  const [aaben, setAaben] = useState(false);
  const [henter, setHenter] = useState(false);
  const [fejl, setFejl] = useState(null);
  const [markeret, setMarkeret] = useState(0);

  const boksRef = useRef(null);
  const inputRef = useRef(null);
  // Beskytter mod at et langsomt, forældet svar overskriver et nyere — samme
  // problem som navnesøgningen i CompanyLookupPage.
  const kaldRef = useRef(0);
  const listeId = useId();

  const valgteKoder = new Set(valgte.map((v) => v.kode));

  useEffect(() => {
    if (autoFokus) inputRef.current?.focus();
  }, [autoFokus]);

  useEffect(() => {
    const tekst = soegetekst.trim();
    if (tekst.length < 2) {
      setTraf([]);
      setHenter(false);
      return;
    }

    setHenter(true);
    const timer = setTimeout(async () => {
      const id = ++kaldRef.current;
      try {
        const resultat = await soegCpv(tekst, { maks: 12 });
        if (id !== kaldRef.current) return;
        setTraf(resultat);
        setMarkeret(0);
        setFejl(null);
      } catch (err) {
        if (id !== kaldRef.current) return;
        setFejl(err.message || "CPV-søgningen fejlede.");
        setTraf([]);
      } finally {
        if (id === kaldRef.current) setHenter(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [soegetekst]);

  // Luk ved klik udenfor. mousedown frem for blur, så et klik PÅ et forslag
  // når at køre sin onClick først.
  useEffect(() => {
    function udenfor(e) {
      if (boksRef.current && !boksRef.current.contains(e.target)) setAaben(false);
    }
    document.addEventListener("mousedown", udenfor);
    return () => document.removeEventListener("mousedown", udenfor);
  }, []);

  const tilfoej = (kode) => {
    if (valgteKoder.has(kode.kode)) return;
    onAendret([...valgte, { kode: kode.kode, tekst: kode.tekst }]);
    setSoegetekst("");
    setTraf([]);
    setAaben(false);
    inputRef.current?.focus();
  };

  const fjern = (kode) => onAendret(valgte.filter((v) => v.kode !== kode));

  const paaTast = (e) => {
    if (!aaben || !traf.length) {
      if (e.key === "ArrowDown" && traf.length) setAaben(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMarkeret((i) => (i + 1) % traf.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMarkeret((i) => (i - 1 + traf.length) % traf.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      tilfoej(traf[markeret]);
    } else if (e.key === "Escape") {
      setAaben(false);
    }
  };

  return (
    <div className="cpv-vaelger">
      <div className="search-field" ref={boksRef}>
        <label htmlFor={`${listeId}-input`}>CPV-koder</label>
        <div className="search-field__control">
          <Icon name="search" size={16} className="search-field__icon" />
          <input
            id={`${listeId}-input`}
            ref={inputRef}
            className="input"
            placeholder="Søg på betegnelse eller kode — fx rengøring eller 90910000"
            value={soegetekst}
            autoComplete="off"
            role="combobox"
            aria-expanded={aaben && traf.length > 0}
            aria-controls={`${listeId}-liste`}
            aria-activedescendant={
              aaben && traf.length ? `${listeId}-mulighed-${markeret}` : undefined
            }
            onChange={(e) => {
              setSoegetekst(e.target.value);
              setAaben(true);
            }}
            onFocus={() => traf.length && setAaben(true)}
            onKeyDown={paaTast}
          />
        </div>

        {aaben && traf.length > 0 && (
          <ul className="suggestions-list" id={`${listeId}-liste`} role="listbox">
            {traf.map((t, i) => {
              const alleredeValgt = valgteKoder.has(t.kode);
              return (
                <li key={t.kode}>
                  <button
                    type="button"
                    id={`${listeId}-mulighed-${i}`}
                    role="option"
                    aria-selected={i === markeret}
                    className={i === markeret ? "is-marked" : undefined}
                    disabled={alleredeValgt}
                    onMouseEnter={() => setMarkeret(i)}
                    onClick={() => tilfoej(t)}
                  >
                    <span className="cpv-forslag">
                      <span className="cpv-forslag__tekst">{t.tekst}</span>
                      {t.overordnetTekst && (
                        <span className="cpv-forslag__sti muted small">
                          under {t.overordnetTekst}
                        </span>
                      )}
                    </span>
                    <span className="mono small">
                      {alleredeValgt ? "valgt" : t.kode}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="small muted" style={{ margin: "6px 0 0" }} aria-live="polite">
        {fejl ? (
          <span className="tone-alert">{fejl}</span>
        ) : henter ? (
          <Working>Søger i CPV-nomenklaturen…</Working>
        ) : soegetekst.trim().length === 1 ? (
          "Skriv mindst to tegn."
        ) : soegetekst.trim().length >= 2 && !traf.length ? (
          "Ingen koder matcher. Prøv et bredere ord, fx “rengøring” frem for “vinduespudsning”."
        ) : (
          "Vælg gerne flere. Markedet bliver foreningen af de valgte koder."
        )}
      </p>

      {valgte.length > 0 && (
        <ul className="kode-chips" style={{ marginTop: 12 }}>
          {valgte.map((v) => (
            <li key={v.kode}>
              <span className="kode-chip">
                <span className="kode-chip__kode mono">{v.kode}</span>
                <span className="kode-chip__tekst">{v.tekst || "Betegnelse ikke hentet"}</span>
                <button
                  type="button"
                  className="kode-chip__fjern"
                  onClick={() => fjern(v.kode)}
                  aria-label={`Fjern ${v.kode} ${v.tekst || ""}`}
                >
                  <Icon name="plus" size={12} style={{ transform: "rotate(45deg)" }} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
