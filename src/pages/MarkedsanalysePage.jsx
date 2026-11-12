// Markedsanalysen — fanen findes, indholdet gør ikke endnu.
//
// Samme stillads-disciplin som BehovsopgoerelsePage: ingen fabrikerede tal,
// ingen attrapper. Siden siger selv, at den er tom.
//
// BEMÆRK om navnet: "Udbud & markedsanalyse" (TenderPage) dækker i dag
// markedsDIALOGEN i fem trin. De to sektioner er altså ikke det samme, selv om
// navnene ligner hinanden — se noten i App.jsx.

export default function MarkedsanalysePage() {
  return (
    <div className="page">
      <header className="section-header">
        <div>
          <p className="eyebrow">Markedsanalyse</p>
          <h2>Hvem er leverandørerne, og hvordan ser markedet ud</h2>
          <p className="lede">
            Her kobles vinderne af sammenlignelige udbud med CVR- og regnskabsdata, så
            markedets størrelse, koncentration og udvikling kan læses af rigtige tal.
          </p>
        </div>
      </header>

      <section className="card">
        <div className="empty-state">
          <p>
            <strong>Sektionen er under opbygning.</strong> Den har endnu ingen datakilder
            koblet til, og der vises derfor ingenting — frem for at vise noget, der ligner
            et resultat.
          </p>
        </div>

        <h4>Hvad den skal rumme</h4>
        <ul>
          <li>Leverandøroverblik med nøgletal pr. virksomhed</li>
          <li>Koncentration (HHI, CR4) og andel af udbud med kun ét bud</li>
          <li>Værdifordeling og udvikling pr. år</li>
          <li>Benchmark: udbudsform, opdeling, kriterier og vægte hos andre ordregivere</li>
          <li>Tjek mod fælles indkøbsaftaler (SKI)</li>
        </ul>
      </section>
    </div>
  );
}
