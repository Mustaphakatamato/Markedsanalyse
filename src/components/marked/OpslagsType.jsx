// Skiftet mellem de to slags opslag på virksomhedssiden.
//
// HVORFOR ÉT FLOW OG IKKE TO SIDER: det er samme spørgsmål stillet fra hver
// sin side af bordet — "hvem er denne aktør, og hvad har de gjort i udbud".
// Leverandøren måles på hvad de har VUNDET, ordregiveren på hvad de har
// UDBUDT, men indgangen er den samme: et navn eller et CVR-nummer. To
// menupunkter ville tvinge brugeren til at vide hvilken slags aktør de leder
// efter, før de har slået den op.
//
// Skiftet står øverst i konsollen, over overskriften, fordi det ændrer hvad
// hele siden handler om — ikke bare hvordan resultatet sorteres.

export const OPSLAGSTYPER = [
  { vaerdi: "leverandoer", etiket: "Leverandør", beskrivelse: "vundne udbud, økonomi, risiko" },
  { vaerdi: "ordregiver", etiket: "Ordregiver", beskrivelse: "offentliggjorte udbud" }
];

export default function OpslagsType({ vaerdi, onVaelg }) {
  return (
    <div className="opslagstype">
      <div className="seg" role="group" aria-label="Hvilken slags aktør slår du op?">
        {OPSLAGSTYPER.map((t) => (
          <button
            key={t.vaerdi}
            type="button"
            className={`nav-button ${vaerdi === t.vaerdi ? "active" : ""}`}
            aria-pressed={vaerdi === t.vaerdi}
            onClick={() => onVaelg(t.vaerdi)}
          >
            {t.etiket}
          </button>
        ))}
      </div>
    </div>
  );
}
