/** Symmetric padding inside the user’s selection for region image + video capture. */
// Note: `src/content/content-script.ts` must NOT import this file — Vite would chunk it and
// Chrome content scripts cannot load ES module `import` on host pages. Duplicate constants/logic
// there if you change inset behavior for recording.
export const CAPTURE_RECT_INSET_PX = 6;

/** Extra symmetric shrink after snapping for tab video mapping (reduces edge bleed vs outline). */
export const CAPTURE_RECORDING_BLEED_GUARD_PX = 1;

export type RectLike = { x: number; y: number; width: number; height: number };

/** Inset on all sides; returns null if the selection is too small. */
export function insetRect(rect: RectLike, insetPx: number): RectLike | null {
  if (insetPx <= 0) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  const w = rect.width - 2 * insetPx;
  const h = rect.height - 2 * insetPx;
  if (w < 1 || h < 1) return null;
  return {
    x: rect.x + insetPx,
    y: rect.y + insetPx,
    width: w,
    height: h,
  };
}

/** Symmetric shrink (e.g. 1px guard after integer snap). */
export function shrinkRectSymmetric(rect: RectLike, g: number): RectLike | null {
  if (g <= 0) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  const w = rect.width - 2 * g;
  const h = rect.height - 2 * g;
  if (w < 1 || h < 1) return null;
  return {
    x: rect.x + g,
    y: rect.y + g,
    width: w,
    height: h,
  };
}
