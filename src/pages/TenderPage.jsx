import { useEffect, useState } from "react";
import { useProjects } from "../context/ProjectsContext";
import { cpvOptions } from "../data/cpvOptions";
import { suppliers, getRelevanceScore } from "../data/suppliers";
import { searchByCPV } from "../services/tedService";
import Icon from "../components/ui/Icon";
import SourceBadge from "../components/ui/SourceBadge";
import { Working, SkeletonRows } from "../components/ui/Loading";

function formatDate(isoDate) {
  return isoDate ? isoDate.slice(0, 10) : "–";
}

function EmptyForm() {
  return {
    title: "",
    cpvCode: cpvOptions[0].code,
    description: "",
    deadline: "",
    estimatedValue: ""
  };
}

function CreateProjectForm({ onCreate, onCancel }) {
  const [form, setForm] = useState(EmptyForm);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const submit = () => {
    if (!form.title.trim()) return;
    onCreate(form);
  };

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <p className="eyebrow">Nyt udbud</p>
          <h3>Opret nyt udbud</h3>
        </div>
      </div>

      <div className="stack">
        <div>
          <label htmlFor="tender-title">Titel</label>
          <input
            id="tender-title"
            className="input"
            value={form.title}
            onChange={update("title")}
            placeholder="Fx Drift af IT-infrastruktur 2027"
          />
        </div>

        <div className="grid two-col" style={{ gap: 16 }}>
          <div>
            <label htmlFor="tender-cpv">CPV / marked</label>
            <select id="tender-cpv" className="input" value={form.cpvCode} onChange={update("cpvCode")}>
              {cpvOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} · {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tender-deadline">Deadline</label>
            <input
              id="tender-deadline"
              className="input"
              type="date"
              value={form.deadline}
              onChange={update("deadline")}
            />
          </div>
        </div>

        <div>
          <label htmlFor="tender-description">Beskrivelse</label>
          <textarea
            id="tender-description"
            className="textarea"
            value={form.description}
            onChange={update("description")}
            placeholder="Kort om opgaven, omfang og krav"
          />
        </div>

        <div>
          <label htmlFor="tender-value">Anslået værdi (valgfri)</label>
          <input
            id="tender-value"
            className="input"
            value={form.estimatedValue}
            onChange={update("estimatedValue")}
            placeholder="Fx 25 mio. DKK"
          />
        </div>

        <div className="button-row">
          <button className="btn btn-primary" onClick={submit} disabled={!form.title.trim()}>
            <Icon name="spark" size={14} />
            Opret og lav markedsanalyse
          </button>
          <button className="btn btn-secondary" onClick={onCancel}>
            Annuller
          </button>
        </div>
      </div>
    </section>
  );
}

function ProjectDetail({ project, onBack, onDelete, onGoToCompany }) {
  const market = cpvOptions.find((c) => c.code === project.cpvCode) || cpvOptions[0];
  const candidateSuppliers = [...suppliers]
    .map((s) => ({ ...s, score: getRelevanceScore(s, project.cpvCode) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const [tedNotices, setTedNotices] = useState([]);
  const [tedLoading, setTedLoading] = useState(true);
  const [tedError, setTedError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setTedLoading(true);
    setTedError(null);

    searchByCPV(project.cpvCode, { limit: 8 })
      .then((data) => {
        if (!cancelled) setTedNotices(data.notices);
      })
      .catch((err) => {
        if (!cancelled) setTedError(err.message || "Kunne ikke hente TED-data.");
      })
      .finally(() => {
        if (!cancelled) setTedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project.cpvCode]);

  return (
    <main className="page">
      <section className="card">
        <div className="space-between mobile-stack">
          <div>
            <p className="eyebrow">Udbud</p>
            <h2 className="hero-title-sm">{project.title}</h2>
            <p className="lede">{project.description || "Ingen beskrivelse"}</p>
          </div>
          <div className="button-row">
            <button className="btn btn-secondary btn-sm" onClick={onBack}>
              <Icon name="back" size={13} />
              Alle udbud
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onDelete(project.id)}>
              Slet udbud
            </button>
          </div>
        </div>

        <div className="tag-row">
          <span className="tag tag--code">
            <span className="tag__key">CPV</span>
            {market.code}
          </span>
          <span className="tag">{market.label}</span>
          {project.deadline && (
            <span className="tag tag--code">
              <span className="tag__key">Deadline</span>
              {project.deadline}
            </span>
          )}
          {project.estimatedValue && (
            <span className="tag">
              <span className="tag__key">Anslået</span>
              {project.estimatedValue}
            </span>
          )}
        </div>
      </section>

      <section className="grid two-one">
        <div className="card">
          <div className="section-header">
            <div>
              <h3>Markedsanalyse</h3>
              <p className="muted small">Nøgletal for CPV-området {market.code}.</p>
            </div>
            <SourceBadge source="demo" label="Fabrikeret demo-data" />
          </div>

          <div className="grid two-col" style={{ gap: 12 }}>
            <div className="stat">
              <p className="stat__label">Typisk kontraktstørrelse</p>
              <span className="stat__value">{market.avgContract}</span>
            </div>
            <div className="stat">
              <p className="stat__label">Markedsmodenhed</p>
              <span className="stat__value">{market.maturity}</span>
            </div>
            <div className="stat">
              <p className="stat__label">Trend</p>
              <span className="stat__value">{market.trend}</span>
            </div>
            <div className="stat">
              <p className="stat__label">Kandidatleverandører</p>
              <span className="stat__value">{candidateSuppliers.length} fundet</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-header">
            <h3>Kandidat-leverandører</h3>
            <SourceBadge source="demo" label="Demo-data" />
          </div>

          <div className="stack">
            {candidateSuppliers.map((supplier) => (
              <div className="subcard" key={supplier.id}>
                <div className="space-between">
                  <strong className="text-sm">{supplier.name}</strong>
                  <span className="score">
                    {supplier.score}
                    <span>/10</span>
                  </span>
                </div>
                <div className="score-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(0, Math.min(10, supplier.score)) * 10}%` }} />
                </div>
                <p className="muted small" style={{ margin: "10px 0 12px" }}>
                  {supplier.description}
                </p>
                <button className="btn btn-secondary btn-sm" onClick={() => onGoToCompany(supplier.name)}>
                  Se virksomhedsprofil
                  <Icon name="arrow" size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={`card ${tedLoading ? "is-working" : ""}`}>
        <div className="section-header">
          <div>
            <h3>Seneste TED-kontrakter i dette marked</h3>
            <p className="muted small">Rigtige, nylige kontrakttildelinger inden for {market.label}.</p>
          </div>
          <SourceBadge source="ted" />
        </div>

        {tedLoading && (
          <div className="stack">
            <Working>Henter kontrakttildelinger fra TED…</Working>
            <SkeletonRows rows={4} />
          </div>
        )}

        {tedError && (
          <div className="empty-state">
            <p className="muted">{tedError}</p>
          </div>
        )}

        {!tedLoading && !tedError && tedNotices.length === 0 && (
          <div className="empty-state">
            <span className="empty-state__icon">
              <Icon name="scales" size={22} />
            </span>
            <h4>Ingen nylige kontrakter fundet for denne CPV-kode</h4>
          </div>
        )}

        <div className="stack">
          {tedNotices.map((notice) => (
            <div className="subcard" key={notice.id}>
              <div className="space-between mobile-stack">
                <div style={{ minWidth: 0 }}>
                  <strong>{notice.winnerName || "Ukendt vinder"}</strong>
                  <div className="tag-row" style={{ marginTop: 6 }}>
                    <span className="tag">
                      <span className="tag__key">Ordregiver</span>
                      {notice.buyerName || "Ukendt"}
                    </span>
                    <span className="tag tag--code">
                      <span className="tag__key">Dato</span>
                      {formatDate(notice.date)}
                    </span>
                  </div>
                </div>
                <div className="align-right" style={{ flex: "none" }}>
                  <p className="stat__label">Værdi</p>
                  <span className="stat__value num">
                    {notice.value != null
                      ? `${notice.value.toLocaleString("da-DK")} ${notice.currency || ""}`.trim()
                      : "Ikke oplyst"}
                  </span>
                  {notice.url && (
                    <div className="button-row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                      <a
                        href={notice.url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-sm btn-secondary"
                      >
                        Se notice
                        <Icon name="external" size={13} />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default function TenderPage({ onGoToCompany }) {
  const { projects, createProject, deleteProject } = useProjects();
  const [mode, setMode] = useState("list"); // list | create
  const [selectedId, setSelectedId] = useState(null);

  const selectedProject = projects.find((p) => p.id === selectedId);

  if (selectedProject) {
    return (
      <ProjectDetail
        project={selectedProject}
        onBack={() => setSelectedId(null)}
        onDelete={(id) => {
          deleteProject(id);
          setSelectedId(null);
        }}
        onGoToCompany={onGoToCompany}
      />
    );
  }

  return (
    <main className="page">
      <section className="card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Markedsbillede</p>
            <h3>Udbud &amp; markedsanalyse</h3>
            <p className="lede">
              Opret et udbud og få en markedsanalyse: marked, kandidat-leverandører og reelle
              TED-referencer for det pågældende CPV-område.
            </p>
          </div>
          {mode === "list" && (
            <button className="btn btn-primary" onClick={() => setMode("create")}>
              <Icon name="plus" size={14} />
              Opret nyt udbud
            </button>
          )}
        </div>

        <div className="card-foot">
          <span className="eyebrow" style={{ margin: 0 }}>
            Kilder
          </span>
          <div className="source-row">
            <SourceBadge source="ted" />
            <SourceBadge source="demo" label="Markedsnøgletal og kandidater" />
          </div>
        </div>
      </section>

      {mode === "create" && (
        <CreateProjectForm
          onCancel={() => setMode("list")}
          onCreate={(form) => {
            const project = createProject({
              ...form,
              estimatedValue: form.estimatedValue.trim() || null
            });
            setMode("list");
            setSelectedId(project.id);
          }}
        />
      )}

      {mode === "list" && (
        <section>
          {projects.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__icon">
                <Icon name="doc" size={22} />
              </span>
              <h4>Ingen udbud oprettet endnu</h4>
              <p className="muted">Klik "Opret nyt udbud" for at komme i gang.</p>
            </div>
          ) : (
            <div className="grid two-col">
              {projects.map((project) => {
                const market = cpvOptions.find((c) => c.code === project.cpvCode);
                return (
                  <div className="card supplier-card" key={project.id}>
                    <div>
                      <h4>{project.title}</h4>
                      <p className="muted small" style={{ margin: 0 }}>
                        {project.description || "Ingen beskrivelse"}
                      </p>
                    </div>
                    <div className="tag-row" style={{ margin: 0 }}>
                      <span className="tag">{market?.label || project.cpvCode}</span>
                      {project.deadline && (
                        <span className="tag tag--code">
                          <span className="tag__key">Deadline</span>
                          {project.deadline}
                        </span>
                      )}
                    </div>
                    <div className="button-row" style={{ marginTop: "auto" }}>
                      <button className="btn btn-primary btn-sm" onClick={() => setSelectedId(project.id)}>
                        Åbn markedsanalyse
                        <Icon name="arrow" size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
