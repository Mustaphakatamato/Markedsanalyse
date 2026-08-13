import { useState } from "react";
import { getWinnerNamesByCPV } from "../../services/tedService";
import { foreslaaBrancher } from "../../services/markedService";
import Icon from "../ui/Icon";
import SourceBadge from "../ui/SourceBadge";
import StatusChip from "../ui/StatusChip";
import { Working, SkeletonRows } from "../ui/Loading";

// Fra CPV-koder til branchekoder.
//
// HVORFOR DET ER SVÆRT: der findes ingen officiel oversættelse mellem CPV
// (hvad der købes) og DB25 (hvad en virksomhed laver). En håndlavet tabel
// ville være et gæt, vi ikke kan dokumentere over for en klagenævnssag.
// I stedet spørger vi data: hvilke brancher har de virksomheder, der rent
// faktisk har vundet udbud i dette CPV-felt?
//
// HVORFOR DET ALDRIG MÅ ANVENDES AUTOMATISK: to fejlkilder er systematiske og
// kan ikke fjernes i koden. Vinderen af et udbud er ofte MODERSELSKABET, så
// holdingbrancher dukker op i stedet for driftsbranchen — og navnematch kan
// ramme et andet selskab med samme navn. Målt på rigtige data er 21 % af
// "vinderne" under CPV 79600000 registreret som engroshandel med
// hospitalsartikler, uden en oplagt forklaring.
//
// Derfor: andele og dækningsgrad vises altid, forslaget kan redigeres frit,
// og teksten siger "peger på", aldrig "er".

// Brancher der næsten altid betyder "det er den juridiske enhed, ikke
// driften". De skjules ikke — det ville være at træffe valget for brugeren —
// men de markeres, så en ordregiver ikke kommer til at afgrænse sit marked
// til holdingselskaber.
const JURIDISKE_ENHEDER = new Set(["642120", "642110", "649990", "649910"]);

// Koder under denne andel forhåndsvælges ikke. Tærsklen står i UI'et, fordi
// en skjult tærskel er en skjult beslutning — og den skal kunne forklares.
const FORHAANDSVALG_GRAENSE = 10;

export default function BrancheVaelger({ cpvKoder, valgte, onAendret }) {
  const [status, setStatus] = useState("idle");
  const [fejl, setFejl] = useState(null);
  const [forslag, setForslag] = useState(null);
  const [manuelKode, setManuelKode] = useState("");

  const valgteKoder = new Set(valgte.map((v) => v.kode));

  const hentForslag = async () => {
    setStatus("henter");
    setFejl(null);
    try {
      const { navne, antalNotices } = await getWinnerNamesByCPV(cpvKoder.map((c) => c.kode));

      if (!navne.length) {
        setForslag({ tom: true, antalNotices });
        setStatus("faerdig");
        return;
      }

      const resultat = await foreslaaBrancher(navne);
      setForslag({ ...resultat, antalNotices });
      setStatus("faerdig");

      // Forhåndsvalg af de tydelige koder, så det almindelige tilfælde er ét
      // klik. Kun hvis brugeren ikke allerede har valgt noget — ellers ville
      // et nyt forslag overskrive et bevidst valg.
      if (!valgte.length) {
        const tydelige = (resultat.brancher || [])
          .filter((b) => Number(b.andel) >= FORHAANDSVALG_GRAENSE && !JURIDISKE_ENHEDER.has(b.kode))
          .map((b) => ({ kode: b.kode, tekst: b.tekst }));
        if (tydelige.length) onAendret(tydelige);
      }
    } catch (err) {
      setFejl(err.message || "Kunne ikke hente brancheforslag.");
      setStatus("fejl");
    }
  };

  const skift = (branche) => {
    if (valgteKoder.has(branche.kode)) {
      onAendret(valgte.filter((v) => v.kode !== branche.kode));
    } else {
      onAendret([...valgte, { kode: branche.kode, tekst: branche.tekst }]);
    }
  };

  const tilfoejManuel = () => {
    const kode = manuelKode.trim();
    if (!/^\d{6}$/.test(kode) || valgteKoder.has(kode)) return;
    onAendret([...valgte, { kode, tekst: null }]);
    setManuelKode("");
  };

  const daekningPct = forslag?.daekning != null ? Math.round(forslag.daekning * 100) : null;

  return (
    <section className={`card ${status === "henter" ? "is-working" : ""}`}>
      <div className="section-header">
        <div>
          <h3>Hvilke brancher er markedet?</h3>
          <p className="muted small">
            Der findes ingen officiel oversættelse fra CPV til branchekode. Vi udleder et
            forslag ved at slå vinderne af nylige danske udbud i dine CPV-felter op i CVR og
            se, hvad de faktisk laver.
          </p>
        </div>
        <SourceBadge source="ted" label="TED + CVR" />
      </div>

      {status === "idle" && (
        <div className="button-row" style={{ marginTop: 4 }}>
          <button
            className="btn btn-primary"
            onClick={hentForslag}
            disabled={!cpvKoder.length}
          >
            <Icon name="spark" size={14} />
            Foreslå brancher ud fra TED-vindere
          </button>
          {!cpvKoder.length && (
            <span className="muted small">Vælg mindst én CPV-kode først.</span>
          )}
        </div>
      )}

      {status === "henter" && (
        <div style={{ marginTop: 8 }}>
          <Working>Henter vindere fra TED og slår dem op i CVR…</Working>
          <div style={{ marginTop: 14 }}>
            <SkeletonRows rows={5} />
          </div>
        </div>
      )}

      {status === "fejl" && (
        <div className="stack stack-tight" style={{ marginTop: 8 }}>
          <p className="muted small">{fejl}</p>
          <div className="button-row">
            <button className="btn btn-secondary btn-sm" onClick={hentForslag}>
              Prøv igen
            </button>
          </div>
        </div>
      )}

      {status === "faerdig" && forslag?.tom && (
        <div className="empty-state" style={{ marginTop: 8 }}>
          <span className="empty-state__icon">
            <Icon name="inbox" size={22} />
          </span>
          <h4>Ingen danske tildelinger fundet</h4>
          <p className="muted">
            TED har ingen registrerede kontrakttildelinger fra danske ordregivere i disse
            CPV-felter. Det er almindeligt for mindre markeder — TED dækker kun udbud over
            EU's tærskelværdi. Indtast branchekoderne manuelt nedenfor.
          </p>
        </div>
      )}

      {status === "faerdig" && forslag && !forslag.tom && (
        <>
          {/* Dækningsgraden står øverst og ikke som en fodnote: et forslag
              bygget på 45 af 67 navne vejer anderledes end ét bygget på alle,
              og forskellen skal ses før listen, ikke efter. */}
          <div className="daekning" style={{ marginTop: 4 }}>
            <div className="space-between mobile-stack">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>
                  Grundlag
                </p>
                <p className="small" style={{ margin: "4px 0 0" }}>
                  <strong>{forslag.navneMedTraf}</strong> af{" "}
                  <strong>{forslag.navneSlaaetOp}</strong> vindernavne kunne slås op i CVR
                  {forslag.virksomhederFundet !== forslag.navneMedTraf &&
                    ` · ${forslag.virksomhederFundet} virksomheder`}
                  {forslag.antalNotices ? ` · ${forslag.antalNotices} tildelinger` : ""}
                </p>
              </div>
              <StatusChip
                tone={daekningPct >= 70 ? "ok" : daekningPct >= 40 ? "warn" : "alert"}
                icon={daekningPct >= 70 ? "check" : "info"}
              >
                {daekningPct}% dækning
              </StatusChip>
            </div>
            <div className="daekning__bar" aria-hidden="true">
              <span style={{ width: `${daekningPct}%` }} />
            </div>
            <p className="muted small" style={{ margin: "8px 0 0" }}>
              De resterende er typisk udenlandske vindere uden dansk CVR-nummer.
            </p>
          </div>

          <p className="eyebrow" style={{ marginTop: 18 }}>
            Foreslåede brancher
          </p>
          <p className="muted small" style={{ margin: "0 0 10px" }}>
            Koder med mindst {FORHAANDSVALG_GRAENSE} % er valgt på forhånd. Ret frit — det er
            dit valg, der afgør markedet.
          </p>

          <ul className="branche-liste">
            {forslag.brancher.map((b) => {
              const valgt = valgteKoder.has(b.kode);
              const juridisk = JURIDISKE_ENHEDER.has(b.kode);
              return (
                <li key={b.kode}>
                  <label className={`branche-valg ${valgt ? "is-valgt" : ""}`}>
                    <input
                      type="checkbox"
                      checked={valgt}
                      onChange={() => skift(b)}
                    />
                    <span className="branche-valg__krop">
                      <span className="branche-valg__top">
                        <span className="branche-valg__tekst">
                          {b.tekst || "Betegnelse ukendt"}
                          {juridisk && (
                            <span
                              className="pill pill-warn"
                              style={{ marginLeft: 8 }}
                              title="Denne branche betyder oftest, at det er moderselskabet der står som vinder — ikke det selskab der udfører opgaven."
                            >
                              juridisk enhed
                            </span>
                          )}
                        </span>
                        <span className="branche-valg__tal num">
                          {b.andel}% · {b.antal}
                        </span>
                      </span>
                      <span className="branche-valg__bar" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, Number(b.andel))}%` }} />
                      </span>
                      <span className="mono small muted">{b.kode}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <ul className="trace" style={{ marginTop: 14 }}>
            <li>
              <strong>Sådan er forslaget fremkommet:</strong> vinderne af de nyeste danske
              tildelinger i dine CPV-felter, slået op i CVR på navn. Hver virksomhed tæller
              én gang, uanset antal kontrakter.
            </li>
            <li>
              Vinderen af et udbud er ofte moderselskabet, så holdingbrancher kan optræde i
              stedet for driftsbranchen. De er markeret.
            </li>
            <li>
              TED dækker kun udbud over EU's tærskelværdi. Er markedet overvejende mindre
              kontrakter, hviler forslaget på en skæv stikprøve.
            </li>
          </ul>
        </>
      )}

      {/* Manuel indtastning er altid tilgængelig, også før et forslag er hentet:
          en erfaren ordregiver kender ofte branchekoden i forvejen, og skal
          ikke tvinges gennem en maskinel omvej. */}
      <div className="card-foot" style={{ display: "block" }}>
        <p className="eyebrow" style={{ margin: "0 0 8px" }}>
          Tilføj en branchekode selv
        </p>
        <div className="row">
          <input
            className="input mono"
            style={{ maxWidth: 160 }}
            placeholder="fx 621000"
            inputMode="numeric"
            value={manuelKode}
            aria-label="Branchekode (seks cifre)"
            onChange={(e) => setManuelKode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && tilfoejManuel()}
          />
          <button
            className="btn btn-secondary btn-sm"
            onClick={tilfoejManuel}
            disabled={!/^\d{6}$/.test(manuelKode.trim())}
          >
            <Icon name="plus" size={13} />
            Tilføj
          </button>
          <span className="muted small">DB25/NACE — seks cifre.</span>
        </div>
      </div>
    </section>
  );
}
