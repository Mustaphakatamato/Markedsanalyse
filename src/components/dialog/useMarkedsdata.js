import { useEffect, useMemo, useRef, useState } from "react";
import {
  hentMarkedsstatistik,
  soegMarked,
  hentVindere,
  beregnKoncentration
} from "../../services/markedService";
import {
  samlLeverandoerer,
  hentNoegletalForMange,
  ANTAL_SANDSYNLIGE
} from "../../services/leverandoerService";

// Al markedsdata for én markedsdialog, hentet ét sted.
//
// HVORFOR I ARBEJDSOMRÅDET OG IKKE I HVERT TRIN: trin 2, 3, 4 og 5 læser af
// de samme tre opslag. Lå de i trinene, ville hvert skift mellem dem koste et
// nyt opslag — og kravsimulatoren i trin 4 skal regne på nøjagtig den liste,
// man lige har set i trin 3.
//
// cancelled-mønstret beskytter mod at et langsomt svar fra et tidligere sæt
// koder overskriver et nyere; ordregiveren retter ofte koderne flere gange.

function useOpslag(noegle, hent) {
  const [tilstand, setTilstand] = useState({ status: "idle", data: null, fejl: null });

  useEffect(() => {
    if (noegle == null) {
      setTilstand({ status: "idle", data: null, fejl: null });
      return;
    }
    let annulleret = false;
    setTilstand((t) => ({ ...t, status: "henter", fejl: null }));
    hent()
      .then((data) => !annulleret && setTilstand({ status: "faerdig", data, fejl: null }))
      .catch(
        (err) =>
          !annulleret &&
          setTilstand({ status: "fejl", data: null, fejl: err.message || "Opslaget fejlede." })
      );
    return () => {
      annulleret = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noegle]);

  return tilstand;
}

export default function useMarkedsdata(dialog, gemRegnskaber) {
  // Tælles op af "Prøv igen". Uden den ville et gentaget forsøg ikke ændre
  // nogen nøgle, og knappen ville se ud som om den virkede uden at gøre noget.
  const [forsoeg, setForsoeg] = useState(0);

  const branchekoder = dialog.branchekoder.map((b) => b.kode);
  const cpvKoder = dialog.cpvKoder.map((c) => c.kode);
  const branchenoegle = branchekoder.length
    ? `${branchekoder.join(",")}|${dialog.kommunekoder.join(",")}|${forsoeg}`
    : null;
  const vindernoegle = cpvKoder.length ? `${cpvKoder.join(",")}|${dialog.periodeAar}|${forsoeg}` : null;

  // Markedsbilledet afhænger kun af branchekoderne og geografien. Det skal
  // stå som markedets sande sammensætning, uanset hvordan listen filtreres.
  const statistik = useOpslag(branchenoegle, () =>
    hentMarkedsstatistik(branchekoder, { kommunekoder: dialog.kommunekoder })
  );

  // De 200 største i markedet. Afgrænsningen sker i databasen, fordi de store
  // udgør få procent af et marked — 200 vilkårlige rækker ville rumme ca. otte
  // af dem (se markedService.soegMarked).
  const kandidater = useOpslag(branchenoegle, () =>
    soegMarked(branchekoder, { kommunekoder: dialog.kommunekoder, maks: 200 })
  );

  // Vinderne hænger på CPV-koderne, ikke på branchekoderne: en tildeling er
  // registreret på hvad der blev KØBT, ikke på hvad vinderen laver til daglig.
  const vindere = useOpslag(vindernoegle, () =>
    hentVindere(cpvKoder, { top: 50, aar: dialog.periodeAar })
  );

  const leverandoerer = useMemo(
    () =>
      samlLeverandoerer({
        kandidater: kandidater.data ?? [],
        vindere: vindere.data?.vindere ?? [],
        dialog
      }),
    // dialog ændrer identitet ved hver gemning; kun disse felter påvirker listen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      kandidater.data,
      vindere.data,
      dialog.branchekoder,
      dialog.behov?.geografi,
      dialog.behov?.nuvaerende?.cvr
    ]
  );

  // De sandsynlige tilbudsgivere: de øverste på listen plus alt på
  // shortlisten. Det er dem, der hentes nøgletal for, og dem kravsimulatoren
  // regner på — shortlisten med, fordi det er ordregiverens eget valg.
  const sandsynlige = useMemo(() => {
    const shortliste = new Set(dialog.shortliste);
    const top = leverandoerer.slice(0, ANTAL_SANDSYNLIGE);
    const ekstra = leverandoerer.slice(ANTAL_SANDSYNLIGE).filter((l) => shortliste.has(l.cvr));
    return [...top, ...ekstra];
  }, [leverandoerer, dialog.shortliste]);

  // ------------------------------------------------------- nøgletal
  // Hentes automatisk for de sandsynlige, så snart listen står færdig. Hvert
  // opslag koster to kald mod Erhvervsstyrelsen og ét mod CVR, og resultatet
  // gemmes i dialogen — et refresh henter ikke det samme igen.
  const [henter, setHenter] = useState(() => new Set());
  const igang = useRef(new Set());

  const hentFor = (cvrNumre) => {
    const mangler = cvrNumre.filter((c) => c && !dialog.regnskaber[c] && !igang.current.has(c));
    if (!mangler.length) return;
    mangler.forEach((c) => igang.current.add(c));
    setHenter(new Set(igang.current));
    hentNoegletalForMange(mangler, (cvr, tal) => {
      igang.current.delete(cvr);
      setHenter(new Set(igang.current));
      gemRegnskaber({ [cvr]: tal });
    });
  };

  const listeKlar =
    kandidater.status !== "henter" &&
    vindere.status !== "henter" &&
    (kandidater.status === "faerdig" || vindere.status === "faerdig");

  const sandsynligeNoegle = sandsynlige.map((l) => l.cvr).filter(Boolean).join(",");
  useEffect(() => {
    if (!listeKlar) return;
    hentFor(sandsynlige.map((l) => l.cvr));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listeKlar, sandsynligeNoegle]);

  return {
    statistik,
    koncentration: beregnKoncentration(statistik.data),
    kandidater,
    vindere,
    leverandoerer,
    sandsynlige,
    listeKlar,
    henterNoegletal: henter,
    hentNoegletal: hentFor,
    proevIgen: () => setForsoeg((n) => n + 1)
  };
}
