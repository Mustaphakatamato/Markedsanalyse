import { useEffect, useState } from "react";
import { searchByCPV } from "../../services/tedService";
import BrancheVaelger from "../marked/BrancheVaelger";
import Markedsbillede from "../marked/Markedsbillede";
import Icon from "../ui/Icon";
import SourceBadge from "../ui/SourceBadge";
import { SkeletonRows } from "../ui/Loading";
import { formatAmount, formatDanishDate } from "../../lib/format";

// Trin 2 — hvilket marked er det her?
//
// CPV-koden siger hvad der KØBES, branchekoden hvad en virksomhed LAVER, og der
// findes ingen officiel oversættelse mellem dem. Branchevalget er derfor
// ordregiverens — BrancheVaelger foreslår ud fra hvad vinderne i feltet
// faktisk laver, men vælger aldrig selv.
//
// Øverst fire tal, der svarer på "er der et marked, og hvem består det af"
// uden at man skal læse hele markedsbilledet.

function Noegletal({ data, dialog }) {
  const { statistik, koncentration, vindere } = data;
  const ialt = statistik.data?.ialt;
  // Estimat: alt under "10+ adresser". Markedsindekset kender ikke ansatte
  // eller omsætning for hele populationen; de rigtige SMV-tal kommer med
  // nøgletallene i trin 3.
  const smvEstimat =
    koncentration && ialt != null ? ialt - koncentration.antalPrKlasse.landsdaekkende : null;

  const kilde = vindere.data?.kilde;
  const vinderliste = vindere.data?.vindere ?? [];
  const top5 = vinderliste.slice(0, 5).reduce((n, v) => n + v.antalKontrakter, 0);
  const periodeVirker = kilde?.aar != null;

  return (
    <div className="dialog-noegletal">
      <div className="stat">
        <p className="stat__label">Virksomheder i markedet</p>
        <p className="stat__value stat__value--big num">
          {ialt != null ? ialt.toLocaleString("da-DK") : "–"}
        </p>
        <p className="muted small">{dialog.branchekoder.length} brancher valgt</p>
      </div>
      <div className="stat">
        <p className="stat__label">Heraf SMV</p>
        <p className="stat__value stat__value--big num">
          {smvEstimat != null ? smvEstimat.toLocaleString("da-DK") : "–"}
        </p>
        <p className="muted small">Estimat — under 10 forretningssteder</p>
      </div>
      <div className="stat">
        <p className="stat__label">Har vundet EU-udbud i feltet</p>
        <p className="stat__value stat__value--big num">
          {kilde ? kilde.vindereIalt.toLocaleString("da-DK") : vindere.status === "henter" ? "…" : "–"}
        </p>
        <p className="muted small">
          {kilde
            ? periodeVirker
              ? `Seneste ${kilde.aar} år · ${kilde.noticesLaest.toLocaleString("da-DK")} tildelinger`
              : `${kilde.noticesLaest.toLocaleString("da-DK")} nyeste tildelinger`
            : "Fra TED"}
        </p>
      </div>
      <div className="stat">
        <p className="stat__label">Koncentration</p>
        <p className="stat__value stat__value--big num">
          {kilde && kilde.noticesLaest ? `${top5} af ${kilde.noticesLaest}` : "–"}
        </p>
        <p className="muted small">tildelinger vundet af de fem største vindere</p>
      </div>
    </div>
  );
}

function SenesteTildelinger({ cpvKode }) {
  const [notices, setNotices] = useState([]);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!cpvKode) return;
    let annulleret = false;
    setStatus("henter");
    searchByCPV(cpvKode, { limit: 8 })
      .then((data) => {
        if (annulleret) return;
        setNotices(data.notices);
        setStatus("faerdig");
      })
      .catch(() => !annulleret && setStatus("fejl"));
    return () => {
      annulleret = true;
    };
  }, [cpvKode]);

  return (
    <section id="tildelinger" className={`card ${status === "henter" ? "is-working" : ""}`}>
      <div className="section-header">
        <div>
          <h3>Seneste kontrakttildelinger i markedet</h3>
          <p className="muted small">
            Rigtige EU-udbud under {cpvKode}. Viser hvad der faktisk er købt, og til
            hvilke beløb.
          </p>
        </div>
        <SourceBadge source="ted" />
      </div>

      {status === "henter" && <SkeletonRows rows={4} />}
      {status === "fejl" && <p className="muted small">Kunne ikke hente kontrakttildelinger fra TED.</p>}
      {status === "faerdig" && !notices.length && (
        <p className="muted small">Ingen tildelinger fundet. TED dækker kun udbud over EU's tærskelværdi.</p>
      )}

      {notices.length > 0 && (
        <div className="scroll-x">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vinder</th>
                <th>Ordregiver</th>
                <th>Dato</th>
                <th style={{ textAlign: "right" }}>Værdi</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {notices.map((n) => (
                <tr key={n.id}>
                  <td>
                    {n.winnerName || "Ukendt vinder"}
                    {n.isMultiWinner && (
                      <span className="pill" style={{ marginLeft: 6 }}>
                        {n.winnerCount} vindere
                      </span>
                    )}
                  </td>
                  <td className="muted">{n.buyerName || "–"}</td>
                  <td className="num">{formatDanishDate(n.date)}</td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {n.value != null && !n.isMultiWinner
                      ? `${formatAmount(n.value)} ${n.currency || ""}`
                      : n.isMultiWinner
                        ? "rammeaftale"
                        : "–"}
                  </td>
                  <td>
                    {n.url && (
                      <a href={n.url} target="_blank" rel="noreferrer" className="small">
                        Notice <Icon name="external" size={11} />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul className="trace" style={{ marginTop: 12 }}>
        <li>
          For rammeaftaler med flere vindere vises intet beløb: notice'ens værdi er rammens
          samlede loft, ikke hvad den enkelte vinder fik.
        </li>
      </ul>
    </section>
  );
}

export default function TrinMarked({ dialog, opdater, data, onGaaTil }) {
  if (!dialog.cpvKoder.length) {
    return (
      <section className="empty-state">
        <span className="empty-state__icon">
          <Icon name="scales" size={22} />
        </span>
        <h4>Beskriv behovet først</h4>
        <p className="muted">Markedet afgrænses af CPV-koderne, som vælges i trin 1.</p>
        <div className="button-row" style={{ justifyContent: "center" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => onGaaTil("behov")}>
            <Icon name="back" size={13} />
            Til behovet
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      <Noegletal data={data} dialog={dialog} />

      <BrancheVaelger
        cpvKoder={dialog.cpvKoder}
        valgte={dialog.branchekoder}
        onAendret={(branchekoder) => opdater({ branchekoder })}
      />

      {dialog.branchekoder.length > 0 ? (
        <Markedsbillede
          statistik={data.statistik.data}
          koncentration={data.koncentration}
          status={data.statistik.status === "idle" ? null : data.statistik.status}
          fejl={data.statistik.fejl}
          onPrøvIgen={data.proevIgen}
        />
      ) : (
        <section className="empty-state">
          <span className="empty-state__icon">
            <Icon name="scales" size={22} />
          </span>
          <h4>Vælg branchekoder for at se markedet</h4>
          <p className="muted">
            Markedsbilledet bygger på de branchekoder, du bekræfter ovenfor — ikke på
            CPV-koden direkte. Der findes ingen officiel oversættelse mellem de to, så
            valget skal være dit.
          </p>
        </section>
      )}

      <SenesteTildelinger cpvKode={dialog.cpvKoder[0]?.kode} />

      <div className="button-row trin-fod no-print">
        <button className="btn btn-primary" onClick={() => onGaaTil("leverandoerer")}>
          Videre til leverandørerne
          <Icon name="arrow" size={14} />
        </button>
      </div>
    </>
  );
}
