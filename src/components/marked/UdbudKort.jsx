import Icon from "../ui/Icon";
import { dageTil, dageSiden, KONTRAKTTYPE } from "../../services/udbudService";
import { formatDanishDate, formatAmount } from "../../lib/format";

// Ét udbudskort. Delt mellem Udbudssøgning (søg selv) og Nye udbud
// (fast overvågning), fordi de viser den SAMME række fra samme tabel — kun
// indgangen til den er forskellig. Lå markupen to steder, ville en rettelse i
// fristmærket eller CPV-listen kun slå igennem på den ene side.

function Fristmaerke({ frist }) {
  const dage = dageTil(frist);
  if (dage == null) return null;

  if (dage < 0) {
    return <span className="pill">frist overskredet</span>;
  }
  // Under en uge er en reel planlægningsbesked, ikke pynt: et udbud med fire
  // dage tilbage kræver en beslutning i dag.
  const haster = dage <= 7;
  return (
    <span className={`pill ${haster ? "pill-warn" : "pill-ok"}`}>
      {dage === 0 ? "frist i dag" : dage === 1 ? "1 dag tilbage" : `${dage} dage tilbage`}
    </span>
  );
}

// Kun på overvågningssiden: dér er alderen på registreringen selve pointen.
// På søgesiden ville den være støj ved siden af fristen, som er det, man
// vælger efter.
function Nymaerke({ registreret }) {
  const dage = dageSiden(registreret);
  if (dage == null) return null;
  return (
    <span className="pill pill-ny" title={`Registreret på udbud.dk ${formatDanishDate(registreret)}`}>
      {dage === 0 ? "ny i dag" : dage === 1 ? "ny i går" : `${dage} dage siden`}
    </span>
  );
}

export default function UdbudKort({ udbud: u, visRegistreret = false, fremhaevedeCpv = [] }) {
  // Hoved-CPV først, derefter de koder der ligger i det overvågede felt, og
  // til sidst resten. Uden det kan kortet vise seks tilfældige koder, hvor
  // ingen af dem er den, der fik udbuddet med på listen.
  const iFelt = (kode) => fremhaevedeCpv.some((p) => kode.startsWith(p));
  const koder = [...u.cpvKoder].sort((a, b) => {
    if (a === u.cpvHoved) return -1;
    if (b === u.cpvHoved) return 1;
    return Number(iFelt(b)) - Number(iFelt(a));
  });

  return (
    <li className="udbud-kort">
      <div className="udbud-kort__top">
        <h4 className="udbud-kort__titel">{u.titel || "Uden titel"}</h4>
        <div className="tag-row">
          {visRegistreret && <Nymaerke registreret={u.registreret} />}
          <Fristmaerke frist={u.frist} />
          {u.kilde === "DKUDBUD" && (
            <span className="pill" title="Dansk udbud under EU's tærskelværdi — findes ikke i TED">
              kun dansk
            </span>
          )}
          {u.art !== "udbud" && (
            <span className="pill">
              {u.art === "forhaandsmeddelelse" ? "forhåndsmeddelelse" : u.art}
            </span>
          )}
        </div>
      </div>

      <p className="udbud-kort__meta muted small">
        {u.ordregiver || "Ukendt ordregiver"}
        {u.kontrakttype && ` · ${KONTRAKTTYPE[u.kontrakttype] ?? u.kontrakttype}`}
        {u.frist && ` · frist ${formatDanishDate(u.frist)}`}
        {u.anslaaetVaerdi != null && u.anslaaetVaerdi > 0 &&
          ` · anslået ${formatAmount(u.anslaaetVaerdi, u.valuta)}`}
      </p>

      {u.beskrivelse && (
        <p className="udbud-kort__beskrivelse small">
          {u.beskrivelse.length > 260 ? `${u.beskrivelse.slice(0, 260)}…` : u.beskrivelse}
        </p>
      )}

      <div className="tag-row">
        {koder.slice(0, 6).map((k) => (
          <span
            className={`tag tag--code ${k === u.cpvHoved ? "tag--hoved" : ""} ${
              iFelt(k) ? "tag--traf" : ""
            }`}
            key={k}
            title={
              k === u.cpvHoved
                ? "Hoved-CPV"
                : iFelt(k)
                  ? "Ligger i et overvåget felt"
                  : "Supplerende CPV"
            }
          >
            {k}
          </span>
        ))}
        {koder.length > 6 && <span className="tag">+{koder.length - 6}</span>}
      </div>

      <div className="button-row">
        {u.dokumentUrl && (
          <a className="btn btn-secondary btn-sm" href={u.dokumentUrl} target="_blank" rel="noreferrer">
            Udbudsmateriale
            <Icon name="external" size={12} />
          </a>
        )}
        {u.publikationsnummer && (
          <a
            className="btn btn-ghost btn-sm"
            href={`https://ted.europa.eu/en/notice/-/detail/${u.publikationsnummer}`}
            target="_blank"
            rel="noreferrer"
          >
            Notice i TED
            <Icon name="external" size={12} />
          </a>
        )}
      </div>
    </li>
  );
}
