import { useEffect, useState } from "react";
import Icon from "../ui/Icon";

// Rent visuel indstilling. Lys er default — et virksomhedsopslag ender ofte
// som bilag i udbudsmaterialet, og det printes og skærmklippes bedst lyst.
// Uden et valg følger appen styresystemet (se prefers-color-scheme i
// index.css); et valg stemples på <html data-theme> og vinder begge veje.

const STORAGE_KEY = "markedsanalyse.theme";

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    return null;
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme) {
      root.setAttribute("data-theme", theme);
    } else {
      root.removeAttribute("data-theme");
    }
    try {
      if (theme) localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* private mode — indstillingen holder bare kun sessionen ud */
    }
  }, [theme]);

  // Uden et gemt valg kender vi først styresystemets tilstand her.
  const systemDark =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  const isDark = theme ? theme === "dark" : systemDark;

  return (
    <button
      type="button"
      className="icon-button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Skift til lys visning" : "Skift til mørk visning"}
      title={isDark ? "Lys visning" : "Mørk visning"}
    >
      <Icon name={isDark ? "sun" : "moon"} size={15} />
    </button>
  );
}
