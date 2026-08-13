import Fordeling from "./Fordeling";
import Icon from "../ui/Icon";
import SourceBadge from "../ui/SourceBadge";
import { Working, SkeletonRows } from "../ui/Loading";

// Markedets struktur — grundlaget for de udbudsstrategiske valg.
//
// De to spørgsmål siden skal kunne besvares på:
//   1. Er der konkurrence nok til at gennemføre et udbud?
//   2. Kan mindre leverandører løfte opgaven, hvis den deles i delkontrakter?
//
// Spørgsmål 2 er ikke akademisk: udbudslovens § 49 kræver, at en ordregiver
// enten opdeler kontrakten eller begrunder hvorfor ikke. Består markedet
// overvejende af enkeltmandsvirksomheder, er et samlet udbud svært at
// begrunde — og det er præcis den slags tal, TED aldrig kunne vise, fordi den
// kun kender vinderne af de STORE kontrakter.

// Tolkningen formuleres som en observation, aldrig som en anbefaling. Appen
// kender hverken opgavens indhold eller ordregiverens vurdering, og en
// "anbefaling" ville invitere til at overtage et ansvar, den ikke kan bære.
function tolkSmvAndel(andel) {
  if (andel >= 0.5) {
    return {
      tone: "warn",
      tekst:
        "Over halvdelen af markedet er enkeltmandsvirksomheder og personligt ejede " +
        "virksomheder. Et samlet udbud vil i praksis udelukke dem."
    };
  }
  if (andel >= 0.25) {
    return {
      tone: "info",
      tekst:
        "En betydelig del af markedet er meget små virksomheder. Overvej om " +
        "delkontrakter ville udvide feltet."
    };
  }
  return {
    tone: "ok",
    tekst: "Markedet består overvejende af selskaber med begrænset ansvar."
  };
}

export default function Markedsbillede({ statistik, koncentration, status, fejl, onPrøvIgen }) {
  if (status === "henter") {
    return (
      <section className="card is-working">
        <div className="section-header">
          <h3>Markedsbillede</h3>
          <SourceBadge source="cvr" label="CVR-register" />
        </div>
        <Working>Opgør markedet…</Working>
        <div style={{ marginTop: 14 }}>
          <SkeletonRows rows={6} />
        </div>
      </section>
    );
  }

  if (status === "fejl") {
    return (
      <section className="card">
        <div className="section-header">
          <h3>Markedsbillede</h3>
        </div>
        <p className="muted small">{fejl}</p>
        <div className="button-row">
          <button className="btn btn-secondary btn-sm" onClick={onPrøvIgen}>
            Prøv igen
          </button>
        </div>
      </section>
    );
  }

  if (!statistik) return null;

  if (!statistik.ialt) {
    return (
      <section className="card">
        <div className="section-header">
          <h3>Markedsbillede</h3>
          <SourceBadge source="cvr" label="CVR-register" />
        </div>
        <div className="empty-state">
          <span className="empty-state__icon">
            <Icon name="inbox" size={22} />
          </span>
          <h4>Ingen virksomheder i de valgte brancher</h4>
          <p className="muted">
            Kontrollér branchekoderne. DB25-koder er seks cifre, og IT-området skiftede
            kode ved overgangen fra DB07 — fx er 620100 blevet til 621000.
          </p>
        </div>
      </section>
    );
  }

  const smv = tolkSmvAndel(koncentration?.andelEnkeltmand ?? 0);

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h3>Markedsbillede</h3>
          <p className="muted small">
            Samtlige aktive danske virksomheder i de valgte brancher — ikke kun dem, der
            har vundet et EU-udbud før.
          </p>
        </div>
        <SourceBadge source="cvr" label="CVR-register" />
      </div>

      {/* Hovedtallet er ét tal og fortjener ikke en graf. */}
      <div className="marked-noegletal">
        <div className="stat">
          <p className="stat__label">Virksomheder i markedet</p>
          <p className="stat__value stat__value--big num">
            {statistik.ialt.toLocaleString("da-DK")}
          </p>
          <p className="muted small">
            {statistik.hovedbranche.toLocaleString("da-DK")} med det som hovedbranche
            {statistik.kunBibranche > 0 &&
              ` · ${statistik.kunBibranche.toLocaleString("da-DK")} som bibranche`}
          </p>
        </div>

        <div className="stat">
          <p className="stat__label">Geografisk tyngdepunkt</p>
          <p className="stat__value num">
            {koncentration?.topKommune
              ? `${Math.round(koncentration.topKommune.andel * 100)}%`
              : "–"}
          </p>
          <p className="muted small">
            {koncentration?.topKommune
              ? `i ${koncentration.topKommune.navn.toLowerCase()}`
              : "ingen kommunedata"}
          </p>
        </div>

        <div className="stat">
          <p className="stat__label">Enkeltmandsvirksomheder</p>
          <p className="stat__value num">
            {Math.round((koncentration?.andelEnkeltmand ?? 0) * 100)}%
          </p>
          <p className="muted small">af markedet</p>
        </div>
      </div>

      {/* Den udbudsstrategiske konsekvens, ikke bare tallet. */}
      <div className={smv.tone === "info" ? "verdict" : `verdict verdict--${smv.tone}`}>
        <span className="verdict__icon">
          <Icon name={smv.tone === "ok" ? "check" : "info"} size={18} />
        </span>
        <div className="verdict__body">
          <p className="verdict__label">Opdel eller forklar (udbudslovens § 49)</p>
          <p className="verdict__value" style={{ fontSize: "0.95rem", lineHeight: 1.5 }}>
            {smv.tekst}
          </p>
        </div>
      </div>

      <div className="grid two-col" style={{ marginTop: 18 }}>
        <div>
          <p className="eyebrow">Hvad laver virksomhederne?</p>
          <p className="muted small" style={{ margin: "0 0 10px" }}>
            Deres egen hovedbranche — ikke de koder, du søgte på. Dukker der brancher op,
            du ikke valgte, rækker markedet videre end dine koder.
          </p>
          <Fordeling
            ialt={statistik.ialt}
            poster={(statistik.prBranche || []).slice(0, 8).map((b) => ({
              noegle: b.kode,
              etiket: b.tekst || b.kode,
              titel: `${b.kode} · ${b.tekst || ""}`,
              antal: b.antal
            }))}
          />
        </div>

        <div>
          <p className="eyebrow">Hvor ligger de?</p>
          <p className="muted small" style={{ margin: "0 0 10px" }}>
            Beliggenhedsadressens kommune.
          </p>
          <Fordeling
            ialt={statistik.ialt}
            poster={(statistik.prKommune || []).slice(0, 8).map((k) => ({
              noegle: k.kode,
              etiket: k.navn,
              antal: k.antal
            }))}
          />
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <p className="eyebrow">Selskabsformer</p>
        <p className="muted small" style={{ margin: "0 0 10px" }}>
          Sammensætningen afgør, hvor stor en kontrakt markedet reelt kan bære.
        </p>
        <Fordeling
          ialt={statistik.ialt}
          poster={(statistik.prSelskabsform || []).slice(0, 8).map((f) => ({
            noegle: f.form,
            etiket: f.form,
            antal: f.antal
          }))}
        />
      </div>

      <ul className="trace" style={{ marginTop: 16 }}>
        <li>
          <strong>Kilde:</strong> CVR via Datafordeleren, samtlige aktive danske
          virksomheder. Opdateres ugentligt.
        </li>
        <li>
          Antallet siger intet om kapacitet eller egnethed — en virksomhed i branchen er
          ikke det samme som en mulig leverandør. Brug kandidatlisten nedenfor til den
          konkrete vurdering.
        </li>
        <li>
          Virksomheder med branchen som <em>bibranche</em> tælles med. De er reelle
          leverandører, men svagere evidens end dem, der har det som hovedforretning.
        </li>
      </ul>
    </section>
  );
}
