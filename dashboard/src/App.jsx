import { lazy, Suspense, useEffect, useState } from "react";
import Home from "./Home.jsx";
import "./styles.css";

// The dashboard (React Flow, Recharts, three.js) loads only when a dashboard view is opened.
const Dashboard = lazy(() => import("./Dashboard.jsx"));

// Hash routes keep the static Vercel deploy free of rewrite rules. Anything else is the homepage.
const ROUTES = { "#/twin": "2d", "#/3d": "3d", "#/compare": "compare" };

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => { setHash(window.location.hash); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

// Dark by default. The attribute is set before React renders, because the 3D view and the
// React Flow grid read resolved CSS colors during render.
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme);
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
  return theme;
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    let saved = null;
    try {
      saved = localStorage.getItem("theme");
    } catch {
      /* storage unavailable */
    }
    return applyTheme(saved === "light" ? "light" : "dark");
  });
  return [theme, () => setTheme(applyTheme(theme === "dark" ? "light" : "dark"))];
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const hash = useHash();
  const view = ROUTES[hash];
  return view
    ? <Suspense fallback={null}><Dashboard view={view} hash={hash} theme={theme} toggleTheme={toggleTheme} /></Suspense>
    : <Home theme={theme} toggleTheme={toggleTheme} />;
}
