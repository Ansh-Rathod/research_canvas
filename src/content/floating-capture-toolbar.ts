/**
 * Floating capture bar — keep action strings as literals (no @shared runtime import)
 * so the content bundle stays a single script for MV3.
 */

const TOOLBAR_ID = "research-canvas-float-toolbar-root";
const TOOLBAR_POS_KEY = "research-canvas-float-toolbar-pos";
const TOOLTIP_EL_ID = "research-canvas-toolbar-tooltip";
export const FLOATING_TOOLBAR_HIDDEN_KEY = "floatingToolbarHidden";

/** Content inset; icon hit targets are fixed size below. */
const TOOLBAR_INNER_PADDING = "4px";
const TOOLBAR_ICON_BTN_SIZE = "40px";
const TOOLBAR_ICON_HOVER_BG = "#e5e7eb";
/** Rendered pixel size for toolbar SVGs (viewBox stays 24×24 / 26×26). */
const TOOLBAR_SVG_SIZE_FILLED = "24";
const TOOLBAR_SVG_SIZE_STROKE = "24";

function styleFloatingToolbarIconButton(btn: HTMLButtonElement): void {
  Object.assign(btn.style, {
    display: "grid",
    placeItems: "center",
    width: TOOLBAR_ICON_BTN_SIZE,
    height: TOOLBAR_ICON_BTN_SIZE,
    padding: "0",
    border: "none",
    borderRadius: "8px",
    background: "transparent",
    color: "#111827",
    cursor: "pointer",
  });
  btn.onmouseenter = () => {
    btn.style.background = TOOLBAR_ICON_HOVER_BG;
  };
  btn.onmouseleave = () => {
    btn.style.background = "transparent";
  };
}

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

/** Pause (two bars) — filled, 24×24 viewBox. */
const ICON_RECORD_PAUSE = "M6 5h4v14H6V5zm8 0h4v14h-4V5z";
/** Play triangle — filled. */
const ICON_RECORD_PLAY = "M8 5v14l11-7z";
/** Checkmark — finish / save recording. */
const ICON_RECORD_DONE =
  "M9 16.17L4.83 12l-1.42 1.41L9 19L21 7l-1.41-1.41L9 16.17z";
/** Trash — clear recording buffer. */
const ICON_CLEAR_RECORDING =
  "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z";
/** Retake — pick region again. */
const ICON_RETAKE =
  "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z";

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
  svg.setAttribute("width", TOOLBAR_SVG_SIZE_FILLED);
  svg.setAttribute("height", TOOLBAR_SVG_SIZE_FILLED);
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
  svg.setAttribute("width", TOOLBAR_SVG_SIZE_STROKE);
  svg.setAttribute("height", TOOLBAR_SVG_SIZE_STROKE);
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
    alignSelf: "flex-start",
    flexShrink: "0",
    boxSizing: "border-box",
    maxHeight: "min(100vh - 24px, 560px)",
    overflowY: "auto",
    padding: "0",
    paddingBottom: "6px",
    borderRadius: "8px",
    background: "#ffffff",
    boxShadow:
      "0 4px 6px -1px rgba(0,0,0,0.08), 0 10px 24px -4px rgba(0,0,0,0.1)",
    border: "1px solid #e5e7eb",
    pointerEvents: "auto",
    fontFamily: "system-ui, -apple-system, sans-serif",
  });
  /** Beat host `width: … !important` rules that would stretch the bar edge-to-edge. */
  root.style.setProperty("width", "fit-content", "important");
  root.style.setProperty("max-width", "calc(100vw - 24px)", "important");

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
    padding: "10px 8px 10px",
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
    width: "16px",
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
    padding: TOOLBAR_INNER_PADDING,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
  });
  root.append(inner);

  const utilityRow = document.createElement("div");
  utilityRow.setAttribute("data-research-canvas-toolbar-utility-row", "");
  Object.assign(utilityRow.style, {
    display: "flex",
    flexDirection: "column",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: "4px",
    width: "100%",
    paddingBottom: "4px",
    marginBottom: "0",
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
    styleFloatingToolbarIconButton(btn);
    btn.append(icon);
    disableSvgPointerEvents(btn);
    bindHoverTooltip(btn, tooltip);
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
  bar.setAttribute("data-research-canvas-toolbar-capture-buttons", "");
  bar.style.display = "flex";
  bar.style.flexDirection = "column";
  bar.style.flexWrap = "nowrap";
  bar.style.gap = "4px";
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
      styleFloatingToolbarIconButton(btn);
      btn.append(svgIcon(def.path));
      disableSvgPointerEvents(btn);
      bindHoverTooltip(btn, def.title);
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

const RECORDING_STRIP_ATTR = "data-research-canvas-toolbar-recording-strip";
const FALLBACK_PANEL_ID = "research-canvas-recording-fallback-panel";

function preventFocusScrollOnClick(button: HTMLButtonElement): void {
  button.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
  });
}

function styleToolbarActionButton(
  btn: HTMLButtonElement,
  variant: "default" | "primary",
): void {
  Object.assign(btn.style, {
    display: "grid",
    placeItems: "center",
    width: TOOLBAR_ICON_BTN_SIZE,
    height: TOOLBAR_ICON_BTN_SIZE,
    padding: "0",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
  });
  if (variant === "primary") {
    btn.style.background = "#4f46e5";
    btn.style.color = "#fff";
    btn.style.boxShadow = "0 1px 3px rgba(79, 70, 229, 0.35)";
    btn.onmouseenter = () => {
      btn.style.background = "#4338ca";
    };
    btn.onmouseleave = () => {
      btn.style.background = "#4f46e5";
    };
  } else {
    btn.style.background = "transparent";
    btn.style.color = "#111827";
    btn.onmouseenter = () => {
      btn.style.background = TOOLBAR_ICON_HOVER_BG;
    };
    btn.onmouseleave = () => {
      btn.style.background = "transparent";
    };
  }
}

function setPauseButtonIcon(
  btn: HTMLButtonElement,
  showPlayIcon: boolean,
): void {
  btn.replaceChildren(
    showPlayIcon ? svgIcon(ICON_RECORD_PLAY) : svgIcon(ICON_RECORD_PAUSE),
  );
  disableSvgPointerEvents(btn);
}

function stopRecorderAndWait(recorder: MediaRecorder): Promise<void> {
  return new Promise((resolve) => {
    if (recorder.state === "inactive") {
      resolve();
      return;
    }
    const onStop = () => {
      recorder.removeEventListener("stop", onStop);
      resolve();
    };
    recorder.addEventListener("stop", onStop);
    recorder.stop();
  });
}

export type ToolbarRecordingResult = "done" | "cancelled" | "retake";

/**
 * Recording controls in the floating toolbar (below capture buttons), or a bottom bar if the toolbar is hidden.
 * Icon buttons match toolbar items; styled tooltips; auto-start recording.
 */
export function showToolbarRecordingControls(options: {
  createRecorder: () => MediaRecorder;
  clearChunks: () => void;
  removeOutline: () => void;
}): Promise<ToolbarRecordingResult> {
  const { createRecorder, clearChunks, removeOutline } = options;
  return new Promise((resolve) => {
    let recorder = createRecorder();

    const statusDot = document.createElement("span");
    Object.assign(statusDot.style, {
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      background: "#dc2626",
      flexShrink: "0",
    });

    const timer = document.createElement("span");
    timer.textContent = "00:00";
    Object.assign(timer.style, {
      minWidth: "38px",
      textAlign: "center",
      fontSize: "12px",
      fontVariantNumeric: "tabular-nums",
      fontWeight: "600",
      color: "#111827",
    });

    const metaRow = document.createElement("div");
    Object.assign(metaRow.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "10px",
      width: "100%",
      paddingTop: "10px",
    });
    metaRow.append(statusDot, timer);

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.setAttribute("aria-label", "Clear recording");
    styleToolbarActionButton(clearBtn, "default");
    clearBtn.append(svgIcon(ICON_CLEAR_RECORDING));
    disableSvgPointerEvents(clearBtn);
    bindHoverTooltip(
      clearBtn,
      "Clear recording — pauses, discards video captured so far, resets timer",
    );
    preventFocusScrollOnClick(clearBtn);

    const retakeBtn = document.createElement("button");
    retakeBtn.type = "button";
    retakeBtn.setAttribute("aria-label", "Retake");
    styleToolbarActionButton(retakeBtn, "default");
    retakeBtn.append(svgIcon(ICON_RETAKE));
    disableSvgPointerEvents(retakeBtn);
    bindHoverTooltip(
      retakeBtn,
      "Retake — stop and pick capture region again (new screen share may be required)",
    );
    preventFocusScrollOnClick(retakeBtn);

    const pauseBtn = document.createElement("button");
    pauseBtn.type = "button";
    pauseBtn.setAttribute("aria-label", "Pause or resume recording");
    styleToolbarActionButton(pauseBtn, "default");
    setPauseButtonIcon(pauseBtn, false);
    bindHoverTooltip(pauseBtn, "Pause or resume recording");
    preventFocusScrollOnClick(pauseBtn);

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.setAttribute("aria-label", "Finish and save recording");
    styleToolbarActionButton(doneBtn, "primary");
    doneBtn.append(svgIcon(ICON_RECORD_DONE));
    disableSvgPointerEvents(doneBtn);
    bindHoverTooltip(doneBtn, "Finish and save recording to Research Canvas");
    preventFocusScrollOnClick(doneBtn);

    bindHoverTooltip(timer, "Elapsed recording time");
    bindHoverTooltip(
      statusDot,
      "Recording in progress (red = active, amber = paused)",
    );

    const root = document.getElementById(TOOLBAR_ID);
    const captureBar = root?.querySelector<HTMLElement>(
      "[data-research-canvas-toolbar-capture-buttons]",
    );

    let removeUi: () => void;

    /** Single column: same order as the rest of the floating toolbar (vertical stack). */
    const controlsColumn = document.createElement("div");
    Object.assign(controlsColumn.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "4px",
      width: "100%",
    });
    controlsColumn.append(clearBtn, retakeBtn, pauseBtn, doneBtn);

    if (root && captureBar) {
      const strip = document.createElement("div");
      strip.setAttribute(RECORDING_STRIP_ATTR, "");
      Object.assign(strip.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
        width: "100%",
        paddingTop: "4px",
        marginTop: "2px",
        borderTop: "1px solid #fecaca",
        background: "#ffffff",
      });
      strip.append(metaRow, controlsColumn);
      captureBar.insertAdjacentElement("afterend", strip);
      requestAnimationFrame(() => {
        root.scrollTop = root.scrollHeight;
      });
      const prevOp = captureBar.style.opacity;
      const prevPe = captureBar.style.pointerEvents;
      captureBar.style.opacity = "0.45";
      captureBar.style.pointerEvents = "none";
      removeUi = () => {
        strip.remove();
        captureBar.style.opacity = prevOp;
        captureBar.style.pointerEvents = prevPe;
      };
    } else {
      timer.style.color = "#e5e7eb";
      statusDot.style.boxShadow = "0 0 0 1px rgba(255,255,255,0.35)";
      const panel = document.createElement("div");
      panel.id = FALLBACK_PANEL_ID;
      Object.assign(panel.style, {
        position: "fixed",
        bottom: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: "2147483647",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
        padding: "10px 12px",
        borderRadius: "12px",
        background: "rgba(17,24,39,0.95)",
        color: "#fff",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "13px",
        boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
      });
      const fallbackMeta = document.createElement("div");
      Object.assign(fallbackMeta.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
      });
      fallbackMeta.append(statusDot, timer);
      panel.append(fallbackMeta, controlsColumn);
      appendToBody(panel);
      removeUi = () => panel.remove();
    }

    const savedScroll = { x: window.scrollX, y: window.scrollY };
    const restoreScroll = () => {
      window.scrollTo({
        left: savedScroll.x,
        top: savedScroll.y,
        behavior: "instant",
      });
    };
    queueMicrotask(restoreScroll);
    requestAnimationFrame(restoreScroll);
    requestAnimationFrame(() => requestAnimationFrame(restoreScroll));

    let startedAt = 0;
    let pausedMs = 0;
    let pausedAt = 0;
    let timerId = 0;

    const cleanup = () => {
      removeOutline();
      removeUi();
      window.clearInterval(timerId);
    };

    const updateTimer = () => {
      if (!startedAt) return;
      const now = Date.now();
      const elapsed =
        now - startedAt - pausedMs - (pausedAt ? now - pausedAt : 0);
      const sec = Math.max(0, Math.floor(elapsed / 1000));
      const mm = String(Math.floor(sec / 60)).padStart(2, "0");
      const ss = String(sec % 60).padStart(2, "0");
      timer.textContent = `${mm}:${ss}`;
    };

    const resetTimerStateAfterClear = () => {
      startedAt = Date.now();
      pausedMs = 0;
      pausedAt = 0;
      timer.textContent = "00:00";
      statusDot.style.background = "#dc2626";
      setPauseButtonIcon(pauseBtn, false);
    };

    try {
      recorder.start();
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Could not start recording.",
      );
      cleanup();
      resolve("cancelled");
      return;
    }

    startedAt = Date.now();
    timerId = window.setInterval(updateTimer, 250);

    clearBtn.onclick = () => {
      void (async () => {
        if (recorder.state === "recording") {
          recorder.pause();
          pausedAt = Date.now();
          statusDot.style.background = "#d97706";
          setPauseButtonIcon(pauseBtn, true);
        }
        clearChunks();
        await stopRecorderAndWait(recorder);
        try {
          recorder = createRecorder();
          recorder.start();
        } catch (e) {
          window.alert(
            e instanceof Error ? e.message : "Could not restart recording.",
          );
          cleanup();
          resolve("cancelled");
          return;
        }
        resetTimerStateAfterClear();
      })();
    };

    retakeBtn.onclick = () => {
      void (async () => {
        await stopRecorderAndWait(recorder);
        cleanup();
        resolve("retake");
      })();
    };

    pauseBtn.onclick = () => {
      if (recorder.state === "recording") {
        recorder.pause();
        pausedAt = Date.now();
        statusDot.style.background = "#d97706";
        setPauseButtonIcon(pauseBtn, true);
        return;
      }
      if (recorder.state === "paused") {
        recorder.resume();
        if (pausedAt) {
          pausedMs += Date.now() - pausedAt;
          pausedAt = 0;
        }
        statusDot.style.background = "#dc2626";
        setPauseButtonIcon(pauseBtn, false);
      }
    };

    doneBtn.onclick = () => {
      if (recorder.state === "inactive") {
        cleanup();
        resolve("cancelled");
        return;
      }
      recorder.onstop = () => {
        cleanup();
        resolve("done");
      };
      recorder.stop();
    };
  });
}
