// Krav til økonomisk og finansiel formåen — og hvem de udelukker.
//
// Ren logik, ingen datahentning: kravsimulatoren regner på de nøgletal,
// markedsdialogen allerede har hentet. Det er pointen, at den er hurtig nok
// til at reagere, mens man trækker i skyderen.
//
// TRE UDFALD, IKKE TO. En leverandør uden regnskabstal (ESEF/IFRS, nystartet,
// eller tallet er bare ikke hentet) er "ukendt" — aldrig "opfylder". Regnede
// vi den med, ville et højt krav se ud til at udelukke færre, end det gør.

import { formatDkkMio, formatPercent } from "../lib/format";

// Udbudslovens § 142, stk. 2: et krav om minimumsomsætning må ikke overstige
// 2 gange den anslåede kontraktværdi (medmindre det begrundes særskilt).
export const LOFT_FAKTOR = 2;

// Årlig værdi = samlet værdi / varighed. Uden varighed regnes værdien som
// årlig, og UI'et siger det — det er det forsigtige valg, fordi det giver et
// lavere omsætningskrav.
export function aarligVaerdi(dialog) {
  const samlet = dialog.anslaaetVaerdi;
  if (!samlet) return null;
  const aar = Number(dialog.behov?.varighedAar) || 1;
  return Math.round(samlet / aar);
}

// Kravet i kroner. Faktoren gemmes frem for beløbet, så kravet følger med,
// hvis værdien rettes i behovet.
export function minimumsomsaetning(dialog) {
  const aarlig = aarligVaerdi(dialog);
  if (!aarlig || !dialog.oekonomikrav?.omsaetningAktiv) return null;
  return Math.round(aarlig * dialog.oekonomikrav.omsaetningFaktor);
}

export function lovensLoft(dialog) {
  return dialog.anslaaetVaerdi ? dialog.anslaaetVaerdi * LOFT_FAKTOR : null;
}

// Vurderer ét krav ad gangen, så UI'et kan vise HVILKET krav der udelukker.
export function vurder(noegletal, dialog) {
  const krav = dialog.oekonomikrav ?? {};
  const delvurderinger = [];

  const minOms = minimumsomsaetning(dialog);
  if (minOms != null) {
    const oms = noegletal?.omsaetning;
    const nedre = noegletal?.omsaetningNedre;
    let status = "ukendt";
    if (oms != null) status = oms >= minOms ? "opfylder" : "falder_fra";
    // Bruttofortjenesten er altid mindre end omsætningen. Er den alene over
    // kravet, er omsætningen det også — men under kravet siger den intet.
    else if (nedre != null && nedre >= minOms) status = "opfylder";
    delvurderinger.push({ krav: "omsaetning", status });
  }

  if (krav.egenkapitalAktiv) {
    const ek = noegletal?.egenkapital;
    delvurderinger.push({
      krav: "egenkapital",
      status: ek == null ? "ukendt" : ek > 0 ? "opfylder" : "falder_fra"
    });
  }

  if (krav.soliditetAktiv) {
    const sol = noegletal?.soliditet;
    delvurderinger.push({
      krav: "soliditet",
      status: sol == null ? "ukendt" : sol >= krav.minSoliditet ? "opfylder" : "falder_fra"
    });
  }

  // Ét krav, der udelukker, afgør sagen — uanset om andre er ukendte.
  const samlet = !delvurderinger.length
    ? "opfylder"
    : delvurderinger.some((d) => d.status === "falder_fra")
      ? "falder_fra"
      : delvurderinger.some((d) => d.status === "ukendt")
        ? "ukendt"
        : "opfylder";

  return { samlet, delvurderinger };
}

export const KRAV_ETIKET = {
  omsaetning: "Omsætning",
  egenkapital: "Positiv egenkapital",
  soliditet: "Soliditetsgrad"
};

// Kravteksten, som den kan stå i udbudsmaterialet. Genereres af valgene, ikke
// af en model: den skal kunne forklares ord for ord, og den skal være ens hver
// gang med de samme valg.
export function kravtekst(dialog, opsummering) {
  const krav = dialog.oekonomikrav ?? {};
  const minOms = minimumsomsaetning(dialog);
  const linjer = [];

  if (minOms != null) {
    linjer.push(
      `Tilbudsgiver skal have haft en årlig nettoomsætning på mindst ${formatDkkMio(minOms)} ` +
        "i det senest afsluttede regnskabsår."
    );
  }
  if (krav.egenkapitalAktiv) {
    linjer.push("Tilbudsgiver skal have haft en positiv egenkapital i det senest afsluttede regnskabsår.");
  }
  if (krav.soliditetAktiv) {
    linjer.push(
      `Tilbudsgiver skal have haft en soliditetsgrad på mindst ${formatPercent(krav.minSoliditet)} ` +
        "i det senest afsluttede regnskabsår."
    );
  }
  if (!linjer.length) return "";

  linjer.push(
    "Tilbudsgiver kan basere sig på andre enheders økonomiske formåen, jf. udbudslovens § 144."
  );

  if (opsummering?.vurderet) {
    linjer.push(
      "",
      "Begrundelse: Kravet er fastsat på baggrund af en markedsanalyse af " +
        `${opsummering.vurderet} sandsynlige tilbudsgivere med offentliggjorte regnskabstal, ` +
        `hvoraf ${opsummering.opfylder} opfylder kravet` +
        (opsummering.smvVurderet
          ? `, herunder ${opsummering.smvOpfylder} af ${opsummering.smvVurderet} SMV'er.`
          : ".") +
        (minOms != null
          ? ` Omsætningskravet svarer til ${formatFaktor(krav.omsaetningFaktor)} den anslåede årlige kontraktværdi.`
          : "")
    );
  }

  return linjer.join("\n");
}

export function formatFaktor(faktor) {
  return `${Number(faktor).toLocaleString("da-DK", { maximumFractionDigits: 2 })} ×`;
}
