import { MAIN_DOCUMENT_ID } from "@shared/document";

export interface CanvasMeta {
  id: string;
  name: string;
  isHidden?: boolean;
  isPrivate?: boolean;
  createdAt: number;
  updatedAt: number;
}

const CANVASES_KEY = "researchCanvasCanvases";
const LAST_OPEN_CANVAS_ID_KEY = "researchCanvasLastOpenCanvasId";

function now() {
  return Date.now();
}

function createDefaultCanvas(): CanvasMeta {
  const timestamp = now();
  return {
    id: MAIN_DOCUMENT_ID,
    name: "Canvas 1",
    createdAt: timestamp,
    updatedAt: timestamp,
    isHidden: false,
    isPrivate: false,
  };
}

export async function loadCanvases(): Promise<CanvasMeta[]> {
  const raw = await chrome.storage.local.get(CANVASES_KEY);
  const list = (raw[CANVASES_KEY] as CanvasMeta[] | undefined) ?? [];
  if (!list.length) {
    const def = createDefaultCanvas();
    await saveCanvases([def]);
    return [def];
  }
  return list;
}

export async function saveCanvases(canvases: CanvasMeta[]): Promise<void> {
  await chrome.storage.local.set({ [CANVASES_KEY]: canvases });
}

export async function getLastOpenCanvasId(): Promise<string | null> {
  const raw = await chrome.storage.local.get(LAST_OPEN_CANVAS_ID_KEY);
  const id = raw[LAST_OPEN_CANVAS_ID_KEY];
  return typeof id === "string" && id.length ? id : null;
}

export async function setLastOpenCanvasId(id: string): Promise<void> {
  await chrome.storage.local.set({ [LAST_OPEN_CANVAS_ID_KEY]: id });
}

export function makeCanvasId(): string {
  return `canvas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nextCanvasName(existing: CanvasMeta[], baseName = "Canvas") {
  const taken = new Set(existing.map((c) => c.name));
  if (!taken.has(`${baseName} 1`)) return `${baseName} 1`;
  let i = 2;
  // Find the first `${baseName} N` not already used.
  // Reasonable upper bound to avoid infinite loops in pathological cases.
  while (i < 10000) {
    const candidate = `${baseName} ${i}`;
    if (!taken.has(candidate)) return candidate;
    i += 1;
  }
  // Fallback: base name with timestamp.
  return `${baseName} ${new Date().toISOString()}`;
}

export function withUpdatedTimestamp(canvas: CanvasMeta): CanvasMeta {
  return { ...canvas, updatedAt: now() };
}

