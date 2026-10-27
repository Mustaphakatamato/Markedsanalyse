import { useState } from "react";
import { useProjects } from "../context/ProjectsContext";
import Trinbjaelke, { TRIN, trinStatus } from "../components/dialog/Trinbjaelke";
import useMarkedsdata from "../components/dialog/useMarkedsdata";
import TrinBehov from "../components/dialog/TrinBehov";
import TrinMarked from "../components/dialog/TrinMarked";
import TrinLeverandoerer from "../components/dialog/TrinLeverandoerer";
import TrinOekonomi from "../components/dialog/TrinOekonomi";
import TrinBilag from "../components/dialog/TrinBilag";
import Icon from "../components/ui/Icon";
import SourceBadge from "../components/ui/SourceBadge";
import StatusChip from "../components/ui/StatusChip";
import { formatDkkMio, formatDanishDate } from "../lib/format";

// Markedsdialog — ordregiverens flow før et udbud.
//
// Fem trin, der hver svarer på ét spørgsmål: hvad skal købes (behov) → hvilket
// marked er det (CPV og brancher) → hvem vil sandsynligvis byde → hvilket krav
// til økonomisk formåen kan markedet bære → bilag. Trinene er ikke låst; se
// Trinbjaelke.jsx for hvorfor.
//
// Siden er en tynd skal. Trinene ligger i components/dialog, og al markedsdata
// hentes ét sted (useMarkedsdata), så et skift mellem trin ikke koster nye
// opslag.

function Arbejdsomraade({ dialog, onTilbage }) {
  const { opdaterUdbud, gemRegnskaber, skiftShortliste, sletUdbud } = useProjects();
  const opdater = (aendringer) => opdaterUdbud(dialog.id, aendringer);
  const data = useMarkedsdata(dialog, (nye) => gemRegnskaber(dialog.id, nye));

  const status = trinStatus(dialog);
  const aktivt = TRIN.some((t) => t.id === dialog.trin) ? dialog.trin : "behov";
  const gaaTil = (trin) => {
    opdater({ trin });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const faelles = { dialog, opdater, data, onGaaTil: gaaTil };

  return (
    <>
      <section className="console no-print dialog-hoved">
        <div className="console-head">
          <p className="eyebrow">Markedsdialog</p>
          <h3>{dialog.titel || "Uden titel"}</h3>
          <div className="tag-row">
            {dialog.cpvKoder.slice(0, 4).map((c) => (
              <span className="tag tag--code" key={c.kode} title={c.tekst || ""}>
                <span className="tag__key">CPV</span>
                {c.kode}
              </span>
            ))}
            {dialog.cpvKoder.length > 4 && <span className="tag">+{dialog.cpvKoder.length - 4}</span>}
            {dialog.anslaaetVaerdi != null && <span className="tag">{formatDkkMio(dialog.anslaaetVaerdi)}</span>}
            {dialog.shortliste.length > 0 && (
              <span className="tag">{dialog.shortliste.length} på shortliste</span>
            )}
            {dialog.vaerdiRaa && (
              <span className="tag tag--warn" title="Værdien kunne ikke tolkes som et tal ved opgraderingen">
                Værdi: “{dialog.vaerdiRaa}” — ret den i behovet
              </span>
            )}
          </div>
        </div>
        <div className="button-row dialog-hoved__knapper">
          <button className="btn btn-ghost btn-sm" onClick={onTilbage}>
            <Icon name="back" size={13} />
            Alle markedsdialoger
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (window.confirm(`Slet markedsdialogen "${dialog.titel || "Uden titel"}"?`)) {
                sletUdbud(dialog.id);
                onTilbage();
              }
            }}
          >
            Slet
          </button>
        </div>
      </section>

      <Trinbjaelke aktivt={aktivt} status={status} onVaelg={gaaTil} />

      {aktivt === "behov" && <TrinBehov dialog={dialog} opdater={opdater} onVidere={() => gaaTil("marked")} />}
      {aktivt === "marked" && <TrinMarked {...faelles} />}
      {aktivt === "leverandoerer" && (
        <TrinLeverandoerer {...faelles} skiftShortliste={(cvr) => skiftShortliste(dialog.id, cvr)} />
      )}
      {aktivt === "oekonomi" && <TrinOekonomi {...faelles} />}
      {aktivt === "bilag" && <TrinBilag {...faelles} />}
    </>
  );
}

const TRIN_TITEL = Object.fromEntries(TRIN.map((t) => [t.id, `${t.nr}. ${t.titel}`]));

export default function TenderPage() {
  const { udbud, gemtFejl, opretUdbud } = useProjects();
  const [valgtId, setValgtId] = useState(null);

  const valgt = udbud.find((u) => u.id === valgtId) || null;

  return (
    <main className="page">
      {gemtFejl && (
        <div className="verdict verdict--alert no-print">
          <span className="verdict__icon">
            <Icon name="alert" size={18} />
          </span>
          <div className="verdict__body">
            <p className="verdict__label">Ikke gemt</p>
            <p className="verdict__value">{gemtFejl}</p>
          </div>
        </div>
      )}

      {valgt ? (
        // key: hver dialog får sin egen datahentning og tilstand. Uden den ville
        // et skift fra én dialog til en anden kortvarigt vise den forriges marked.
        <Arbejdsomraade key={valgt.id} dialog={valgt} onTilbage={() => setValgtId(null)} />
      ) : (
        <>
          <section className="console">
            <div className="console-head">
              <p className="eyebrow">Før udbuddet</p>
              <h3>Markedsdialog</h3>
              <p className="lede">
                Beskriv behovet, og find det relevante marked, de sandsynlige tilbudsgivere,
                deres økonomi og track record — og hvilket krav til økonomisk formåen markedet
                kan bære. Bygget på CVR, TED og Erhvervsstyrelsens regnskaber.
              </p>
            </div>

            <div className="console-bay">
              <div className="button-row">
                <button
                  className="btn btn-primary"
                  onClick={() => setValgtId(opretUdbud({ titel: "" }).id)}
                >
                  <Icon name="plus" size={14} />
                  Ny markedsdialog
                </button>
              </div>

              <div className="card-foot">
                <span className="eyebrow" style={{ margin: 0 }}>
                  Kilder
                </span>
                <div className="source-row">
                  <SourceBadge source="cvr" label="CVR-register" />
                  <SourceBadge source="ted" />
                  <SourceBadge source="erst" />
                </div>
              </div>
            </div>
          </section>

          {!udbud.length && (
            <section className="empty-state">
              <span className="empty-state__icon">
                <Icon name="inbox" size={22} />
              </span>
              <h4>Ingen markedsdialoger endnu</h4>
              <p className="muted">
                Start med at beskrive, hvad der skal købes — så finder vi markedet bag det.
              </p>
            </section>
          )}

          {udbud.length > 0 && (
            <section className="grid two-col">
              {udbud.map((u) => (
                <article className="card udbud-kort" key={u.id}>
                  <div className="space-between">
                    <h3 style={{ margin: 0 }}>{u.titel || "Uden titel"}</h3>
                    {u.shortliste.length > 0 && (
                      <StatusChip tone="ok" icon="check">
                        {u.shortliste.length} på shortliste
                      </StatusChip>
                    )}
                  </div>

                  {u.behov?.hvad && <p className="muted small udbud-kort__behov">{u.behov.hvad}</p>}

                  <div className="tag-row">
                    <span className="tag">{TRIN_TITEL[u.trin] ?? TRIN_TITEL.behov}</span>
                    {u.cpvKoder.slice(0, 3).map((c) => (
                      <span className="tag tag--code" key={c.kode}>
                        {c.kode}
                      </span>
                    ))}
                    {u.cpvKoder.length > 3 && <span className="tag">+{u.cpvKoder.length - 3}</span>}
                  </div>

                  <div className="button-row space-between">
                    <button className="btn btn-secondary btn-sm" onClick={() => setValgtId(u.id)}>
                      Åbn
                      <Icon name="arrow" size={13} />
                    </button>
                    <span className="muted small">Ændret {formatDanishDate(u.aendret)}</span>
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
