import React from "react";
import { createRoot } from "react-dom/client";
import { ResearchCanvasApp } from "../tldraw/App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ResearchCanvasApp />
  </React.StrictMode>
);
