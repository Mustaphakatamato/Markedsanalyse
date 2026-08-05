import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "markedsanalyse.projects";

const ProjectsContext = createContext(null);

function loadProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function ProjectsProvider({ children }) {
  const [projects, setProjects] = useState(loadProjects);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  const createProject = ({ title, cpvCode, description, deadline, estimatedValue }) => {
    const project = {
      id: crypto.randomUUID(),
      title: title.trim(),
      cpvCode,
      description: description.trim(),
      deadline: deadline || null,
      estimatedValue: estimatedValue || null,
      createdAt: new Date().toISOString()
    };
    setProjects((prev) => [project, ...prev]);
    return project;
  };

  const deleteProject = (id) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <ProjectsContext.Provider value={{ projects, createProject, deleteProject }}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects skal bruges inde i en ProjectsProvider");
  return ctx;
}
