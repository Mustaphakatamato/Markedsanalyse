// CPV-hierarkiet, som klienten skal kunne regne på.
//
// Reglen bor i databasen — public.cpv_praefiks() i
// supabase/migrations/20260814160000_udbud_dk_bekendtgoerelser.sql — og
// gentages her, fordi UI'et er nødt til at kunne svare på "dækker denne kode
// allerede den anden?" UDEN et databasekald. Holder de to sig ikke ens, viser
// listen noget andet end søgningen finder, og det er præcis den slags fejl,
// der ligner et tomt resultat frem for en fejl. Ændres den ene, skal den
// anden ændres samme dag.

// Koden uden efterstillede nuller: 72000000 -> '72', 48326100 -> '483261'.
// Et suffiks efter bindestreg (CPV-tillægskoder som "72000000-5") hører ikke
// til hierarkiet og klippes af.
export function cpvPraefiks(kode) {
  if (typeof kode !== "string") return null;
  const rå = kode.trim().split("-")[0];
  const uden = rå.replace(/0+$/, "");
  // En kode af rene nuller ville give tom streng og dermed matche ALT. Den
  // findes ikke i CPV, men afvisningen koster intet.
  return uden || null;
}

// Er `kode` dækket af en af `andre`? En kode er dækket, når en ANDEN, bredere
// kode i sættet er dens præfiks: vælger man 72000000 (præfiks '72'), er
// 72212100 ('722121') med i forvejen, fordi søgningen matcher '72%'.
export function daekkesAf(kode, andre) {
  const p = cpvPraefiks(kode);
  if (!p) return false;
  return andre.some((anden) => {
    const q = cpvPraefiks(anden);
    return q && q.length < p.length && p.startsWith(q);
  });
}

// Skærer et sæt koder ned til de bredeste, der afgør resultatet.
//
// HVORFOR DET ER NØDVENDIGT OG IKKE PYNT: overvågningslisten er 79 koder, men
// udbud-soeg-funktionen tager højst 100, og hver kode bliver et LIKE-mønster i
// SQL'en. 76 af de 79 er dækket af 48000000, 72000000 og 79400000 og ville
// koste 76 ekstra mønstre uden at ændre ét resultat. Reduktionen er
// resultatneutral netop fordi matchet er hierarkisk.
export function minimerCpvKoder(koder) {
  const rene = [...new Set(koder.map((k) => (typeof k === "string" ? k : k?.kode)).filter(Boolean))];
  return rene.filter((k) => !daekkesAf(k, rene));
}
