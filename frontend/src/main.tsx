import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App";
import { DEMO_MODE } from "./demo/demoMode";
import "./styles/index.css";

// Demo builds deploy to static hosting (GitHub Pages) where deep links like
// /town/dover would 404 on refresh — hash routing keeps every route on the
// single index.html. Live builds keep clean BrowserRouter URLs.
const Router = DEMO_MODE ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>
);
