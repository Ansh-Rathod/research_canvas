/**
 * Floating capture bar — keep action strings as literals (no @shared runtime import)
 * so the content bundle stays a single script for MV3.
 */

const TOOLBAR_ID = "research-canvas-float-toolbar-root";
const TOOLBAR_POS_KEY = "research-canvas-float-toolbar-pos";
const TOOLTIP_EL_ID = "research-canvas-toolbar-tooltip";
export const FLOATING_TOOLBAR_HIDDEN_KEY = "floatingToolbarHidden";

let tooltipShowTimer: number | undefined;

/**
 * `document.body` can still be null when the content script runs (heavy SPAs, iframes).
 * `document.body.append` throws and fails the entire content script. `<html>` always exists.
 */
function appendToBody(node: HTMLElement): void {
  if (document.body) {
    document.body.append(node);
    return;
  }
  document.documentElement.append(node);
}

function getTooltipEl(): HTMLDivElement {
  let el = document.getElementById(TOOLTIP_EL_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = TOOLTIP_EL_ID;
    el.setAttribute("role", "tooltip");
    Object.assign(el.style, {
      position: "fixed",
      zIndex: "2147483647",
      pointerEvents: "none",
      padding: "7px 10px",
      fontSize: "12px",
      lineHeight: "1.4",
      maxWidth: "min(280px, calc(100vw - 24px))",
      background: "rgba(17,24,39,0.94)",
      color: "#f9fafb",
      borderRadius: "8px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
      fontFamily: "system-ui, -apple-system, sans-serif",
      visibility: "hidden",
      opacity: "0",
      transition: "opacity 0.08s ease",
      left: "0",
      top: "0",
    });
    appendToBody(el);
  }
  return el;
}

function positionTooltipNear(anchor: HTMLElement): void {
  const el = getTooltipEl();
  const r = anchor.getBoundingClientRect();
  const margin = 8;
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin));
  let top = r.bottom + margin;
  if (top + th > window.innerHeight - margin) {
    top = r.top - th - margin;
  }
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(Math.max(margin, top))}px`;
}

function showFloatingTooltip(text: string, anchor: HTMLElement): void {
  clearTooltipShowTimer();
  tooltipShowTimer = window.setTimeout(() => {
    tooltipShowTimer = undefined;
    const el = getTooltipEl();
    el.textContent = text;
    el.style.visibility = "visible";
    el.style.opacity = "1";
    requestAnimationFrame(() => positionTooltipNear(anchor));
  }, 200);
}

function clearTooltipShowTimer(): void {
  if (tooltipShowTimer !== undefined) {
    window.clearTimeout(tooltipShowTimer);
    tooltipShowTimer = undefined;
  }
}

function hideFloatingTooltip(): void {
  clearTooltipShowTimer();
  const el = document.getElementById(TOOLTIP_EL_ID);
  if (el) {
    el.style.visibility = "hidden";
    el.style.opacity = "0";
  }
}

function bindHoverTooltip(el: HTMLElement, text: string): void {
  el.addEventListener("mouseenter", () => showFloatingTooltip(text, el));
  el.addEventListener("mouseleave", hideFloatingTooltip);
  el.addEventListener("focus", () => showFloatingTooltip(text, el));
  el.addEventListener("blur", hideFloatingTooltip);
}

/** Lets hover hit the `<button>` so tooltips and cursor stay consistent. */
function disableSvgPointerEvents(button: HTMLElement): void {
  for (const svg of button.querySelectorAll("svg")) {
    (svg as SVGSVGElement).style.pointerEvents = "none";
  }
}

function removeFloatingTooltipNode(): void {
  hideFloatingTooltip();
  document.getElementById(TOOLTIP_EL_ID)?.remove();
}

/** Filled “panel + main” icon (Chrome side panel open/close). */
const ICON_TOGGLE_SIDE_PANEL =
  "m12.748 4.001-.001.002h7.498c.967 0 1.75.784 1.75 1.75v12.495a1.75 1.75 0 0 1-1.75 1.75h-8.997l-.001-.002H3.75A1.75 1.75 0 0 1 2 18.246V5.751c0-.967.784-1.75 1.75-1.75h8.998Zm7.497 1.502h-7.497v12.995h7.497a.25.25 0 0 0 .25-.25V5.754a.25.25 0 0 0-.25-.25Zm-8.997-.002H3.75a.25.25 0 0 0-.25.25v12.495c0 .138.112.25.25.25h7.498V5.501Zm7.502.999a.75.75 0 0 1 0 1.5h-4.502a.75.75 0 0 1 0-1.5h4.502Z";
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
    path: "M17.75 3A3.25 3.25 0 0 1 21 6.25v11.5A3.25 3.25 0 0 1 17.75 21H6.25A3.25 3.25 0 0 1 3 17.75V6.25A3.25 3.25 0 0 1 6.25 3h11.5Zm.58 16.401-5.805-5.686a.75.75 0 0 0-.966-.071l-.084.07-5.807 5.687c.182.064.378.099.582.099h11.5c.203 0 .399-.035.58-.099l-5.805-5.686L18.33 19.4ZM17.75 4.5H6.25A1.75 1.75 0 0 0 4.5 6.25v11.5c0 .208.036.408.103.594l5.823-5.701a2.25 2.25 0 0 1 3.02-.116l.128.116 5.822 5.702c.067-.186.104-.386.104-.595V6.25a1.75 1.75 0 0 0-1.75-1.75Zm-2.498 2a2.252 2.252 0 1 1 0 4.504 2.252 2.252 0 0 1 0-4.504Zm0 1.5a.752.752 0 1 0 0 1.504.752.752 0 0 0 0-1.504Z",
  },
  {
    action: "record-area-video",
    title: "Record selected area (video)",
    path: "M6.25 4h11.5a3.25 3.25 0 0 1 3.245 3.066L21 7.25v9.5a3.25 3.25 0 0 1-3.066 3.245L17.75 20H6.25a3.25 3.25 0 0 1-3.245-3.066L3 16.75v-9.5a3.25 3.25 0 0 1 3.066-3.245L6.25 4h11.5-11.5Zm11.5 1.5H6.25a1.75 1.75 0 0 0-1.744 1.606L4.5 7.25v9.5a1.75 1.75 0 0 0 1.606 1.744l.144.006h11.5a1.75 1.75 0 0 0 1.744-1.607l.006-.143v-9.5a1.75 1.75 0 0 0-1.607-1.744L17.75 5.5Zm-7.697 4.085a.5.5 0 0 1 .587-.256l.084.033 4.382 2.19a.5.5 0 0 1 .076.848l-.076.047-4.382 2.191a.5.5 0 0 1-.716-.357L10 14.19V9.809a.5.5 0 0 1 .053-.224Z",
  },
  {
    action: "capture-element-region",
    title: "Capture region (hover & click)",
    path: "M21.25 13a.75.75 0 0 1 .743.648l.007.102v5a3.25 3.25 0 0 1-3.066 3.245L18.75 22h-4.668c.536-.385.973-.9 1.265-1.499l3.403-.001a1.75 1.75 0 0 0 1.744-1.607l.006-.143v-5a.75.75 0 0 1 .75-.75Zm-9.5-4A3.25 3.25 0 0 1 15 12.25v6.5A3.25 3.25 0 0 1 11.75 22h-6.5A3.25 3.25 0 0 1 2 18.75v-6.5A3.25 3.25 0 0 1 5.25 9h6.5Zm-4.032 8.353-.102.091L4.663 20.4c.184.066.381.101.587.101h6.5c.206 0 .403-.035.587-.1l-2.953-2.955a1.25 1.25 0 0 0-1.558-.17l-.108.078ZM11.75 10.5h-6.5a1.75 1.75 0 0 0-1.75 1.75v6.5c0 .206.036.403.1.587l2.955-2.953a2.75 2.75 0 0 1 3.752-.129l.138.129 2.954 2.953c.066-.184.101-.381.101-.587v-6.5a1.75 1.75 0 0 0-1.75-1.75ZM11 12a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm7.75-10a3.25 3.25 0 0 1 3.245 3.066L22 5.25v5a.75.75 0 0 1-1.493.102l-.007-.102v-5a1.75 1.75 0 0 0-1.606-1.744L18.75 3.5h-5a.75.75 0 0 1-.102-1.493L13.75 2h5Zm-8.5 0a.75.75 0 0 1 .102 1.493l-.102.007h-5a1.75 1.75 0 0 0-1.744 1.606L3.5 5.25v3.402c-.6.292-1.114.73-1.5 1.266V5.25a3.25 3.25 0 0 1 3.066-3.245L5.25 2h5Z",
  },
  {
    action: "record-element-region",
    title: "Record region (hover & click)",
    path: "M21.25 13a.75.75 0 0 1 .743.648l.007.102v5a3.25 3.25 0 0 1-3.066 3.245L18.75 22h-4.668c.536-.385.973-.9 1.265-1.499l3.403-.001a1.75 1.75 0 0 0 1.744-1.607l.006-.143v-5a.75.75 0 0 1 .75-.75Zm-9.5-4A3.25 3.25 0 0 1 15 12.25v6.5A3.25 3.25 0 0 1 11.75 22h-6.5A3.25 3.25 0 0 1 2 18.75v-6.5A3.25 3.25 0 0 1 5.25 9h6.5Zm0 1.5h-6.5a1.75 1.75 0 0 0-1.75 1.75v6.5c0 .966.784 1.75 1.75 1.75h6.5a1.75 1.75 0 0 0 1.75-1.75v-6.5a1.75 1.75 0 0 0-1.75-1.75Zm-5.689 2.603a.5.5 0 0 1 .596-.236l.082.036 3.956 2.158a.5.5 0 0 1 .075.828l-.075.05-3.956 2.158a.5.5 0 0 1-.73-.35L6 17.658v-4.315a.5.5 0 0 1 .061-.24ZM18.75 2a3.25 3.25 0 0 1 3.245 3.066L22 5.25v5a.75.75 0 0 1-1.493.102l-.007-.102v-5a1.75 1.75 0 0 0-1.606-1.744L18.75 3.5h-5a.75.75 0 0 1-.102-1.493L13.75 2h5Zm-8.5 0a.75.75 0 0 1 .102 1.493l-.102.007h-5a1.75 1.75 0 0 0-1.744 1.606L3.5 5.25v3.402c-.6.292-1.114.73-1.5 1.266V5.25a3.25 3.25 0 0 1 3.066-3.245L5.25 2h5Z",
  },
  {
    action: "capture-url-card",
    title: "Save URL as card",
    path: "M6.19 21.854a.75.75 0 0 1-1.188-.61V6.25a3.25 3.25 0 0 1 3.25-3.25h7.499A3.25 3.25 0 0 1 19 6.249v14.996a.75.75 0 0 1-1.188.609l-5.811-4.181-5.812 4.18ZM17.5 6.249a1.75 1.75 0 0 0-1.75-1.75H8.253a1.75 1.75 0 0 0-1.75 1.75v13.532l5.062-3.64a.75.75 0 0 1 .876 0l5.06 3.64V6.25Z",
  },
];

const TEXT_BUTTONS: { action: ToolbarAction; title: string; path: string }[] = [
  {
    action: "capture-selected-text-heading",
    title: "Add selection as heading",
    path: "M19.59 5.081a.746.746 0 0 0-.809.084.751.751 0 0 0-.249.367c-.69 2.051-2.057 3.409-3.168 4.075a.75.75 0 0 0 .772 1.286c.774-.464 1.623-1.18 2.364-2.146v9.503a.75.75 0 0 0 1.5 0V5.772a.75.75 0 0 0-.41-.69ZM3.5 5.75a.75.75 0 0 0-1.5 0v12.5a.75.75 0 0 0 1.5 0V12.5H10v5.75a.75.75 0 0 0 1.5 0V5.75a.75.75 0 0 0-1.5 0V11H3.5V5.75Z",
  },
  {
    action: "capture-selected-text-body",
    title: "Add selection as text",
    path: "M5 4.75A.75.75 0 0 1 5.75 4h12.5a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0V5.5h-4.75v13h1.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5h1.5v-13H6.5v1.25a.75.75 0 0 1-1.5 0v-2Z",
  },
  {
    action: "capture-selected-text-note",
    title: "Add selection as note",
    path: "M17.75 3A3.25 3.25 0 0 1 21 6.25v6.879a2.25 2.25 0 0 1-.659 1.59l-5.621 5.622a2.25 2.25 0 0 1-1.591.659H6.25A3.25 3.25 0 0 1 3 17.75V6.25A3.25 3.25 0 0 1 6.25 3h11.5Zm0 1.5H6.25A1.75 1.75 0 0 0 4.5 6.25v11.5c0 .966.784 1.75 1.75 1.75H13v-3.25a3.25 3.25 0 0 1 3.066-3.245L16.25 13h3.25V6.25a1.75 1.75 0 0 0-1.75-1.75Zm.689 10H16.25a1.75 1.75 0 0 0-1.744 1.607l-.006.143v2.189l3.939-3.939Z",
  },
  {
    action: "capture-selected-text-quote",
    title: "Add selection as quote",
    path: "M7.5 6a2.5 2.5 0 0 1 2.495 2.336l.005.206c-.01 3.555-1.24 6.614-3.705 9.223a.75.75 0 1 1-1.09-1.03c1.64-1.737 2.66-3.674 3.077-5.859A2.5 2.5 0 1 1 7.5 6Zm9 0a2.5 2.5 0 0 1 2.495 2.336l.005.206c-.01 3.56-1.238 6.614-3.705 9.223a.75.75 0 1 1-1.09-1.03c1.643-1.738 2.662-3.672 3.078-5.859A2.5 2.5 0 1 1 16.5 6Zm-9 1.5a1 1 0 1 0 .993 1.117l.007-.124a1 1 0 0 0-1-.993Zm9 0a1 1 0 1 0 .993 1.117l.007-.124a1 1 0 0 0-1-.993Z",
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

function svgIcon(pathD: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", pathD);
  svg.append(p);
  return svg;
}

function svgIconStroke(pathD: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("viewBox", "0 0 26 26");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", pathD);
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "2.5");
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
  removeFloatingTooltipNode();
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
  bindHoverTooltip(handle, "Drag to move toolbar");
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
    disableSvgPointerEvents(btn);
    bindHoverTooltip(btn, tooltip);
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
    "Open or close Research Canvas",
    () => {
      void chrome.runtime.sendMessage({
        type: "TOGGLE_CHROME_SIDE_PANEL",
      });
    },
    svgIcon(ICON_TOGGLE_SIDE_PANEL),
  );
  addUtilityButton(
    "Hide this toolbar — right-click the page → “Show Research Canvas floating toolbar” to bring it back",
    () => {
      void chrome.storage.local.set({ [FLOATING_TOOLBAR_HIDDEN_KEY]: true });
      removeFloatingTooltipNode();
      root.remove();
    },
    svgIconStroke(ICON_HIDE_STROKE),
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
      btn.append(svgIcon(def.path));
      disableSvgPointerEvents(btn);
      bindHoverTooltip(btn, def.title);
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

  appendToBody(root);
  if (saved) {
    requestAnimationFrame(() => clampToolbarToViewport(root));
  }

  const onResize = () => clampToolbarToViewport(root);
  window.addEventListener("resize", onResize);

  attachToolbarDrag(root);
}
