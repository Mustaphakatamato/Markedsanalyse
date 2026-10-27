import Icon from "../ui/Icon";

// Markedsdialogens fem trin.
//
// IKKE EN LÅST GUIDE. En markedsanalyse laves ikke i ét stræk: man vender
// tilbage, retter branchekoder når markedsbilledet ser forkert ud, og udvider
// shortlisten efter en samtale. Alle trin kan derfor vælges hele tiden;
// bjælken viser kun, hvor langt man er nået. Et trin uden grundlag siger selv,
// hvilket trin der mangler.

export const TRIN = [
  { id: "behov", nr: 1, titel: "Behov" },
  { id: "marked", nr: 2, titel: "Marked" },
  { id: "leverandoerer", nr: 3, titel: "Leverandører" },
  { id: "oekonomi", nr: 4, titel: "Økonomisk formåen" },
  { id: "bilag", nr: 5, titel: "Bilag" }
];

// tom → igang → klar. "Klar" betyder at trinnets kerneoutput findes, ikke at
// det er godkendt af nogen — appen kan ikke vide, om analysen er god nok.
export function trinStatus(dialog) {
  const harBehov = !!dialog.behov?.hvad?.trim();
  const harCpv = dialog.cpvKoder.length > 0;
  const harBrancher = dialog.branchekoder.length > 0;
  const harShortliste = dialog.shortliste.length > 0;
  const harVaerdi = dialog.anslaaetVaerdi != null;
  const harTal = Object.values(dialog.regnskaber ?? {}).some((r) => r.status === "ok");

  return {
    behov: harCpv ? "klar" : harBehov ? "igang" : "tom",
    marked: harBrancher ? "klar" : harCpv ? "igang" : "tom",
    leverandoerer: harShortliste ? "klar" : harCpv || harBrancher ? "igang" : "tom",
    oekonomi: harVaerdi && harTal ? "klar" : harTal || harVaerdi ? "igang" : "tom",
    bilag: harShortliste && harBrancher ? "klar" : "tom"
  };
}

const STATUS_TEKST = { tom: "ikke startet", igang: "i gang", klar: "klar" };

export default function Trinbjaelke({ aktivt, status, onVaelg }) {
  return (
    <nav className="trinbjaelke no-print" aria-label="Markedsdialogens trin">
      <ol>
        {TRIN.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className={`trin trin--${status[t.id]}`}
              aria-current={aktivt === t.id ? "step" : undefined}
              onClick={() => onVaelg(t.id)}
            >
              <span className="trin__nr" aria-hidden="true">
                {status[t.id] === "klar" ? <Icon name="check" size={12} /> : t.nr}
              </span>
              <span className="trin__titel">{t.titel}</span>
              <span className="sr-only">, {STATUS_TEKST[status[t.id]]}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
