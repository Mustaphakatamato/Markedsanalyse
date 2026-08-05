import { useEffect, useState } from "react";
import { useProjects } from "../context/ProjectsContext";
import { cpvOptions } from "../data/cpvOptions";
import { suppliers, getRelevanceScore } from "../data/suppliers";
import { searchByCPV } from "../services/tedService";

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
      <h3>Opret nyt udbud</h3>
      <div className="stack">
        <div>
          <label>Titel</label>
          <input className="input" value={form.title} onChange={update("title")} placeholder="Fx Drift af IT-infrastruktur 2027" />
        </div>

        <div className="grid two-col inner-gap">
          <div>
            <label>CPV / marked</label>
            <select className="input" value={form.cpvCode} onChange={update("cpvCode")}>
              {cpvOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} · {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Deadline</label>
            <input className="input" type="date" value={form.deadline} onChange={update("deadline")} />
          </div>
        </div>

        <div>
          <label>Beskrivelse</label>
          <textarea
            className="textarea"
            value={form.description}
            onChange={update("description")}
            placeholder="Kort om opgaven, omfang og krav"
          />
        </div>

        <div>
          <label>Anslået værdi (valgfri)</label>
          <input
            className="input"
            value={form.estimatedValue}
            onChange={update("estimatedValue")}
            placeholder="Fx 25 mio. DKK"
          />
        </div>

        <div className="button-row">
          <button className="btn btn-primary" onClick={submit} disabled={!form.title.trim()}>
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
            <p className="muted">{project.description || "Ingen beskrivelse"}</p>
          </div>
          <div className="button-row">
            <button className="btn btn-secondary" onClick={onBack}>
              ← Alle udbud
            </button>
            <button className="btn btn-secondary" onClick={() => onDelete(project.id)}>
              Slet udbud
            </button>
          </div>
        </div>

        <div className="tag-row">
          <span className="tag">{market.code}</span>
          <span className="tag">{market.label}</span>
          {project.deadline && <span className="tag">Deadline {project.deadline}</span>}
          {project.estimatedValue && <span className="tag">Anslået {project.estimatedValue}</span>}
        </div>
      </section>

      <section className="grid two-one">
        <div className="card">
          <div className="space-between">
            <h3>Markedsanalyse</h3>
            <span className="pill">{market.code}</span>
          </div>
          <div className="grid two-col inner-gap">
            <div className="subcard">
              <p className="small muted">Typisk kontraktstørrelse</p>
              <strong>{market.avgContract}</strong>
            </div>
            <div className="subcard">
              <p className="small muted">Markedsmodenhed</p>
              <strong>{market.maturity}</strong>
            </div>
            <div className="subcard">
              <p className="small muted">Trend</p>
              <strong>{market.trend}</strong>
            </div>
            <div className="subcard">
              <p className="small muted">Kandidatleverandører</p>
              <strong>{candidateSuppliers.length} fundet</strong>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Kandidat-leverandører</h3>
          <div className="stack">
            {candidateSuppliers.map((supplier) => (
              <div className="subcard" key={supplier.id}>
                <div className="space-between">
                  <strong>{supplier.name}</strong>
                  <span className="pill">{supplier.score}/10</span>
                </div>
                <p className="muted small">{supplier.description}</p>
                <button className="btn btn-secondary btn-sm" onClick={() => onGoToCompany(supplier.name)}>
                  Se virksomhedsprofil →
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h3>Seneste TED-kontrakter i dette marked</h3>
            <p className="muted">Rigtige, nylige kontrakttildelinger inden for {market.label}.</p>
          </div>
          <span className="pill">Rigtig data</span>
        </div>

        {tedError && (
          <div className="empty-state">
            <p className="muted">{tedError}</p>
          </div>
        )}

        {!tedLoading && !tedError && tedNotices.length === 0 && (
          <div className="empty-state">
            <h4>Ingen nylige kontrakter fundet for denne CPV-kode</h4>
          </div>
        )}

        <div className="stack">
          {tedNotices.map((notice) => (
            <div className="subcard" key={notice.id}>
              <div className="space-between mobile-stack">
                <div>
                  <strong>{notice.winnerName || "Ukendt vinder"}</strong>
                  <p className="muted small">Ordregiver: {notice.buyerName || "Ukendt"}</p>
                </div>
                <div className="align-right">
                  <p>
                    Værdi:{" "}
                    {notice.value != null
                      ? `${notice.value.toLocaleString("da-DK")} ${notice.currency || ""}`
                      : "Ikke oplyst"}
                  </p>
                  <p>Dato: {formatDate(notice.date)}</p>
                  {notice.url && (
                    <a href={notice.url} target="_blank" rel="noreferrer">
                      Se notice →
                    </a>
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
            <h3>Udbud &amp; markedsanalyse</h3>
            <p className="muted">
              Opret et udbud og få en markedsanalyse: marked, kandidat-leverandører og reelle
              TED-referencer for det pågældende CPV-område.
            </p>
          </div>
          {mode === "list" && (
            <button className="btn btn-primary" onClick={() => setMode("create")}>
              + Opret nyt udbud
            </button>
          )}
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
              <h4>Ingen udbud oprettet endnu</h4>
              <p className="muted">Klik "Opret nyt udbud" for at komme i gang.</p>
            </div>
          ) : (
            <div className="grid two-col">
              {projects.map((project) => {
                const market = cpvOptions.find((c) => c.code === project.cpvCode);
                return (
                  <div className="card supplier-card" key={project.id}>
                    <h4>{project.title}</h4>
                    <p className="muted">{project.description || "Ingen beskrivelse"}</p>
                    <div className="tag-row">
                      <span className="tag">{market?.label || project.cpvCode}</span>
                      {project.deadline && <span className="tag">Deadline {project.deadline}</span>}
                    </div>
                    <div className="button-row">
                      <button className="btn btn-primary" onClick={() => setSelectedId(project.id)}>
                        Åbn markedsanalyse
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
