import { useMemo, useState } from "react";
import { smvStatus } from "../../services/leverandoerService";
import {
  aarligVaerdi,
  minimumsomsaetning,
  lovensLoft,
  vurder,
  kravtekst,
  formatFaktor,
  KRAV_ETIKET,
  LOFT_FAKTOR
} from "../../services/oekonomikrav";
import Icon from "../ui/Icon";
import { Working } from "../ui/Loading";
import { formatDkkMio, formatPercent } from "../../lib/format";

// Trin 4 — krav til økonomisk og finansiel formåen.
//
// En simulator, ikke en anbefaling: ordregiveren skruer på kravet og ser med
// det samme, hvor mange af de sandsynlige tilbudsgivere — og hvor mange
// SMV'er — der falder fra. Det er det tal, et krav skal begrundes med, og det
// tal, man ellers først opdager, når der kommer for få tilbud.
//
// Skyderen er i faktorer af den ÅRLIGE kontraktværdi, fordi det er sådan
// kravet typisk formuleres. Lovens loft er 2 × den SAMLEDE værdi og står som
// en markering på skalaen, når den ligger inden for den.

const MAKS_FAKTOR = 3;

function Optaelling({ etiket, opfylder, ialt, ukendt }) {
  return (
    <div className="stat">
      <p className="stat__label">{etiket}</p>
      <p className="stat__value stat__value--big num">
        {opfylder} <span className="stat__af">af {ialt}</span>
      </p>
      <p className="muted small">
        opfylder kravet{ukendt ? ` · ${ukendt} kan ikke afgøres` : ""}
      </p>
    </div>
  );
}

export default function TrinOekonomi({ dialog, opdater, data, onGaaTil }) {
  const [kopieret, setKopieret] = useState(false);
  const krav = dialog.oekonomikrav;
  const saetKrav = (felter) => opdater({ oekonomikrav: { ...krav, ...felter } });

  const aarlig = aarligVaerdi(dialog);
  const minOms = minimumsomsaetning(dialog);
  const loft = lovensLoft(dialog);
  const loftFaktor = aarlig && loft ? loft / aarlig : null;
  const overLoft = minOms != null && loft != null && minOms > loft;

  // Kun leverandører med CVR kan have regnskabstal. De uden (udenlandske
  // vindere) tælles ikke med — de er hverken opfyldt eller udelukket.
  const vurderinger = useMemo(
    () =>
      data.sandsynlige
        .filter((l) => l.cvr)
        .map((l) => {
          const tal = dialog.regnskaber[l.cvr];
          return {
            lev: l,
            tal,
            smv: smvStatus(l, tal),
            ...vurder(tal?.status === "ok" ? tal : null, dialog)
          };
        }),
    [data.sandsynlige, dialog]
  );

  const tael = (liste) => ({
    ialt: liste.length,
    opfylder: liste.filter((v) => v.samlet === "opfylder").length,
    falder: liste.filter((v) => v.samlet === "falder_fra").length,
    ukendt: liste.filter((v) => v.samlet === "ukendt").length
  });
  const alle = tael(vurderinger);
  const smv = tael(vurderinger.filter((v) => v.smv === "smv" || v.smv === "smv_estimat"));

  const opsummering = {
    vurderet: alle.opfylder + alle.falder,
    opfylder: alle.opfylder,
    smvVurderet: smv.opfylder + smv.falder,
    smvOpfylder: smv.opfylder
  };
  const tekst = kravtekst(dialog, opsummering);

  if (!dialog.cpvKoder.length) {
    return (
      <section className="empty-state">
        <span className="empty-state__icon">
          <Icon name="scales" size={22} />
        </span>
        <h4>Find markedet først</h4>
        <p className="muted">Kravet vurderes mod leverandørerne i markedet, og dem finder trin 1–3.</p>
        <div className="button-row" style={{ justifyContent: "center" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => onGaaTil("behov")}>
            <Icon name="back" size={13} />
            Til behovet
          </button>
        </div>
      </section>
    );
  }

  const grupper = [
    ["falder_fra", "Falder fra"],
    ["ukendt", "Kan ikke afgøres ud fra regnskabet"],
    ["opfylder", "Opfylder"]
  ];

  return (
    <>
      <section className="card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Trin 4 · Økonomisk og finansiel formåen</p>
            <h3>Hvilket krav kan markedet bære?</h3>
            <p className="muted small">
              Skru på kravet og se, hvem af de {vurderinger.length} sandsynlige tilbudsgivere
              der falder fra. Tallene er fra deres seneste indberettede årsregnskab.
            </p>
          </div>
        </div>

        <div className="krav-liste">
          <div className="krav">
            <label className="krav__til">
              <input
                type="checkbox"
                checked={krav.omsaetningAktiv}
                onChange={(e) => saetKrav({ omsaetningAktiv: e.target.checked })}
              />
              <span>Minimumsomsætning</span>
            </label>

            {!aarlig ? (
              <p className="muted small">
                Kræver en anslået kontraktværdi.{" "}
                <button type="button" className="link-knap" onClick={() => onGaaTil("behov")}>
                  Angiv den i behovet
                </button>
                .
              </p>
            ) : (
              krav.omsaetningAktiv && (
                <div className="krav__styring">
                  <div className="krav__vaerdi">
                    <span className="num krav__beloeb">{formatDkkMio(minOms)}</span>
                    <span className="muted small">
                      {formatFaktor(krav.omsaetningFaktor)} årlig værdi ({formatDkkMio(aarlig)}
                      {!dialog.behov?.varighedAar && " — varighed ikke angivet, regnet som ét år"})
                    </span>
                  </div>
                  <div className="krav__skala">
                    <input
                      type="range"
                      min={0.25}
                      max={MAKS_FAKTOR}
                      step={0.25}
                      value={krav.omsaetningFaktor}
                      aria-label="Minimumsomsætning som faktor af den årlige kontraktværdi"
                      onChange={(e) => saetKrav({ omsaetningFaktor: Number(e.target.value) })}
                    />
                    {loftFaktor != null && loftFaktor <= MAKS_FAKTOR && (
                      <span
                        className="krav__loft"
                        style={{ left: `${((loftFaktor - 0.25) / (MAKS_FAKTOR - 0.25)) * 100}%` }}
                        title={`Lovens loft: ${LOFT_FAKTOR} × den samlede kontraktværdi`}
                      >
                        § 142
                      </span>
                    )}
                  </div>
                  <p className="muted small">
                    Lovens loft: {formatDkkMio(loft)} ({LOFT_FAKTOR} × den samlede kontraktværdi,
                    udbudslovens § 142, stk. 2).
                  </p>
                  {overLoft && (
                    <p className="krav__advarsel small">
                      <Icon name="alert" size={13} /> Kravet ligger over lovens loft og skal
                      begrundes særskilt i udbudsmaterialet.
                    </p>
                  )}
                </div>
              )
            )}
          </div>

          <div className="krav">
            <label className="krav__til">
              <input
                type="checkbox"
                checked={krav.egenkapitalAktiv}
                onChange={(e) => saetKrav({ egenkapitalAktiv: e.target.checked })}
              />
              <span>Positiv egenkapital</span>
            </label>
          </div>

          <div className="krav">
            <label className="krav__til">
              <input
                type="checkbox"
                checked={krav.soliditetAktiv}
                onChange={(e) => saetKrav({ soliditetAktiv: e.target.checked })}
              />
              <span>Soliditetsgrad</span>
            </label>
            {krav.soliditetAktiv && (
              <div className="krav__styring">
                <div className="krav__vaerdi">
                  <span className="num krav__beloeb">≥ {formatPercent(krav.minSoliditet)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={5}
                  value={krav.minSoliditet}
                  aria-label="Mindste soliditetsgrad i procent"
                  onChange={(e) => saetKrav({ minSoliditet: Number(e.target.value) })}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card" aria-live="polite">
        <div className="section-header">
          <div>
            <h3>Konsekvens</h3>
            <p className="muted small">
              Leverandører, hvor regnskabet ikke afgør sagen, tælles for sig og regnes aldrig
              som opfyldt. Mange mindre selskaber oplyser kun bruttofortjeneste — den er altid
              lavere end omsætningen, så den kan vise at et krav er opfyldt, men aldrig at det
              ikke er.
            </p>
          </div>
        </div>

        {data.henterNoegletal.size > 0 && (
          <p className="small">
            <Working>Henter nøgletal for {data.henterNoegletal.size} leverandører — tallene opdateres løbende…</Working>
          </p>
        )}

        <div className="dialog-noegletal dialog-noegletal--to">
          <Optaelling etiket="Sandsynlige tilbudsgivere" {...alle} />
          <Optaelling etiket="Heraf SMV'er" {...smv} />
        </div>

        {grupper.map(([status, titel]) => {
          const liste = vurderinger.filter((v) => v.samlet === status);
          if (!liste.length) return null;
          return (
            <details key={status} className="krav-gruppe" open={status === "falder_fra"}>
              <summary>
                {titel} <span className="num muted">({liste.length})</span>
              </summary>
              <ul className="krav-gruppe__liste">
                {liste.map((v) => (
                  <li key={v.lev.cvr}>
                    <span>{v.lev.navn}</span>
                    <span className="muted small">
                      {v.tal?.status === "ok"
                        ? [
                            v.tal.omsaetning != null
                              ? `oms. ${formatDkkMio(v.tal.omsaetning)}`
                              : v.tal.omsaetningNedre != null
                                ? `bruttofortj. ${formatDkkMio(v.tal.omsaetningNedre)}`
                                : "ingen omsætning oplyst",
                            `EK ${formatDkkMio(v.tal.egenkapital)}`,
                            `sol. ${formatPercent(v.tal.soliditet)}`
                          ].join(" · ")
                        : v.tal
                          ? "ingen tal i regnskabet"
                          : "nøgletal ikke hentet"}
                    </span>
                    {status === "falder_fra" && (
                      <span className="krav-gruppe__grund small">
                        {v.delvurderinger
                          .filter((d) => d.status === "falder_fra")
                          .map((d) => KRAV_ETIKET[d.krav])
                          .join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </section>

      {tekst && (
        <section className="card">
          <div className="section-header">
            <div>
              <h3>Udkast til kravtekst</h3>
              <p className="muted small">
                Dannet ud fra valgene ovenfor — ikke af AI. Ret den til i udbudsmaterialet.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                navigator.clipboard?.writeText(tekst).then(() => {
                  setKopieret(true);
                  setTimeout(() => setKopieret(false), 2000);
                });
              }}
            >
              <Icon name={kopieret ? "check" : "doc"} size={13} />
              {kopieret ? "Kopieret" : "Kopiér"}
            </button>
          </div>
          <pre className="kravtekst">{tekst}</pre>
        </section>
      )}

      <div className="button-row trin-fod no-print">
        <button className="btn btn-primary" onClick={() => onGaaTil("bilag")}>
          Videre til bilaget
          <Icon name="arrow" size={14} />
        </button>
      </div>
    </>
  );
}
