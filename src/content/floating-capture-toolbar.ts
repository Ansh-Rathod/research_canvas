/**
 * Floating capture bar — keep action strings as literals (no @shared runtime import)
 * so the content bundle stays a single script for MV3.
 */

const TOOLBAR_ID = "research-canvas-float-toolbar-root";
const TOOLBAR_POS_KEY = "research-canvas-float-toolbar-pos";
export const FLOATING_TOOLBAR_HIDDEN_KEY = "floatingToolbarHidden";

/** Filled “panel + main” icon (Chrome side panel open/close). */
const ICON_TOGGLE_SIDE_PANEL =
  "M3 3h6v18H3V3zm9 3h10v12H12V6z";
/** Stroked X — hide toolbar (fill-only svg would not draw line paths). */
const ICON_HIDE_STROKE = "M6 6l12 12M18 6L6 18";

type ToolbarAction =
  | "capture-area-image"
  | "record-area-video"
  | "capture-element-region"
  | "record-element-region"
  | "capture-url-card"
  | "capture-selected-text-heading"
  | "capture-selected-text-body"
  | "capture-selected-text-note"
  | "capture-selected-text-quote";

const DEFAULT_BUTTONS: {
  action: ToolbarAction;
  title: string;
  path: string;
}[] = [
  {
    action: "capture-area-image",
    title: "Capture selected area (image)",
    path: "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z",
  },
  {
    action: "record-area-video",
    title: "Record selected area (video)",
    path: "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z",
  },
  {
    action: "capture-element-region",
    title: "Capture region (hover & click)",
    path: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z",
  },
  {
    action: "record-element-region",
    title: "Record region (hover & click)",
    path: "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4zM15 13H6v-2h9v2zm0-4H6V7h9v2z",
  },
  {
    action: "capture-url-card",
    title: "Save URL as card",
    path: "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1H8v1.9h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
  },
];

const TEXT_BUTTONS: { action: ToolbarAction; title: string; path: string }[] = [
  {
    action: "capture-selected-text-heading",
    title: "Add selection as heading",
    path: "M5 4v3h5.5V4h2v16h-2v-6H5v3l-5-4 5-4zm14 0l-5 4 5 4v-3h5.5V4h-2v6H14V4h-2v3z",
  },
  {
    action: "capture-selected-text-body",
    title: "Add selection as text",
    path: "M3 17.25V21h1.75L17.81 9.94l-1.75-1.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  },
  {
    action: "capture-selected-text-note",
    title: "Add selection as note",
    path: "M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z",
  },
  {
    action: "capture-selected-text-quote",
    title: "Add selection as quote",
    path: "M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z",
  },
];

function debounce(fn: () => void, ms: number): () => void {
  let t: number | undefined;
  return () => {
    if (t !== undefined) window.clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
}

function loadToolbarPos(): { left: number; top: number } | null {
  try {
    const raw = localStorage.getItem(TOOLBAR_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { left?: number; top?: number };
    if (
      typeof p.left === "number" &&
      Number.isFinite(p.left) &&
      typeof p.top === "number" &&
      Number.isFinite(p.top)
    ) {
      return { left: p.left, top: p.top };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveToolbarPos(left: number, top: number): void {
  try {
    localStorage.setItem(TOOLBAR_POS_KEY, JSON.stringify({ left, top }));
  } catch {
    /* ignore */
  }
}

function clampToolbarToViewport(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const w = r.width;
  const h = r.height;
  const maxL = Math.max(0, window.innerWidth - w);
  const maxT = Math.max(0, window.innerHeight - h);
  let left = parseFloat(el.style.left) || r.left;
  let top = parseFloat(el.style.top) || r.top;
  left = Math.min(Math.max(0, left), maxL);
  top = Math.min(Math.max(0, top), maxT);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
}

function attachToolbarDrag(root: HTMLElement): void {
  const handle = root.querySelector<HTMLElement>(
    "[data-research-canvas-toolbar-drag-handle]",
  );
  if (!handle) return;

  let dragging = false;
  let startClientX = 0;
  let startClientY = 0;
  let startLeft = 0;
  let startTop = 0;

  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startClientX;
    const dy = e.clientY - startClientY;
    let left = startLeft + dx;
    let top = startTop + dy;
    const r = root.getBoundingClientRect();
    const maxL = Math.max(0, window.innerWidth - r.width);
    const maxT = Math.max(0, window.innerHeight - r.height);
    left = Math.min(Math.max(0, left), maxL);
    top = Math.min(Math.max(0, top), maxT);
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
  };

  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture(e.pointerId);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    const left = parseFloat(root.style.left);
    const top = parseFloat(root.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) {
      saveToolbarPos(left, top);
    }
    handle.style.cursor = "grab";
  };

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = root.getBoundingClientRect();
    startLeft = r.left;
    startTop = r.top;
    root.style.left = `${Math.round(startLeft)}px`;
    root.style.top = `${Math.round(startTop)}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
    startClientX = e.clientX;
    startClientY = e.clientY;
    dragging = true;
    handle.style.cursor = "grabbing";
    handle.setPointerCapture(e.pointerId);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
}

function svgIcon(pathD: string, accessibleName?: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");
  if (accessibleName) {
    const t = document.createElementNS(ns, "title");
    t.textContent = accessibleName;
    svg.append(t);
  }
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", pathD);
  svg.append(p);
  return svg;
}

function svgIconStroke(pathD: string, accessibleName: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  const t = document.createElementNS(ns, "title");
  t.textContent = accessibleName;
  svg.append(t);
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", pathD);
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "2.25");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  svg.append(p);
  return svg;
}

function triggerCapture(action: ToolbarAction): void {
  void chrome.runtime.sendMessage({
    type: "TRIGGER_CAPTURE",
    action,
  });
}

export function unmountFloatingCaptureToolbar(): void {
  document.getElementById(TOOLBAR_ID)?.remove();
}

export function mountFloatingCaptureToolbar(options?: {
  onRecordingAction?: (
    action: "record-area-video" | "record-element-region",
  ) => void;
}): void {
  if (document.getElementById(TOOLBAR_ID)) return;

  const root = document.createElement("div");
  root.id = TOOLBAR_ID;
  root.setAttribute("data-research-canvas-float-toolbar", "");
  Object.assign(root.style, {
    position: "fixed",
    zIndex: "2147483630",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "0",
    maxHeight: "min(100vh - 24px, 560px)",
    overflowY: "auto",
    padding: "0",
    borderRadius: "12px",
    background: "#ffffff",
    boxShadow:
      "0 4px 6px -1px rgba(0,0,0,0.08), 0 10px 24px -4px rgba(0,0,0,0.1)",
    border: "1px solid #e5e7eb",
    pointerEvents: "auto",
    fontFamily: "system-ui, -apple-system, sans-serif",
  });

  const saved = loadToolbarPos();
  if (saved) {
    root.style.left = `${Math.round(saved.left)}px`;
    root.style.top = `${Math.round(saved.top)}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
  } else {
    root.style.top = "12px";
    root.style.right = "12px";
    root.style.left = "auto";
    root.style.bottom = "auto";
  }

  const handle = document.createElement("div");
  handle.setAttribute("data-research-canvas-toolbar-drag-handle", "");
  handle.title = "Drag to move";
  handle.setAttribute("aria-label", "Drag to move toolbar");
  Object.assign(handle.style, {
    flexShrink: "0",
    padding: "6px 10px 4px",
    cursor: "grab",
    userSelect: "none",
    touchAction: "none",
    borderBottom: "1px solid #e5e7eb",
    borderRadius: "12px 12px 0 0",
    background: "linear-gradient(to bottom, #fafafa, #ffffff)",
  });
  const grip = document.createElement("div");
  Object.assign(grip.style, {
    height: "4px",
    width: "28px",
    margin: "0 auto",
    borderRadius: "2px",
    background:
      "repeating-linear-gradient(90deg, #9ca3af 0 2px, transparent 2px 4px)",
    opacity: "0.85",
  });
  handle.append(grip);
  root.append(handle);

  const inner = document.createElement("div");
  Object.assign(inner.style, {
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
  });
  root.append(inner);

  const utilityRow = document.createElement("div");
  Object.assign(utilityRow.style, {
    display: "flex",
    flexDirection: "column",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: "6px",
    width: "100%",
    paddingBottom: "6px",
    marginBottom: "2px",
    borderBottom: "1px solid #e5e7eb",
  });

  function addUtilityButton(
    tooltip: string,
    onClick: () => void,
    icon: SVGSVGElement,
  ) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = tooltip;
    btn.setAttribute("aria-label", tooltip);
    Object.assign(btn.style, {
      display: "grid",
      placeItems: "center",
      width: "36px",
      height: "36px",
      padding: "0",
      border: "none",
      borderRadius: "8px",
      background: "#f3f4f6",
      color: "#111827",
      cursor: "pointer",
    });
    btn.append(icon);
    btn.onmouseenter = () => {
      btn.style.background = "#e5e7eb";
    };
    btn.onmouseleave = () => {
      btn.style.background = "#f3f4f6";
    };
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    };
    utilityRow.append(btn);
  }

  addUtilityButton(
    "Open or close Research Canvas in the browser side panel (same as clicking the extension icon)",
    () => {
      void chrome.runtime.sendMessage({
        type: "TOGGLE_CHROME_SIDE_PANEL",
      });
    },
    svgIcon(
      ICON_TOGGLE_SIDE_PANEL,
      "Open or close Research Canvas side panel",
    ),
  );
  addUtilityButton(
    "Hide this toolbar — right-click the page → “Show Research Canvas floating toolbar” to bring it back",
    () => {
      void chrome.storage.local.set({ [FLOATING_TOOLBAR_HIDDEN_KEY]: true });
      root.remove();
    },
    svgIconStroke(
      ICON_HIDE_STROKE,
      "Hide floating toolbar (restore from the page context menu)",
    ),
  );

  inner.append(utilityRow);

  const bar = document.createElement("div");
  bar.style.display = "flex";
  bar.style.flexDirection = "column";
  bar.style.flexWrap = "nowrap";
  bar.style.gap = "6px";
  bar.style.alignItems = "center";
  inner.append(bar);

  function render() {
    bar.replaceChildren();
    const sel = window.getSelection()?.toString().trim() ?? "";
    const textMode = sel.length > 0;
    const defs = textMode ? TEXT_BUTTONS : DEFAULT_BUTTONS;
    for (const def of defs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = def.title;
      btn.setAttribute("aria-label", def.title);
      Object.assign(btn.style, {
        display: "grid",
        placeItems: "center",
        width: "36px",
        height: "36px",
        padding: "0",
        border: "none",
        borderRadius: "8px",
        background: "#f3f4f6",
        color: "#111827",
        cursor: "pointer",
      });
      btn.append(svgIcon(def.path, def.title));
      btn.onmouseenter = () => {
        btn.style.background = "#e5e7eb";
      };
      btn.onmouseleave = () => {
        btn.style.background = "#f3f4f6";
      };
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (
          (def.action === "record-area-video" ||
            def.action === "record-element-region") &&
          options?.onRecordingAction
        ) {
          options.onRecordingAction(def.action);
          return;
        }
        triggerCapture(def.action);
      };
      bar.append(btn);
    }
  }

  const onSel = debounce(() => render(), 120);
  document.addEventListener("selectionchange", onSel);
  render();

  document.body.append(root);
  if (saved) {
    requestAnimationFrame(() => clampToolbarToViewport(root));
  }

  const onResize = () => clampToolbarToViewport(root);
  window.addEventListener("resize", onResize);

  attachToolbarDrag(root);
}
