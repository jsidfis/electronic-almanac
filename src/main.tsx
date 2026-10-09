import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, resolveWindowView } from "./App";
import "./styles.css";

const view = resolveWindowView(window.location.search);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App view={view} />
  </StrictMode>,
);
