import { smvStatus, SMV_ETIKET } from "../../services/leverandoerService";
import {
  aarligVaerdi,
  minimumsomsaetning,
  vurder,
  kravtekst,
  formatFaktor
} from "../../services/oekonomikrav";
import Icon from "../ui/Icon";
import { formatDkkMio, formatPercent, formatDanishDate } from "../../lib/format";

// Trin 5 — markedsanalysen som bilag.
//
// Det her er det dokument, der skal kunne lægges i udbudsmaterialet eller på
// sagen: hvad behovet var, hvordan markedet blev afgrænset, hvem der blev
// vurderet, og hvorfor kravet til økonomisk formåen er sat, som det er. Det
// samler trin 1–4 og tilføjer intet nyt — hvert tal her står også på skærmen
// et andet sted, hvor det kan efterprøves.
//
// "Opdel eller forklar" (udbudslovens § 49) formuleres som observationer,
// aldrig som en anbefaling: appen kender hverken opgaven eller ordregiverens
// vurdering, og en anbefaling ville invitere til at overtage et ansvar, den
// ikke kan bære.

const OPDELING_TEKST = {
  ja: "Ordregiveren overvejer at opdele opgaven i delkontrakter.",
  nej: "Ordregiveren forventer ét samlet udbud.",
  ved_ikke: "Ordregiveren har endnu ikke taget stilling til opdeling."
};

function Felt({ etiket, children }) {
  if (children == null || children === "") return null;
  return (
    <div className="bilag-felt">
      <dt>{etiket}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function TrinBilag({ dialog, data, onGaaTil }) {
  const behov = dialog.behov;
  const aarlig = aarligVaerdi(dialog);
  const minOms = minimumsomsaetning(dialog);
  const shortliste = new Set(dialog.shortliste);

  const sandsynlige = data.sandsynlige.map((l) => {
    const tal = l.cvr ? dialog.regnskaber[l.cvr] : null;
    return {
      ...l,
      tal,
      smv: smvStatus(l, tal),
      vurdering: l.cvr ? vurder(tal?.status === "ok" ? tal : null, dialog).samlet : null
    };
  });

  const medCvr = sandsynlige.filter((l) => l.cvr);
  const opfylder = medCvr.filter((l) => l.vurdering === "opfylder").length;
  const falder = medCvr.filter((l) => l.vurdering === "falder_fra").length;
  const smvListe = medCvr.filter((l) => l.smv === "smv" || l.smv === "smv_estimat");
  const smvOpfylder = smvListe.filter((l) => l.vurdering === "opfylder").length;
  const smvFalder = smvListe.filter((l) => l.vurdering === "falder_fra").length;

  const tekst = kravtekst(dialog, {
    vurderet: opfylder + falder,
    opfylder,
    smvVurderet: smvOpfylder + smvFalder,
    smvOpfylder
  });

  const ialt = data.statistik.data?.ialt;
  const k = data.koncentration;
  const smvEstimat = k && ialt != null ? ialt - k.antalPrKlasse.landsdaekkende : null;
  const kilde = data.vindere.data?.kilde;
  const shortlistede = data.leverandoerer.filter((l) => shortliste.has(l.cvr));

  return (
    <>
      <div className="button-row no-print bilag-handlinger">
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="doc" size={14} />
          Udskriv eller gem som PDF
        </button>
        <span className="muted small">Kun bilaget kommer med på papiret.</span>
      </div>

      <article className="card bilag">
        <header className="bilag__hoved">
          <p className="eyebrow">Markedsanalyse · bilag</p>
          <h2>{dialog.titel || "Uden titel"}</h2>
          <p className="muted small">
            Udarbejdet {formatDanishDate(new Date().toISOString())}
            {dialog.deadline && ` · forventet udbud ${formatDanishDate(dialog.deadline)}`}
          </p>
        </header>

        <section>
          <h3>1. Behov</h3>
          <dl className="bilag-felter">
            <Felt etiket="Hvad skal anskaffes">{behov.hvad}</Felt>
            <Felt etiket="Formål">{behov.formaal}</Felt>
            <Felt etiket="Anslået samlet værdi">
              {dialog.anslaaetVaerdi != null && formatDkkMio(dialog.anslaaetVaerdi)}
            </Felt>
            <Felt etiket="Varighed">{behov.varighedAar && `${behov.varighedAar} år`}</Felt>
            <Felt etiket="Årlig værdi">{aarlig != null && formatDkkMio(aarlig)}</Felt>
            <Felt etiket="Leveringssted">{behov.geografi}</Felt>
            <Felt etiket="Nuværende leverandør">
              {behov.nuvaerende && `${behov.nuvaerende.navn} (CVR ${behov.nuvaerende.cvr})`}
            </Felt>
            <Felt etiket="Særlige krav">{behov.saerligeKrav}</Felt>
          </dl>
        </section>

        <section>
          <h3>2. Markedets afgrænsning</h3>
          <dl className="bilag-felter">
            <Felt etiket="CPV-koder">
              {dialog.cpvKoder.length > 0 && (
                <ul className="bilag-liste">
                  {dialog.cpvKoder.map((c) => (
                    <li key={c.kode}>
                      <span className="mono">{c.kode}</span> {c.tekst}
                    </li>
                  ))}
                </ul>
              )}
            </Felt>
            <Felt etiket="Branchekoder">
              {dialog.branchekoder.length > 0 && (
                <ul className="bilag-liste">
                  {dialog.branchekoder.map((b) => (
                    <li key={b.kode}>
                      <span className="mono">{b.kode}</span> {b.tekst}
                    </li>
                  ))}
                </ul>
              )}
            </Felt>
            <Felt etiket="Virksomheder i markedet">
              {ialt != null && `${ialt.toLocaleString("da-DK")} aktive virksomheder i de valgte brancher`}
            </Felt>
            <Felt etiket="Heraf SMV (estimat)">
              {smvEstimat != null &&
                `${smvEstimat.toLocaleString("da-DK")} (${formatPercent((smvEstimat / ialt) * 100)}) — virksomheder med færre end 10 forretningssteder`}
            </Felt>
            <Felt etiket="Har vundet EU-udbud">
              {kilde &&
                `${kilde.vindereIalt.toLocaleString("da-DK")} forskellige vindere i ${kilde.noticesLaest.toLocaleString("da-DK")} tildelinger` +
                  (kilde.aar ? ` de seneste ${kilde.aar} år` : "") +
                  ` (${formatDanishDate(kilde.fraDato)}–${formatDanishDate(kilde.tilDato)})`}
            </Felt>
          </dl>
        </section>

        <section>
          <h3>3. Sandsynlige tilbudsgivere</h3>
          <p className="small muted">
            De {sandsynlige.length} leverandører med flest relevanssignaler: har vundet i
            CPV-feltet, er registreret i de valgte brancher, ligger lokalt eller er nuværende
            leverandør. Markeret med ★ = på shortlisten.
          </p>
          <div className="scroll-x">
            <table className="data-table bilag-tabel">
              <thead>
                <tr>
                  <th>Leverandør</th>
                  <th style={{ textAlign: "right" }}>EU-sejre</th>
                  <th style={{ textAlign: "right" }}>Omsætning</th>
                  <th style={{ textAlign: "right" }}>Soliditet</th>
                  <th>SMV</th>
                  <th>Økonomikrav</th>
                </tr>
              </thead>
              <tbody>
                {sandsynlige.map((l) => (
                  <tr key={l.noegle}>
                    <td>
                      {shortliste.has(l.cvr) && "★ "}
                      {l.navn}
                      {l.cvr && <span className="mono small muted"> {l.cvr}</span>}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {l.sejre?.antal ?? 0}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {l.tal?.omsaetning != null
                        ? formatDkkMio(l.tal.omsaetning)
                        : l.tal?.omsaetningNedre != null
                          ? `≥ ${formatDkkMio(l.tal.omsaetningNedre)}`
                          : "–"}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {formatPercent(l.tal?.soliditet ?? null)}
                    </td>
                    <td>{SMV_ETIKET[l.smv]}</td>
                    <td>
                      {l.vurdering === "opfylder"
                        ? "Opfylder"
                        : l.vurdering === "falder_fra"
                          ? "Falder fra"
                          : l.vurdering === "ukendt"
                            ? "Kan ikke afgøres"
                            : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shortlistede.length > 0 && (
            <p className="small">
              <strong>Shortliste til markedsdialog ({shortlistede.length}):</strong>{" "}
              {shortlistede.map((l) => l.navn).join(", ")}
            </p>
          )}
        </section>

        <section>
          <h3>4. Økonomisk og finansiel formåen</h3>
          {tekst ? (
            <>
              <pre className="kravtekst">{tekst}</pre>
              <p className="small">
                Af de {medCvr.length} sandsynlige tilbudsgivere med dansk CVR-nummer opfylder{" "}
                <strong>{opfylder}</strong> kravet, <strong>{falder}</strong> falder fra, og{" "}
                {medCvr.length - opfylder - falder} kan ikke vurderes ud fra offentliggjorte
                regnskaber. Blandt SMV'erne opfylder {smvOpfylder} af {smvListe.length}.
                {minOms != null &&
                  ` Omsætningskravet svarer til ${formatFaktor(dialog.oekonomikrav.omsaetningFaktor)} den årlige kontraktværdi.`}
              </p>
            </>
          ) : (
            <p className="small muted">Der er ikke valgt krav til økonomisk formåen.</p>
          )}
        </section>

        <section>
          <h3>5. Opdeling i delkontrakter (udbudslovens § 49)</h3>
          <ul className="bilag-liste">
            <li>{OPDELING_TEKST[behov.opdeling] ?? OPDELING_TEKST.ved_ikke}</li>
            {smvEstimat != null && ialt > 0 && (
              <li>
                {formatPercent((smvEstimat / ialt) * 100)} af markedet er skønsmæssigt SMV'er
                {k && `, og ${formatPercent(k.andelEnkeltmand * 100)} er enkeltmandsvirksomheder`}.
              </li>
            )}
            {smvListe.length > 0 && tekst && (
              <li>
                Det valgte økonomikrav udelukker {smvFalder} af {smvListe.length} SMV'er blandt de
                sandsynlige tilbudsgivere.
              </li>
            )}
            {dialog.aiForslag?.opdelingsforslag && (
              <li>
                AI-forslag til opdeling (ikke ordregiverens vurdering):{" "}
                <em>{dialog.aiForslag.opdelingsforslag}</em>
              </li>
            )}
          </ul>
        </section>

        <section>
          <h3>6. Datakilder og begrænsninger</h3>
          <ul className="bilag-liste small">
            <li>
              Markedet: CVR-registret via Datafordeleren — alle aktive danske virksomheder i de
              valgte brancher. Størrelse er målt på forretningssteder og selskabsform.
            </li>
            <li>
              Vundne udbud: TED (Tenders Electronic Daily) — kun kontrakter over EU's
              tærskelværdi med dansk ordregiver. Mindre, nationale udbud indgår ikke.
            </li>
            <li>
              Nøgletal: seneste årsregnskab indberettet til Erhvervsstyrelsen. Selskaber, der
              indberetter efter IFRS/ESEF, eller som kun oplyser bruttofortjeneste, kan ikke
              vurderes fuldt.
            </li>
            <li>
              SMV følger EU-henstilling 2003/361/EF. Uden nøgletal er SMV-status et estimat.
            </li>
            {dialog.aiForslag && (
              <li>
                CPV-forslag er lavet med AI ({dialog.aiForslag.model}) og valgt til af
                ordregiveren. Koderne er kontrolleret mod den officielle nomenklatur.
              </li>
            )}
          </ul>
        </section>
      </article>

      {!dialog.shortliste.length && (
        <p className="muted small no-print">
          Shortlisten er tom.{" "}
          <button type="button" className="link-knap" onClick={() => onGaaTil("leverandoerer")}>
            Vælg leverandører til dialog i trin 3
          </button>
          .
        </p>
      )}
    </>
  );
}
