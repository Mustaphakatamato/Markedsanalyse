// Kører hele migrationskæden mod en RIGTIG PostgreSQL og afprøver
// markedsfunktionerne med data, der rammer de kendte kanttilfælde.
//
// HVORFOR: der er ingen anden vej til at afprøve en migration, før den rammer
// produktion. Der findes hverken psql, docker eller supabase CLI på
// udviklingsmaskinen, og Supabase har ingen staging-database. At parse SQL'en
// fanger kun syntaks — og slet ikke inde i funktionskroppe, som bare er
// strenge. embedded-postgres henter en rigtig binary (major 17, samme som
// produktionen ifølge supabase/config.toml) og kører alt igennem.
//
// KØRSEL:  npm i -D embedded-postgres     (én gang, ~144 MB)
//          npm run test:db
//
// HVORFOR IKKE I package.json: embedded-postgres henter en PostgreSQL-binary
// pr. platform som optionalDependency. Stod den blandt devDependencies, ville
// Vercel hente Linux-udgaven ved hvert eneste deploy — 144 MB for en test der
// aldrig kører der. Den installeres derfor på anmodning.
//
// Kør den efter ENHVER ændring i supabase/migrations/. Testen har allerede
// fanget tre fejl, der ellers var gået i produktion:
//   - "IS DISTINCT FROM ALL" findes ikke i SQL
//   - prBranche skiftede betydning ved en omskrivning uden at nogen opdagede det
//   - navnematch fandt ikke "Beta IT ApS" ud fra "Beta IT" (kostede 17 point
//     i match-rate mod TED)

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Importeres dynamisk, så et manglende modul giver en brugbar besked frem for
// en rå ERR_MODULE_NOT_FOUND-stak.
let EmbeddedPostgres;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
} catch {
  console.error(
    "\nembedded-postgres mangler. Installér det først:\n\n" +
    "  npm i -D embedded-postgres\n\n" +
    "Det henter en rigtig PostgreSQL-binary (~144 MB) og står med vilje ikke i\n" +
    "package.json, så Vercel ikke henter den ved hvert deploy.\n"
  );
  process.exit(1);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");

// Uden for repoet, så en afbrudt kørsel ikke efterlader en database i git.
const dataDir = await mkdtemp(path.join(tmpdir(), "markedsanalyse-pgtest-"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: 55432,
  persistent: false
});

let fejl = 0;
const tjek = (navn, betingelse, detalje = "") => {
  console.log(`  ${betingelse ? "OK  " : "FEJL"}  ${navn}${detalje ? ` — ${detalje}` : ""}`);
  if (!betingelse) fejl++;
};

await pg.initialise();
await pg.start();
await pg.createDatabase("test");
const db = pg.getPgClient("test");
await db.connect();

try {
  // Supabase-rollerne findes ikke i en bar PostgreSQL. Migrationerne gør
  // "revoke ... from anon, authenticated", og uden rollerne fejler det —
  // hvilket ville rulle create table tilbage i samme implicitte transaktion.
  await db.query(`
    do $$ begin
      if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;
  `);

  // -------------------------------------------------------------- migrationer
  console.log("\n=== Migrationer (i rækkefølge, som mod produktion) ===");
  const filer = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
  for (const fil of filer) {
    const sql = await readFile(path.join(MIGRATIONS, fil), "utf8");
    try {
      await db.query(sql);
      console.log(`  OK    ${fil}`);
    } catch (e) {
      console.log(`  FEJL  ${fil}\n        ${e.message}`);
      fejl++;
    }
  }

  // ----------------------------------------------------------------- testdata
  // Et lille, men realistisk IT-marked. Hver række findes for at ramme et
  // kanttilfælde, ikke for at fylde: Delta Revision har IT som BIbranche
  // (skal findes, men rangeres under), Epsilon er ophørt (må aldrig dukke op),
  // og Zeta er enkeltmandsvirksomhed (SMV-signalet i markedsstatistikken).
  //
  // Størrelsesfelterne er valgt så de fire klasser alle er repræsenteret, og
  // så rangeringen kan skelnes fra den gamle: Delta (ét sted, P/S) skal ligge
  // OVER Beta (ét sted, ApS), selvom Delta kun er et bibranche-match.
  //   Alfa   3 P-enheder, A/S (60)  → score 35, flere_adresser
  //   Beta   1 P-enhed,   ApS (80)  → score 13, selskab
  //   Gamma 12 P-enheder, A/S (60)  → score 125, landsdaekkende
  //   Delta  1 P-enhed,   P/S (70)  → score 15, selskab
  //   Zeta   1 P-enhed,   enk. (10) → score 10, mikro
  console.log("\n=== Testdata ===");
  await db.query(`
    insert into public.cvr_virksomhed_indeks
      (cvr, navn, status, ophoert, branchekode, branchetekst, bibrancher,
       kommunekode, kommunenavn, postnummer, postdistrikt, virksomhedsform,
       virksomhedsformkode, antal_penheder, startdato)
    values
      (10000001,'Alfa Software A/S','aktiv',false,'620100','Computerprogrammering',null,
       '101','KØBENHAVN','2100','København Ø','Aktieselskab','60',3,'1998-04-01'),
      (10000002,'Beta IT ApS','aktiv',false,'620100','Computerprogrammering',array['620200'],
       '751','AARHUS','8000','Aarhus C','Anpartsselskab','80',1,'2015-09-15'),
      (10000003,'Gamma Consulting A/S','aktiv',false,'620200','IT-konsulentvirksomhed',null,
       '101','KØBENHAVN','1050','København K','Aktieselskab','60',12,'1985-01-02'),
      (10000004,'Delta Revision P/S','aktiv',false,'692000','Bogføring og revision',array['620100','631100'],
       '461','ODENSE','5000','Odense C','Partnerselskab','70',1,'2001-06-01'),
      (10000005,'Epsilon Nedlagt ApS','ophoert',true,'620100','Computerprogrammering',null,
       '101','KØBENHAVN','2200','København N','Anpartsselskab','80',1,'2010-01-01'),
      (10000006,'Zeta Enkeltmand','aktiv',false,'620100','Computerprogrammering',null,
       '751','AARHUS','8200','Aarhus N','Enkeltmandsvirksomhed','10',1,'2020-03-01');
  `);

  // De materialiserede views blev bygget mens tabellen var tom. Samme trin
  // som efter en rigtig indlæsning, se scripts/indlaes-cvr-indeks.mjs.
  await db.query("refresh materialized view public.marked_dim");
  await db.query("refresh materialized view public.branche_tekst");
  // 5 aktive med hovedbranche (Epsilon er ophørt og skal IKKE med) + 3
  // bibrancher (Beta har én, Delta har to). At den ophørte allerede filtreres
  // fra her, er grunden til at ingen af opslagene behøver gøre det igen.
  const dim = await db.query("select count(*) n from public.marked_dim");
  tjek("marked_dim: 5 hovedbrancher + 3 bibrancher, ophørt udeladt",
    Number(dim.rows[0].n) === 8, `${dim.rows[0].n} rækker`);

  // -------------------------------------------------------------- soeg_marked
  console.log("\n=== soeg_marked() ===");

  const a = await db.query(`select * from public.soeg_marked(array['620100'])`);
  tjek("620100 finder 4 aktive (3 hoved- + 1 bibranche)", a.rows.length === 4,
    a.rows.map((r) => r.navn).join(", "));
  tjek("heraf 3 på hovedbranche", a.rows.filter((r) => r.traf_hovedbranche).length === 3);
  tjek("den ophørte er udeladt", !a.rows.some((r) => Number(r.cvr) === 10000005));

  const b = await db.query(`select * from public.soeg_marked(array['620100','631100'])`);
  const delta = b.rows.find((r) => Number(r.cvr) === 10000004);
  tjek("bibranche-match findes (Delta Revision)", !!delta);
  tjek("bibranche-match markeres traf_hovedbranche = false", delta?.traf_hovedbranche === false);

  // BEVIDST ÆNDRING (20260814090100): hovedbranche var før den primære
  // rangeringsnøgle. Nu er størrelsen det, og hovedbranche er tiebreak inden
  // for samme score. Grunden er at et vilkårligt udsnit af et rigtigt marked
  // består af enmandsfirmaer — evidensstyrken for at de laver det rigtige er
  // høj, men de kan ikke løfte opgaven. Bibranche-filteret i UI'et er stadig
  // vejen til den strenge liste.
  tjek("størrelse rangerer over hovedbranche (Delta P/S før Beta ApS)",
    b.rows.findIndex((r) => Number(r.cvr) === 10000004) <
      b.rows.findIndex((r) => Number(r.cvr) === 10000002),
    b.rows.map((r) => `${r.navn}:${r.stoerrelsesklasse}`).join(" | "));

  const c = await db.query(`select * from public.soeg_marked(array['620100'], array['751'])`);
  tjek("geografisk filter (kommune 751 Aarhus) giver 2", c.rows.length === 2,
    c.rows.map((r) => r.navn).join(", "));

  // Et tomt filter må betyde "hele landet", men et tomt BRANCHE-filter må
  // aldrig betyde "hele registret" — det ville sende 870.000 rækker afsted.
  const d = await db.query(`select * from public.soeg_marked(array['620100'], null)`);
  tjek("kommunekoder = null betyder hele landet", d.rows.length === 4);
  const e = await db.query(`select * from public.soeg_marked(array['620100'], array[]::text[])`);
  tjek("tomt kommune-array betyder også hele landet", e.rows.length === 4);
  const tomBranche = await db.query(`select * from public.soeg_marked(array[]::text[])`);
  tjek("tomt branche-array giver 0, ikke hele registret", tomBranche.rows.length === 0);
  const nulBranche = await db.query(`select * from public.soeg_marked(null)`);
  tjek("null branche-array giver 0, ikke hele registret", nulBranche.rows.length === 0);

  const h = await db.query(`select * from public.soeg_marked(array['620100'], null, 2)`);
  tjek("maks respekteres", h.rows.length === 2);

  // ------------------------------------------------------- rangering og filter
  //
  // Kernen i hele ændringen: 'maks' må ikke længere betyde "de 200 første i
  // vilkårlig rækkefølge". Rammer afgrænsningen først og sorteringen bagefter,
  // er filteret i praksis virkningsløst i et rigtigt marked — de store udgør
  // 4 % af populationen og ville falde uden for udsnittet.
  console.log("\n=== soeg_marked(): rangering og størrelsesfilter ===");

  const rang = await db.query(`select * from public.soeg_marked(array['620100'])`);
  tjek("de største først (Alfa 3 P-enheder, Delta P/S, Beta ApS, Zeta enkeltmand)",
    rang.rows.map((r) => Number(r.cvr)).join(",") === "10000001,10000004,10000002,10000006",
    rang.rows.map((r) => `${r.navn}:${r.stoerrelsesklasse}`).join(" | "));

  tjek("klasserne udledes rigtigt",
    rang.rows[0].stoerrelsesklasse === "flere_adresser" &&
      rang.rows[1].stoerrelsesklasse === "selskab" &&
      rang.rows.at(-1).stoerrelsesklasse === "mikro",
    rang.rows.map((r) => `${r.navn}:${r.stoerrelsesklasse}`).join(" | "));

  tjek("antal_penheder og startdato følger med",
    rang.rows[0].antal_penheder === 3 &&
      rang.rows[0].startdato instanceof Date,
    `${rang.rows[0].antal_penheder} / ${rang.rows[0].startdato}`);

  const gamma = await db.query(`select * from public.soeg_marked(array['620200'])`);
  tjek("12 P-enheder giver klassen 'landsdaekkende'",
    gamma.rows.find((r) => Number(r.cvr) === 10000003)?.stoerrelsesklasse === "landsdaekkende",
    gamma.rows.map((r) => `${r.navn}:${r.stoerrelsesklasse}`).join(" | "));

  const kunSelskaber = await db.query(
    `select * from public.soeg_marked(array['620100'], null, 200, 'selskab')`);
  tjek("mindst_klasse='selskab' fjerner enkeltmandsvirksomheden",
    kunSelskaber.rows.length === 3 &&
      !kunSelskaber.rows.some((r) => Number(r.cvr) === 10000006),
    kunSelskaber.rows.map((r) => r.navn).join(", "));

  const kunFlere = await db.query(
    `select * from public.soeg_marked(array['620100'], null, 200, 'flere_adresser')`);
  tjek("mindst_klasse='flere_adresser' giver kun Alfa",
    kunFlere.rows.length === 1 && Number(kunFlere.rows[0].cvr) === 10000001,
    kunFlere.rows.map((r) => r.navn).join(", "));

  // Filteret skal ramme FØR afgrænsningen, ellers er det bare en sortering.
  // maks=1 på et filter der har tre kandidater skal give den største af de
  // tre — ikke den største af hele markedet, hvis den er filtreret fra.
  const filterFoerGraense = await db.query(
    `select * from public.soeg_marked(array['620100'], null, 1, 'selskab')`);
  tjek("filteret afgrænser i databasen, ikke bagefter",
    filterFoerGraense.rows.length === 1 && Number(filterFoerGraense.rows[0].cvr) === 10000001,
    filterFoerGraense.rows.map((r) => r.navn).join(", "));

  const efterNavn = await db.query(
    `select * from public.soeg_marked(array['620100'], null, 200, null, 'navn')`);
  tjek("sortering='navn' giver alfabetisk rækkefølge",
    efterNavn.rows.map((r) => r.navn).join(",") ===
      "Alfa Software A/S,Beta IT ApS,Delta Revision P/S,Zeta Enkeltmand",
    efterNavn.rows.map((r) => r.navn).join(", "));

  const ukendtKlasse = await db.query(
    `select * from public.soeg_marked(array['620100'], null, 200, 'vrøvl')`);
  tjek("ukendt klasse betyder 'ingen afgrænsning', ikke 'intet marked'",
    ukendtKlasse.rows.length === 4, `${ukendtKlasse.rows.length} rækker`);

  // --------------------------------------------------------- marked_statistik
  console.log("\n=== marked_statistik() ===");

  const s = (await db.query(`select public.marked_statistik(array['620100','631100']) as j`)).rows[0].j;
  tjek("ialt = 4", s.ialt === 4, JSON.stringify(s.ialt));
  tjek("hovedbranche = 3", s.hovedbranche === 3);
  tjek("kunBibranche = 1", s.kunBibranche === 1);
  tjek("ialt = hovedbranche + kunBibranche", s.ialt === s.hovedbranche + s.kunBibranche);
  tjek("prBranche sorteret faldende", s.prBranche.every((x, i, r) => i === 0 || r[i - 1].antal >= x.antal),
    JSON.stringify(s.prBranche));

  // prBranche skal vise virksomhedernes EGNE hovedbrancher — Delta Revision
  // tælles under 692000 (bogføring), ikke under den 620100 den blev fundet på.
  // Det er dét, der afslører at markedet rækker ud over de søgte koder.
  // Grupperes der i stedet på søgeordene, forsvinder 692000 helt. Præcis den
  // forskel skred ubemærket ved en omskrivning — derfor står den her.
  const koder = Object.fromEntries(s.prBranche.map((x) => [x.kode, x.antal]));
  tjek("prBranche grupperer på egen hovedbranche (620100:3, 692000:1)",
    koder["620100"] === 3 && koder["692000"] === 1 && !("631100" in koder),
    JSON.stringify(s.prBranche));
  tjek("prBranche summer til ialt (ingen dobbelttælling)",
    s.prBranche.reduce((n, x) => n + x.antal, 0) === s.ialt);
  tjek("prKommune udfyldt", s.prKommune.length === 3,
    JSON.stringify(s.prKommune.map((k) => `${k.navn}:${k.antal}`)));
  tjek("prSelskabsform skiller enkeltmand fra A/S",
    s.prSelskabsform.some((x) => x.form === "Enkeltmandsvirksomhed"),
    JSON.stringify(s.prSelskabsform.map((x) => `${x.form}:${x.antal}`)));

  // Størrelsesfordelingen er grundlaget for "opdel eller forklar": den siger
  // hvor stor en del af markedet der overhovedet kan byde på en samlet opgave.
  tjek("prStoerrelse fordeler markedet på de fire klasser",
    s.prStoerrelse?.flere_adresser === 1 && s.prStoerrelse?.selskab === 2 &&
      s.prStoerrelse?.mikro === 1,
    JSON.stringify(s.prStoerrelse));
  tjek("prStoerrelse summer til ialt (ingen virksomhed i to klasser)",
    Object.values(s.prStoerrelse ?? {}).reduce((n, x) => n + x, 0) === s.ialt,
    JSON.stringify(s.prStoerrelse));

  const ukendt = (await db.query(`select public.marked_statistik(array['999999']) as j`)).rows[0].j;
  tjek("ukendt branche giver 0 og tomme arrays",
    ukendt.ialt === 0 && ukendt.prBranche.length === 0, JSON.stringify(ukendt));

  // ------------------------------------------ navnematch: paritet med kilden
  //
  // navn_normaliser()/navn_kerne() i SQL er bevidste DUBLETTER af
  // normalizeForMatch()/coreCompanyName() i src/services/tedService.js.
  // Dubletten findes fordi opslaget skal kunne bruge et udtryksindeks, men to
  // implementeringer af samme regel kan skride fra hinanden og give
  // modstridende svar for samme firma.
  //
  // Reglerne læses derfor UD AF kildefilen i stedet for at blive skrevet af
  // her. Ændrer nogen tedService.js, fejler denne test — og så skal
  // migrationen 20260813140000_create_brancheforslag.sql rettes med.
  console.log("\n=== navnematch: SQL mod src/services/tedService.js ===");

  const tedKilde = await readFile(path.join(REPO, "src", "services", "tedService.js"), "utf8");
  const hent = (navn) => {
    const m = tedKilde.match(new RegExp(`const ${navn} = (/.*/[gimsuy]*);`));
    return m ? new RegExp(m[1].slice(1, m[1].lastIndexOf("/")), m[1].slice(m[1].lastIndexOf("/") + 1)) : null;
  };
  const OWNER = hent("OWNER_MARKER");
  const FORM = hent("LEGAL_FORM_SUFFIX");
  tjek("reglerne kunne læses ud af tedService.js", !!OWNER && !!FORM,
    OWNER && FORM ? "" : "regex-literalerne er omskrevet — opdatér hent() her");

  if (OWNER && FORM) {
    const jsNorm = (t) => t.toLowerCase().normalize("NFD")
      .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const jsCore = (n) => n.replace(OWNER, "").replace(FORM, "").trim();

    const navne = [
      "Atea A/S", "NETCOMPANY A/S", "Ø-Data ApS", "Ærø Teknik A/S",
      "Café Blå I/S", "KMD  A/S", "2MJ v/Johnny Escherich Andresen",
      "Müller & Sønner ApS", "Ålborg Data a.m.b.a.", "Sønderjysk El P/S"
    ];
    const liste = navne.map((n) => `('${n.replace(/'/g, "''")}')`).join(",");
    const res = await db.query(
      `select v, public.navn_normaliser(v) as norm,
              public.navn_normaliser(public.navn_kerne(v)) as kerne
       from (values ${liste}) as t(v)`
    );
    let afvig = 0;
    for (const row of res.rows) {
      if (row.norm !== jsNorm(row.v) || row.kerne !== jsNorm(jsCore(row.v))) {
        afvig++;
        console.log(`        "${row.v}"  SQL="${row.norm}"/"${row.kerne}"  ` +
                    `JS="${jsNorm(row.v)}"/"${jsNorm(jsCore(row.v))}"`);
      }
    }
    tjek(`SQL og JS normaliserer ${navne.length} navne ens`, afvig === 0, `${afvig} afvigelser`);
  }

  // ------------------------------------------------- brancheforslag_for_navne
  console.log("\n=== brancheforslag_for_navne() ===");

  const forslag = (await db.query(
    `select public.brancheforslag_for_navne(
       array['Alfa Software A/S','Beta IT','Gamma Consulting A/S','Ukendt Firma XYZ ApS']) as j`
  )).rows[0].j;
  tjek("4 navne slået op", forslag.navneSlaaetOp === 4);
  // Dækningsgraden skal tælle NAVNE, ikke virksomheder. Ét navn kan matche
  // flere selskaber, og en tidligere udgave dividerede virksomheder med navne
  // — hvilket gav "106 % dækning" på rigtige data.
  tjek("navneMedTraf ≤ navneSlaaetOp (dækning kan ikke overstige 100 %)",
    forslag.navneMedTraf <= forslag.navneSlaaetOp,
    `${forslag.navneMedTraf}/${forslag.navneSlaaetOp}`);
  tjek("3 af 4 navne ramte", forslag.navneMedTraf === 3, String(forslag.navneMedTraf));
  tjek("3 fundet, det ukendte matcher ikke", forslag.virksomhederFundet === 3,
    JSON.stringify(forslag.virksomhederFundet));
  // TED skriver ofte vinderen uden selskabsform. Uden kernenavn-opslaget faldt
  // match-raten mod rigtige TED-data fra 93 % til 76 % for bygge og anlæg.
  tjek("'Beta IT' matcher 'Beta IT ApS' via kernenavn",
    forslag.brancher.some((b) => b.kode === "620100" && b.antal === 2),
    JSON.stringify(forslag.brancher));
  tjek("andele summer til 100 %",
    Math.abs(forslag.brancher.reduce((n, b) => n + Number(b.andel), 0) - 100) < 0.5,
    JSON.stringify(forslag.brancher.map((b) => `${b.kode}:${b.andel}%`)));
  tjek("sorteret faldende", forslag.brancher.every((x, i, r) => i === 0 || r[i - 1].antal >= x.antal));

  const tomtForslag = (await db.query(
    `select public.brancheforslag_for_navne(array[]::text[]) as j`)).rows[0].j;
  tjek("tom navneliste giver 0 og tomt array",
    tomtForslag.virksomhederFundet === 0 && tomtForslag.brancher.length === 0);

  const ophoert = (await db.query(
    `select public.brancheforslag_for_navne(array['Epsilon Nedlagt ApS']) as j`)).rows[0].j;
  tjek("ophørt virksomhed matcher ikke", ophoert.virksomhederFundet === 0);

  // ------------------------------------------------------------------ soeg_cpv
  console.log("\n=== soeg_cpv() ===");

  // Rigtige koder og officielle betegnelser fra eForms-SDK'et. 64212000 er
  // med, fordi appen tidligere kaldte den "SMS gateway og beskedtjenester" —
  // den hedder Mobiltelefontjeneste, og sms er en anden kode.
  await db.query(`
    insert into public.cpv_koder (kode, tekst, niveau, overordnet) values
      ('45000000','Bygge- og anlægsarbejder',1,null),
      ('72000000','It-tjenester: rådgivning, programmeludvikling, internet og support',1,null),
      ('64000000','Post- og telekommunikationstjenester',1,null),
      ('45100000','Forberedelse af byggeplads',2,'45000000'),
      ('72400000','Internettjenester',2,'72000000'),
      ('64210000','Telefon- og datatransmissionstjenester',3,'64000000'),
      ('64212000','Mobiltelefontjeneste',4,'64210000'),
      ('64212100','Sms-tjenester (Short Message Service)',5,'64212000');
  `);

  const kodePraefiks = await db.query(`select * from public.soeg_cpv('6421')`);
  tjek("kodepræfiks-søgning finder 64210000 først",
    kodePraefiks.rows[0]?.kode === "64210000",
    kodePraefiks.rows.map((r) => r.kode).join(", "));

  const tekstSoeg = await db.query(`select * from public.soeg_cpv('bygge')`);
  tjek("tekstsøgning finder 45000000 Bygge- og anlægsarbejder",
    tekstSoeg.rows.some((r) => r.kode === "45000000"),
    tekstSoeg.rows.map((r) => r.kode).join(", "));

  // Brede koder skal rangeres over smalle: leder man efter "telefon", er
  // kategorien mere sandsynlig end den dybeste variant.
  const bredFoerst = await db.query(`select * from public.soeg_cpv('telefon')`);
  tjek("brede koder rangeres over smalle",
    bredFoerst.rows.length > 1 && bredFoerst.rows[0].niveau <= bredFoerst.rows.at(-1).niveau,
    bredFoerst.rows.map((r) => `${r.kode}:n${r.niveau}`).join(", "));

  const medForaelder = await db.query(`select * from public.soeg_cpv('64212100')`);
  tjek("overordnet betegnelse følger med",
    medForaelder.rows[0]?.overordnet_tekst === "Mobiltelefontjeneste",
    JSON.stringify(medForaelder.rows[0]?.overordnet_tekst));

  const sms = await db.query(`select * from public.soeg_cpv('sms')`);
  tjek("'sms' finder 64212100, ikke 64212000",
    sms.rows.some((r) => r.kode === "64212100"),
    sms.rows.map((r) => `${r.kode} ${r.tekst.slice(0, 24)}`).join(" | "));

  // Fundet ved at køre det rigtige flow: "rengøring" gav rengøringsMIDLER
  // øverst og selve ydelsen som nummer tre, fordi midlerne har en bredere
  // kode. Et strammere match skal slå en bredere kode.
  await db.query(`
    insert into public.cpv_koder (kode, tekst, niveau, overordnet) values
      ('39800000','Rengørings-, pudse- og poleringsmidler',2,null),
      ('90910000','Rengøring',3,null);
  `);
  const rengoering = await db.query(`select * from public.soeg_cpv('rengøring')`);
  tjek("'rengøring' finder ydelsen (90910000) før midlerne (39800000)",
    rengoering.rows[0]?.kode === "90910000",
    rengoering.rows.map((r) => `${r.kode} ${r.tekst.slice(0, 22)}`).join(" | "));

  // Reglen den nye sortering ikke må bryde.
  const byggeIgen = await db.query(`select * from public.soeg_cpv('bygge')`);
  tjek("'bygge' giver stadig 45000000 øverst", byggeIgen.rows[0]?.kode === "45000000",
    byggeIgen.rows.map((r) => r.kode).join(", "));
  const telefonIgen = await db.query(`select * from public.soeg_cpv('telefon')`);
  tjek("'telefon' giver stadig 64210000 før 64212000",
    telefonIgen.rows.findIndex((r) => r.kode === "64210000") <
      telefonIgen.rows.findIndex((r) => r.kode === "64212000"),
    telefonIgen.rows.map((r) => r.kode).join(", "));

  const intet = await db.query(`select * from public.soeg_cpv('   ')`);
  tjek("tom søgetekst giver 0, ikke hele nomenklaturen", intet.rows.length === 0);

  // ---------------------------------------------------------------- regression
  console.log("\n=== Regression: navnesøgningen virker efter skemaændringerne ===");
  const r = await db.query(`select * from public.soeg_virksomhed('alfa')`);
  tjek("soeg_virksomhed finder Alfa Software A/S",
    r.rows.length === 1 && r.rows[0].navn === "Alfa Software A/S");
  const r2 = await db.query(`select * from public.soeg_virksomhed('netcompny')`);
  tjek("trigram-søgning tåler stavefejl (0 træf her, men fejler ikke)", Array.isArray(r2.rows));

} finally {
  await db.end();
  await pg.stop();
  await rm(dataDir, { recursive: true, force: true });
}

console.log(`\n${fejl === 0 ? "Alle tjek bestået." : `${fejl} fejl.`}`);
process.exit(fejl === 0 ? 0 : 1);
