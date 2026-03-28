import type { Rect } from "./selection-overlay";

const OVERLAY_ATTR = "data-research-canvas-overlay";

export interface ElementPickResult {
  rect: Rect;
  /** Best-effort permalink (e.g. `/p/…` post URL; not the profile on Instagram when a post exists). */
  linkUrl: string | null;
  /** Instagram profile URL when detected (separate from post). */
  profileUrl?: string | null;
}

function rectArea(r: DOMRect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function normalizePageUrl(href: string): string {
  try {
    const u = new URL(href, window.location.href);
    u.hash = "";
    return u.href;
  } catch {
    return href.split("#")[0];
  }
}

/** Instagram path segments that are not profile usernames. */
const IG_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "direct",
  "legal",
  "about",
  "support",
  "privacy",
  "tagged",
  "saved",
  "graphql",
  "developer",
]);

function collectLinkCandidates(hitElement: Element, scope: Element): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string | null | undefined) => {
    if (!raw || !raw.trim()) return;
    try {
      const u = new URL(raw, window.location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      const href = u.href.split("#")[0];
      if (seen.has(href)) return;
      seen.add(href);
      candidates.push(href);
    } catch {
      /* ignore */
    }
  };

  for (
    let n: Element | null = hitElement;
    n && n !== document.body;
    n = n.parentElement
  ) {
    if (n instanceof HTMLAnchorElement) add(n.href);
    add(n.getAttribute("data-href"));
    add(n.getAttribute("data-url"));
    add(n.getAttribute("data-expanded-url"));
  }

  scope.querySelectorAll("a[href]").forEach((node) => {
    if (node instanceof HTMLAnchorElement) add(node.href);
  });

  return candidates;
}

function isInstagramHost(href: string): boolean {
  try {
    return new URL(href).hostname.replace(/^www\./, "").endsWith("instagram.com");
  } catch {
    return false;
  }
}

/**
 * From collected links, pick Instagram post URL(s) and profile URL.
 * Prefer `/p/`, `/reel/`, `/tv/` for posts — not `/username/` as the post.
 */
function parseInstagramLinks(candidates: string[]): {
  postUrl: string | null;
  profileUrl: string | null;
} {
  let postUrl: string | null = null;
  let profileUrl: string | null = null;

  for (const raw of candidates) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (!u.hostname.replace(/^www\./, "").endsWith("instagram.com")) continue;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    if (parts[0] === "p" && parts[1]) {
      postUrl = `https://www.instagram.com/p/${parts[1]}/`;
      continue;
    }
    if (parts[0] === "reel" && parts[1]) {
      postUrl = `https://www.instagram.com/reel/${parts[1]}/`;
      continue;
    }
    if (parts[0] === "tv" && parts[1]) {
      postUrl = `https://www.instagram.com/tv/${parts[1]}/`;
      continue;
    }

    const head = parts[0];
    if (head && !IG_RESERVED.has(head)) {
      const prof = `https://www.instagram.com/${head}/`;
      if (!profileUrl) profileUrl = prof;
    }
  }

  return { postUrl, profileUrl };
}

/**
 * Non-Instagram: first link that differs from the current page, else first candidate.
 */
function findBestLinkUrlGeneric(
  candidates: string[],
  loc: string,
): string | null {
  for (const c of candidates) {
    if (normalizePageUrl(c) !== loc) return c;
  }
  return candidates[0] ?? null;
}

function isTwitterHost(href: string): boolean {
  try {
    const h = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
    return (
      h === "x.com" ||
      h === "twitter.com" ||
      h === "mobile.twitter.com"
    );
  } catch {
    return false;
  }
}

const TWITTER_RESERVED = new Set([
  "home",
  "explore",
  "notifications",
  "messages",
  "settings",
  "compose",
  "intent",
  "search",
  "hashtag",
  "i",
  "login",
  "signup",
]);

/**
 * Prefer /status/… tweet permalinks; optional profile path /handle (no status).
 */
function parseTwitterLinks(candidates: string[]): {
  statusUrl: string | null;
  profileUrl: string | null;
} {
  let statusUrl: string | null = null;
  let profileUrl: string | null = null;

  for (const raw of candidates) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    if (h !== "x.com" && h !== "twitter.com" && h !== "mobile.twitter.com") {
      continue;
    }
    const origin = "https://x.com";
    const parts = u.pathname.split("/").filter(Boolean);
    const statusIdx = parts.indexOf("status");
    if (statusIdx >= 0 && parts[statusIdx + 1]) {
      const path = parts.slice(0, statusIdx + 2).join("/");
      statusUrl = `${origin}/${path}`;
      continue;
    }
    if (parts.length === 1 && !TWITTER_RESERVED.has(parts[0].toLowerCase())) {
      profileUrl = `${origin}/${parts[0]}`;
    }
  }

  return { statusUrl, profileUrl };
}

function findRegionLinks(
  hitElement: Element,
  scope: Element,
): { linkUrl: string | null; profileUrl: string | null } {
  const loc = normalizePageUrl(window.location.href);
  const candidates = collectLinkCandidates(hitElement, scope);

  const onInstagram =
    isInstagramHost(loc) ||
    candidates.some((c) => {
      try {
        return isInstagramHost(c);
      } catch {
        return false;
      }
    });

  if (onInstagram) {
    const { postUrl, profileUrl } = parseInstagramLinks(candidates);
    return {
      linkUrl: postUrl,
      profileUrl,
    };
  }

  const onTwitter =
    isTwitterHost(loc) ||
    candidates.some((c) => {
      try {
        return isTwitterHost(c);
      } catch {
        return false;
      }
    });

  if (onTwitter) {
    const { statusUrl, profileUrl } = parseTwitterLinks(candidates);
    return {
      linkUrl: statusUrl,
      profileUrl,
    };
  }

  return {
    linkUrl: findBestLinkUrlGeneric(candidates, loc),
    profileUrl: null,
  };
}

/** Minimum bounding-box area (px²) for a highlighted region. */
const MIN_HIGHLIGHT_AREA = 32 * 32;

/**
 * Tightest usable box around the hit: among ancestors with area ≥ min floor,
 * pick the smallest (innermost) region — avoids snapping to `main` / full-page shells.
 */
function pickElementForHighlight(hit: Element | null): Element {
  if (!hit || hit === document.documentElement) {
    return document.body;
  }

  const chain: Element[] = [];
  for (
    let n: Element | null = hit;
    n && n !== document.documentElement;
    n = n.parentElement
  ) {
    chain.push(n);
  }

  const usable = chain.filter(
    (el) => rectArea(el.getBoundingClientRect()) >= MIN_HIGHLIGHT_AREA,
  );
  if (usable.length === 0) {
    const last = chain[chain.length - 1];
    return last && last !== document.body ? last : document.body;
  }

  let minA = Infinity;
  for (const el of usable) {
    const a = rectArea(el.getBoundingClientRect());
    if (a < minA) minA = a;
  }
  const smallest = usable.filter(
    (el) => rectArea(el.getBoundingClientRect()) === minA,
  );
  return smallest[0] ?? document.body;
}

function rectFromElement(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

/**
 * Full-screen overlay blocks clicks (`pointer-events: auto`). While it is visible,
 * `elementFromPoint` only sees the overlay — briefly hide it to sample the page.
 */
function elementUnderCursorWhilePicker(
  overlay: HTMLElement,
  clientX: number,
  clientY: number,
): Element | null {
  const prevVis = overlay.style.visibility;
  overlay.style.visibility = "hidden";
  const hit = document.elementFromPoint(clientX, clientY);
  overlay.style.visibility = prevVis;
  return hit;
}

/** Stack from topmost paint order to root; overlay hidden while sampling. */
function elementsStackUnderCursor(
  overlay: HTMLElement,
  clientX: number,
  clientY: number,
): Element[] {
  const prevVis = overlay.style.visibility;
  overlay.style.visibility = "hidden";
  const nodes = document.elementsFromPoint(clientX, clientY);
  overlay.style.visibility = prevVis;

  const out: Element[] = [];
  const seen = new Set<Element>();
  for (const n of nodes) {
    if (!(n instanceof Element)) continue;
    if (n.closest(`[${OVERLAY_ATTR}]`)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Full-screen overlay captures all pointer events so clicks never activate links
 * under the page. Hover uses a synchronous visibility toggle to read `elementFromPoint`.
 */
export function chooseElementRect(): Promise<ElementPickResult> {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.setAttribute(OVERLAY_ATTR, "");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483647";
    overlay.style.pointerEvents = "auto";
    overlay.style.cursor = "crosshair";
    overlay.style.background = "transparent";

    const highlight = document.createElement("div");
    highlight.style.position = "fixed";
    highlight.style.border = "2px solid #4f46e5";
    highlight.style.background = "rgba(79,70,229,0.08)";
    highlight.style.pointerEvents = "none";
    highlight.style.boxSizing = "border-box";
    highlight.style.zIndex = "2147483647";
    highlight.style.display = "none";

    const hint = document.createElement("div");
    hint.textContent =
      "[ ] or ↑ ↓ switch layer · Esc cancel";
    hint.style.position = "fixed";
    hint.style.left = "50%";
    hint.style.bottom = "16px";
    hint.style.transform = "translateX(-50%)";
    hint.style.padding = "8px 12px";
    hint.style.borderRadius = "8px";
    hint.style.fontSize = "12px";
    hint.style.fontFamily = "system-ui, sans-serif";
    hint.style.color = "#fff";
    hint.style.background = "rgba(0,0,0,0.65)";
    hint.style.pointerEvents = "none";
    hint.style.zIndex = "2147483647";
    hint.style.whiteSpace = "nowrap";

    let currentTarget: Element = document.body;
    let lastHit: Element = document.body;
    let settled = false;

    let stackIndex = 0;
    let lastTopElement: Element | null = null;
    let lastPointerX = window.innerWidth / 2;
    let lastPointerY = window.innerHeight / 2;

    const blockInteraction = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const clean = () => {
      if (settled) return;
      settled = true;
      overlay.remove();
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("mousedown", blockInteraction, true);
      window.removeEventListener("mouseup", blockInteraction, true);
      window.removeEventListener("click", blockInteraction, true);
      window.removeEventListener("auxclick", blockInteraction, true);
      window.removeEventListener("dblclick", blockInteraction, true);
      window.removeEventListener("touchstart", blockInteraction, true);
      window.removeEventListener("touchend", blockInteraction, true);
      window.removeEventListener("touchmove", blockInteraction, true);
      window.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };

    const applyHighlight = (hit: Element | null, target: Element) => {
      currentTarget = target;
      if (hit) lastHit = hit;
      const r = rectFromElement(target);
      if (r.width < 2 || r.height < 2) {
        highlight.style.display = "none";
        return;
      }
      highlight.style.display = "block";
      highlight.style.left = `${r.x}px`;
      highlight.style.top = `${r.y}px`;
      highlight.style.width = `${r.width}px`;
      highlight.style.height = `${r.height}px`;
    };

    const syncHighlightAt = (clientX: number, clientY: number) => {
      lastPointerX = clientX;
      lastPointerY = clientY;

      const stack = elementsStackUnderCursor(overlay, clientX, clientY);
      if (stack.length > 0) {
        if (stack[0] !== lastTopElement) {
          stackIndex = 0;
          lastTopElement = stack[0];
        }
        stackIndex = Math.min(stackIndex, stack.length - 1);
        const hit = stack[stackIndex]!;
        const target = pickElementForHighlight(hit);
        applyHighlight(hit, target);
        return;
      }

      lastTopElement = null;
      stackIndex = 0;
      const raw = elementUnderCursorWhilePicker(overlay, clientX, clientY);
      if (!raw || raw === document.documentElement) {
        applyHighlight(document.body, document.body);
        return;
      }
      const hit = raw.closest(`[${OVERLAY_ATTR}]`) ? null : raw;
      if (!hit) return;
      const target = pickElementForHighlight(hit);
      applyHighlight(hit, target);
    };

    const nudgeStackLayer = (delta: 1 | -1) => {
      const stack = elementsStackUnderCursor(
        overlay,
        lastPointerX,
        lastPointerY,
      );
      if (stack.length === 0) return;
      if (stack[0] !== lastTopElement) {
        stackIndex = 0;
        lastTopElement = stack[0];
      }
      stackIndex = Math.min(
        Math.max(stackIndex + delta, 0),
        stack.length - 1,
      );
      const hit = stack[stackIndex]!;
      applyHighlight(hit, pickElementForHighlight(hit));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clean();
        reject(new Error("Selection cancelled."));
        return;
      }
      if (event.key === "]" || event.key === "ArrowDown") {
        nudgeStackLayer(1);
        event.preventDefault();
        return;
      }
      if (event.key === "[" || event.key === "ArrowUp") {
        nudgeStackLayer(-1);
        event.preventDefault();
      }
    };

    const onMove = (event: MouseEvent) => {
      syncHighlightAt(event.clientX, event.clientY);
    };

    const finishPick = () => {
      if (settled) return;
      const r = rectFromElement(currentTarget);
      const { linkUrl, profileUrl } = findRegionLinks(lastHit, currentTarget);
      clean();
      if (r.width < 4 || r.height < 4) {
        reject(new Error("Selected region is too small."));
        return;
      }
      resolve({
        rect: r,
        linkUrl,
        ...(profileUrl ? { profileUrl } : {}),
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      blockInteraction(event);
      finishPick();
    };

    overlay.append(highlight);
    overlay.append(hint);
    document.body.append(overlay);

    syncHighlightAt(lastPointerX, lastPointerY);

    window.addEventListener("pointerdown", onPointerDown, {
      capture: true,
      passive: false,
    });
    window.addEventListener("mousedown", blockInteraction, true);
    window.addEventListener("mouseup", blockInteraction, true);
    window.addEventListener("click", blockInteraction, true);
    window.addEventListener("auxclick", blockInteraction, true);
    window.addEventListener("dblclick", blockInteraction, true);
    window.addEventListener("touchstart", blockInteraction, {
      capture: true,
      passive: false,
    });
    window.addEventListener("touchend", blockInteraction, {
      capture: true,
      passive: false,
    });
    window.addEventListener("touchmove", blockInteraction, {
      capture: true,
      passive: false,
    });
    window.addEventListener("mousemove", onMove, true);
    document.addEventListener("keydown", onKeyDown, true);
  });
}
