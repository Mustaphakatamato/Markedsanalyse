// Skiftet mellem markedsanalysens to kandidatkilder.
//
// De to lister svarer på hver sit spørgsmål, og valget mellem dem er en
// faglig beslutning — derfor står forskellen skrevet i UI'et og ikke kun i
// koden:
//
//   CVR      hele markedet, også dem der aldrig har budt. Det er den eneste
//            liste, der kan bære "opdel eller forklar", fordi den viser
//            markedets sammensætning.
//   TED      dem der har vundet en kontrakt hos en dansk ordregiver. Stærkest
//            signal om kapacitet, men blind for alle under EU's tærskelværdi.
//
// Deles af Kandidatliste og Vinderliste, så skiftet står præcis samme sted i
// begge og ikke flytter sig, når man skifter.

export default function KildeVaelger({ kilde, onSkift }) {
  return (
    <div className="kilde-vaelger">
      <div className="seg" role="group" aria-label="Vælg hvor kandidaterne kommer fra">
        <button
          type="button"
          className={`nav-button ${kilde === "cvr" ? "active" : ""}`}
          onClick={() => onSkift("cvr")}
        >
          Hele markedet
        </button>
        <button
          type="button"
          className={`nav-button ${kilde === "vindere" ? "active" : ""}`}
          onClick={() => onSkift("vindere")}
        >
          Har vundet før
        </button>
      </div>
      <p className="muted small kilde-vaelger__forklaring">
        {kilde === "vindere"
          ? "Vindere af danske kontrakttildelinger i CPV-feltet, fra TED. Viser kapacitet, men kun over EU's tærskelværdi."
          : "Alle aktive virksomheder i de valgte brancher, fra CVR. Viser markedets sammensætning, men ikke hvem der kan løfte opgaven."}
      </p>
    </div>
  );
}
