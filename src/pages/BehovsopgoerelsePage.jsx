// Behovsopgørelsen — fanen findes, indholdet gør ikke endnu.
//
// Siden er bevidst et STILLADS og siger det selv. Et tomt flow, der ligner et
// færdigt flow, er værre end intet: appens hele præmis er, at man kan se hvor
// tallene kommer fra, og en side med pladsholder-indhold ville bryde netop
// det. Derfor ingen fabrikerede tal og ingen attrapper — kun hvad sektionen
// skal rumme, så den kan fyldes ud ét trin ad gangen.

export default function BehovsopgoerelsePage() {
  return (
    <div className="page">
      <header className="section-header">
        <div>
          <p className="eyebrow">Behovsopgørelse</p>
          <h2>Fra interviews til et prioriteret behovsregister</h2>
          <p className="lede">
            Her samles det, der går forud for markedsafdækningen: hvad ordregiveren har
            udbudt før, hvilke krav der stod i det forrige materiale, og hvad
            interessenterne faktisk har brug for.
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
          <li>Projektopstart: nuværende kontrakt, leverandør, værdi og udløb</li>
          <li>Krav udtrukket ordret af det forrige udbudsmateriale</li>
          <li>Interviewguides pr. interessentgruppe</li>
          <li>Behovsnoter med citat og kilde, ét behov pr. note</li>
          <li>Behovssyntese: klynger, konflikter og prioritering</li>
        </ul>
      </section>
    </div>
  );
}
