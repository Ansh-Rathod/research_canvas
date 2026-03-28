import {
  CONTEXT_MENU_IDS,
  isSelectedTextCaptureAction,
  textPresentationFromCaptureAction,
  type ArtifactRecord,
  type CaptureAction,
  type PendingCaptureRequest,
  type QuoteColorToken,
  type RuntimeMessage,
} from "@shared/messages";
import { CAPTURE_RECT_INSET_PX, insetRect } from "@shared/captureRect";
import {
  addArtifact,
  createCanvas,
  deleteArtifact,
  deleteCanvas,
  ensureDefaultCanvas,
  listCanvases,
} from "@storage/repositories";

const SHOW_FLOATING_TOOLBAR_MENU_ID = "research-canvas/show-floating-toolbar";

function createRequest(
  tabId: number,
  action: CaptureAction,
  sourceUrl: string,
  mediaType?: "image" | "video",
  mediaUrl?: string,
): PendingCaptureRequest {
  return {
    id: `${action}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tabId,
    action,
    sourceUrl,
    mediaType,
    mediaUrl,
  };
}

/** tldraw default palette tokens suitable for quote fills (excludes black/white). */
const QUOTE_COLOR_POOL: QuoteColorToken[] = [
  "light-violet",
  "violet",
  "blue",
  "light-blue",
  "yellow",
  "orange",
  "green",
  "light-green",
  "light-red",
  "red",
  "grey",
];

function pickRandomQuoteColor(): QuoteColorToken {
  return QUOTE_COLOR_POOL[Math.floor(Math.random() * QUOTE_COLOR_POOL.length)]!;
}

async function setupContextMenus() {
  chrome.contextMenus.removeAll();
  const titles: Record<
    | "capture-selected-text-heading"
    | "capture-selected-text-body"
    | "capture-selected-text-note"
    | "capture-selected-text-quote",
    string
  > = {
    "capture-selected-text-heading": "Add selection as heading",
    "capture-selected-text-body": "Add selection as text",
    "capture-selected-text-note": "Add selection as note",
    "capture-selected-text-quote": "Add selection as quote",
  };
  (
    [
      "capture-selected-text-heading",
      "capture-selected-text-body",
      "capture-selected-text-note",
      "capture-selected-text-quote",
    ] as const
  ).forEach((action) => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS[action],
      title: titles[action],
      contexts: ["selection"],
    });
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS["capture-url-card"],
    title: "Save URL as card",
    contexts: ["link", "page"],
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS["capture-media-element"],
    title: "Add image/video",
    contexts: ["image", "video"],
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS["capture-area-image"],
    title: "Capture selected area",
    contexts: ["page", "image", "video"],
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS["capture-element-region"],
    title: "Capture region (hover & click)",
    contexts: ["page", "image", "video"],
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS["record-area-video"],
    title: "Record selected area",
    contexts: ["page", "video"],
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS["record-element-region"],
    title: "Record region (hover & click)",
    contexts: ["page", "video"],
  });
  chrome.contextMenus.create({
    id: SHOW_FLOATING_TOOLBAR_MENU_ID,
    title: "Show Research Canvas floating toolbar",
    contexts: ["page"],
  });
}

async function initializeExtension() {
  await setupContextMenus();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeExtension();
});
chrome.runtime.onStartup.addListener(() => {
  void initializeExtension();
});
void initializeExtension();

async function ensureContentScript(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" } as any);
    return;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["assets/content.js"],
    });
  }
}

function isWebPageUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function notifyTabMessage(
  tabId: number,
  text: string,
  position: "center" | "corner" = "corner",
) {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [text, position],
    func: (message, pos) => {
      const id = "research-canvas-keyboard-hint";
      document.getElementById(id)?.remove();
      const el = document.createElement("div");
      el.id = id;
      el.textContent = message;
      const base: Record<string, string> = {
        position: "fixed",
        zIndex: "2147483647",
        background: "rgba(17,24,39,0.96)",
        color: "#fff",
        padding: "10px 12px",
        borderRadius: "10px",
        fontSize: "13px",
        fontFamily: "system-ui, sans-serif",
        boxShadow: "0 6px 18px rgba(0,0,0,0.28)",
        maxWidth: "min(420px, calc(100vw - 32px))",
      };
      if (pos === "center") {
        Object.assign(base, {
          top: "16px",
          left: "50%",
          transform: "translateX(-50%)",
        });
      } else {
        Object.assign(base, {
          top: "16px",
          right: "16px",
        });
      }
      Object.assign(el.style, base);
      document.body.append(el);
      setTimeout(() => el.remove(), 4500);
    },
  });
}

/**
 * `chrome.sidePanel.open()` must run in the same synchronous turn as a user gesture.
 * Any `await` before it (e.g. capture) invalidates the gesture — so we call this from
 * context menu handlers *before* starting async capture work.
 */
function primeSidePanelFromUserGesture(tabId: number) {
  try {
    void chrome.sidePanel.setOptions({
      tabId,
      path: "src/sidepanel/index.html",
      enabled: true,
    });
    void chrome.sidePanel.open({ tabId }).catch(() => {});
  } catch {
    /* ignore */
  }
}

async function finalizeCaptureOutcome(
  tab: chrome.tabs.Tab,
  artifact: Omit<ArtifactRecord, "id" | "canvasId" | "createdAt">,
) {
  if (!tab.id) return;
  const targetCanvasId = await resolveTargetCanvasId();
  const saved = await addArtifact(targetCanvasId, artifact);
  await chrome.runtime.sendMessage({
    type: "OPEN_CANVAS",
    canvasId: targetCanvasId,
    artifactId: saved.id,
  } as RuntimeMessage);
}

async function runCaptureFlow(
  tab: chrome.tabs.Tab,
  action: CaptureAction,
  options?: {
    mediaType?: "image" | "video";
    mediaUrl?: string;
  },
) {
  if (!tab.id || !tab.url) return;
  if (!isWebPageUrl(tab.url)) {
    await notifyTabMessage(
      tab.id,
      "Research Canvas: use this shortcut on a normal web page (http/https).",
    );
    return;
  }

  const request = createRequest(
    tab.id,
    action,
    tab.url,
    options?.mediaType,
    options?.mediaUrl,
  );
  try {
    const artifact = await captureArtifactForRequest(request);
    await finalizeCaptureOutcome(tab, artifact);
  } catch (error) {
    console.error("Capture action failed:", error);
    const msg = error instanceof Error ? error.message : String(error);
    await notifyTabMessage(tab.id, `Research Canvas: ${msg}`, "center");
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === SHOW_FLOATING_TOOLBAR_MENU_ID) {
    void chrome.storage.local.set({ floatingToolbarHidden: false });
    return;
  }
  if (!tab?.id || !tab.url) return;
  const action = (Object.entries(CONTEXT_MENU_IDS).find(
    ([, id]) => id === info.menuItemId,
  )?.[0] ?? null) as CaptureAction | null;
  if (!action) return;

  primeSidePanelFromUserGesture(tab.id);

  const mediaType =
    info.mediaType === "image" || info.mediaType === "video"
      ? info.mediaType
      : undefined;
  const mediaUrl = info.srcUrl || info.linkUrl;
  void runCaptureFlow(tab, action, {
    mediaType,
    mediaUrl,
  });
});

const COMMAND_TO_ACTION: Record<string, CaptureAction> = {
  "capture-area-image": "capture-area-image",
  "capture-element-region": "capture-element-region",
  "record-area-video": "record-area-video",
  "record-element-region": "record-element-region",
  "capture-url-card": "capture-url-card",
};

chrome.commands.onCommand.addListener((command) => {
  const action = COMMAND_TO_ACTION[command];
  if (!action) return;
  void chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        return;
      }
      await runCaptureFlow(tab, action);
    });
});

async function captureVisibleTab(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  // `captureVisibleTab` snapshots the *selected* tab in the window, not `tabId`.
  // Ensure the page we are capturing is active (e.g. after side panel focus, or multi-tab races).
  await chrome.tabs.update(tabId, { active: true });
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
}

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    void (async () => {
      if (message.type === "TOGGLE_CHROME_SIDE_PANEL") {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: "No tab." });
          return;
        }
        const { sidePanelHeartbeatAt } = await chrome.storage.local.get(
          "sidePanelHeartbeatAt",
        );
        const hb = Number(sidePanelHeartbeatAt ?? 0);
        const panelSeemsLive =
          hb > 0 && Date.now() - hb < 12000;
        if (panelSeemsLive) {
          try {
            await chrome.runtime.sendMessage({
              type: "CLOSE_SIDE_PANEL",
            } as RuntimeMessage);
          } catch {
            /* side panel not listening */
          }
          await chrome.storage.local.remove("sidePanelHeartbeatAt");
        } else {
          try {
            await chrome.sidePanel.setOptions({
              tabId,
              path: "src/sidepanel/index.html",
              enabled: true,
            });
            await chrome.sidePanel.open({ tabId });
          } catch (err) {
            console.warn("Research Canvas: sidePanel.open failed", err);
          }
        }
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "REQUEST_CAPTURE_VISIBLE_TAB" && sender.tab?.id) {
        const dataUrl = await captureVisibleTab(sender.tab.id);
        sendResponse({ ok: true, dataUrl });
        return;
      }

      if (message.type === "FINALIZE_PAGE_RECORDING") {
        const tab = sender.tab;
        if (!tab?.id || !tab.url) {
          sendResponse({ ok: false, error: "No tab for capture." });
          return;
        }
        if (!isWebPageUrl(tab.url)) {
          sendResponse({ ok: false, error: "Not a normal web page." });
          return;
        }
        const { action, dataUrl, width, height, linkUrl, profileUrl } = message;
        const tabUrlVideo = tab.url;
        const resolvedVideoLink =
          action === "record-element-region" &&
          typeof linkUrl === "string" &&
          /^https?:\/\//.test(linkUrl)
            ? linkUrl
            : null;
        const profileUrlVideo =
          action === "record-element-region" &&
          typeof profileUrl === "string" &&
          /^https?:\/\//.test(profileUrl)
            ? profileUrl
            : null;
        const primaryVideoUrl = resolvedVideoLink ?? tabUrlVideo;
        const artifact: Omit<ArtifactRecord, "id" | "canvasId" | "createdAt"> = {
          type: "video",
          title:
            action === "record-element-region"
              ? "Region recording"
              : "Area recording",
          sourceUrl: primaryVideoUrl,
          ...(resolvedVideoLink && resolvedVideoLink !== tabUrlVideo
            ? { capturedFromUrl: tabUrlVideo }
            : {}),
          ...(profileUrlVideo ? { profileUrl: profileUrlVideo } : {}),
          dataUrl,
          width,
          height,
        };
        try {
          await finalizeCaptureOutcome(tab, artifact);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      if (message.type === "TRIGGER_CAPTURE") {
        const tab = sender.tab;
        if (!tab?.id || !tab.url) {
          sendResponse({ ok: false, error: "No tab for capture." });
          return;
        }
        primeSidePanelFromUserGesture(tab.id);
        try {
          await runCaptureFlow(tab, message.action);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      if (message.type === "CREATE_CANVAS") {
        const canvas = await createCanvas(
          message.name.trim() || "Untitled Canvas",
        );
        sendResponse({ ok: true, canvas });
        return;
      }

      if (message.type === "DELETE_ARTIFACT") {
        const { canvasId, artifactId } = message as {
          type: "DELETE_ARTIFACT";
          canvasId: string;
          artifactId: string;
        };
        await deleteArtifact(canvasId, artifactId);
        const tomb = (
          await chrome.storage.local.get("deletedArtifactIdsByCanvas")
        ).deletedArtifactIdsByCanvas as Record<string, string[]> | undefined;
        if (tomb?.[canvasId]?.length) {
          const nextList = tomb[canvasId].filter((id) => id !== artifactId);
          const all = { ...tomb, [canvasId]: nextList };
          await chrome.storage.local.set({ deletedArtifactIdsByCanvas: all });
        }
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "DELETE_CANVAS") {
        await deleteCanvas(message.canvasId);
        const canvases = await listCanvases();
        if (canvases.length === 0) await ensureDefaultCanvas();
        sendResponse({ ok: true, canvases: await listCanvases() });
        return;
      }

      if ((message as any).type === "LIST_CANVASES") {
        const canvases = await listCanvases();
        if (canvases.length === 0) await ensureDefaultCanvas();
        sendResponse({ ok: true, canvases: await listCanvases() });
        return;
      }

      if ((message as any).type === "LIST_ARTIFACTS") {
        const mod = await import("@storage/repositories");
        const artifacts = await mod.listArtifacts((message as any).canvasId);
        const withData = await Promise.all(
          artifacts.map(async (row) => {
            if (row.dataUrl) return row;
            if (row.blobId) {
              const dataUrl = await mod.readBlobAsDataUrl(row.blobId);
              return { ...row, dataUrl: dataUrl ?? undefined };
            }
            return row;
          }),
        );
        sendResponse({ ok: true, artifacts: withData });
        return;
      }
    })().catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return true;
  },
);

async function cropDataUrl(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  devicePixelRatio: number,
) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(
    rect.width * devicePixelRatio,
    rect.height * devicePixelRatio,
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable.");
  ctx.drawImage(
    bitmap,
    rect.x * devicePixelRatio,
    rect.y * devicePixelRatio,
    rect.width * devicePixelRatio,
    rect.height * devicePixelRatio,
    0,
    0,
    rect.width * devicePixelRatio,
    rect.height * devicePixelRatio,
  );
  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await outBlob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1)
    binary += String.fromCharCode(bytes[i]);
  return `data:image/png;base64,${btoa(binary)}`;
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Failed to fetch media (${response.status}).`);
  }
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1)
    binary += String.fromCharCode(bytes[i]);
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

/** Uniform scale so very large captures stay manageable on the canvas (aspect ratio preserved). */
const MAX_MEDIA_EDGE = 1600;

function fitWithinMaxEdge(
  w: number,
  h: number,
  maxEdge: number,
): { width: number; height: number } {
  const maxDim = Math.max(w, h);
  if (maxDim <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / maxDim;
  return {
    width: Math.round(w * scale),
    height: Math.round(h * scale),
  };
}

async function getImageDimensionsFromDataUrl(
  dataUrl: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const w = bitmap.width;
    const h = bitmap.height;
    bitmap.close();
    if (w <= 0 || h <= 0) return null;
    return fitWithinMaxEdge(w, h, MAX_MEDIA_EDGE);
  } catch {
    return null;
  }
}

async function getMediaElementDimensionsFromTab(
  tabId: number,
  mediaUrl: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (mediaUrlArg: string) => {
        function norm(u: string): string {
          try {
            return new URL(u, window.location.href).href;
          } catch {
            return "";
          }
        }
        const target = norm(mediaUrlArg);
        if (!target) return null;
        const nodes = document.querySelectorAll("video, img");
        for (const el of nodes) {
          const candidates: string[] = [];
          if (el instanceof HTMLVideoElement) {
            candidates.push(
              el.currentSrc,
              el.src,
              el.getAttribute("src") || "",
            );
          } else if (el instanceof HTMLImageElement) {
            candidates.push(
              el.currentSrc,
              el.src,
              el.getAttribute("src") || "",
            );
          }
          const matches = candidates.some((u) => u && norm(u) === target);
          if (!matches) continue;
          if (el instanceof HTMLImageElement) {
            const w = el.naturalWidth;
            const h = el.naturalHeight;
            if (w > 0 && h > 0) return { width: w, height: h };
          }
          if (el instanceof HTMLVideoElement) {
            if (el.videoWidth > 0 && el.videoHeight > 0) {
              return { width: el.videoWidth, height: el.videoHeight };
            }
            await new Promise<void>((resolve) => {
              const done = () => resolve();
              el.addEventListener("loadedmetadata", done, { once: true });
              window.setTimeout(done, 2500);
            });
            const w = el.videoWidth;
            const h = el.videoHeight;
            if (w > 0 && h > 0) return { width: w, height: h };
          }
        }
        return null;
      },
      args: [mediaUrl],
    });
    const raw = injection?.result as
      | { width: number; height: number }
      | null
      | undefined;
    if (!raw || raw.width <= 0 || raw.height <= 0) return null;
    return fitWithinMaxEdge(raw.width, raw.height, MAX_MEDIA_EDGE);
  } catch {
    return null;
  }
}

async function captureArtifactForRequest(
  request: PendingCaptureRequest,
): Promise<Omit<ArtifactRecord, "id" | "canvasId" | "createdAt">> {
  if (request.action === "capture-media-element") {
    if (!request.mediaType || !request.mediaUrl) {
      throw new Error("No image/video URL found from context click.");
    }
    if (request.mediaType === "image") {
      const dataUrl = await fetchAsDataUrl(request.mediaUrl);
      const dims = await getImageDimensionsFromDataUrl(dataUrl);
      return {
        type: "image",
        title: "Image from page",
        sourceUrl: request.mediaUrl,
        dataUrl,
        ...(dims ? { width: dims.width, height: dims.height } : {}),
      };
    }
    const videoDims = await getMediaElementDimensionsFromTab(
      request.tabId,
      request.mediaUrl,
    );
    return {
      type: "video",
      title: "Video from page",
      sourceUrl: request.mediaUrl,
      ...(videoDims
        ? { width: videoDims.width, height: videoDims.height }
        : {}),
    };
  }
  if (request.action === "capture-url-card") {
    const url = request.mediaUrl || request.sourceUrl;
    const card = await fetchUrlCard(url);
    return {
      type: "link",
      title: card.title,
      description: card.description,
      sourceUrl: url,
      dataUrl: card.imageDataUrl,
    };
  }

  await ensureContentScript(request.tabId);
  const captureMessage: RuntimeMessage = isSelectedTextCaptureAction(
    request.action,
  )
    ? { type: "REQUEST_SELECTED_TEXT" }
    : request.action === "capture-area-image"
      ? { type: "REQUEST_AREA_RECT" }
      : request.action === "capture-element-region"
        ? { type: "REQUEST_ELEMENT_PICK" }
        : request.action === "record-element-region"
          ? {
              type: "REQUEST_ELEMENT_RECORDING",
              streamId: await getTabStreamId(request.tabId),
            }
          : {
              type: "REQUEST_AREA_RECORDING",
              streamId: await getTabStreamId(request.tabId),
            };
  const response = (await chrome.tabs.sendMessage(
    request.tabId,
    captureMessage,
  )) as any;
  if (!response?.ok) {
    throw new Error(response?.error ?? "Capture failed.");
  }

  if (isSelectedTextCaptureAction(request.action)) {
    const textPresentation = textPresentationFromCaptureAction(request.action)!;
    const base: Omit<ArtifactRecord, "id" | "canvasId" | "createdAt"> = {
      type: "text",
      title: "Selected text",
      sourceUrl: request.sourceUrl,
      text: response.text,
      textPresentation,
    };
    if (textPresentation === "quote") {
      return { ...base, quoteColor: pickRandomQuoteColor() };
    }
    return base;
  }

  if (
    request.action === "capture-area-image" ||
    request.action === "capture-element-region"
  ) {
    // Allow the page to repaint after selection overlay is removed.
    await delay(120);
    const fullDataUrl = await captureVisibleTab(request.tabId);
    const imageCropRect =
      insetRect(response.rect, CAPTURE_RECT_INSET_PX) ?? response.rect;
    const cropped = await cropDataUrl(
      fullDataUrl,
      imageCropRect,
      response.devicePixelRatio ?? 1,
    );
    const resolvedLink =
      request.action === "capture-element-region" &&
      typeof response.linkUrl === "string" &&
      /^https?:\/\//.test(response.linkUrl)
        ? response.linkUrl
        : null;
    const profileUrl =
      request.action === "capture-element-region" &&
      typeof response.profileUrl === "string" &&
      /^https?:\/\//.test(response.profileUrl)
        ? response.profileUrl
        : null;
    const tabUrl = request.sourceUrl;
    const primaryUrl = resolvedLink ?? tabUrl;
    return {
      type: "image",
      title:
        request.action === "capture-element-region"
          ? "Region capture"
          : "Area capture",
      sourceUrl: primaryUrl,
      ...(resolvedLink && resolvedLink !== tabUrl
        ? { capturedFromUrl: tabUrl }
        : {}),
      ...(profileUrl ? { profileUrl } : {}),
      dataUrl: cropped,
      width: imageCropRect.width,
      height: imageCropRect.height,
    };
  }

  const resolvedVideoLink =
    request.action === "record-element-region" &&
    typeof response.linkUrl === "string" &&
    /^https?:\/\//.test(response.linkUrl)
      ? response.linkUrl
      : null;
  const profileUrlVideo =
    request.action === "record-element-region" &&
    typeof response.profileUrl === "string" &&
    /^https?:\/\//.test(response.profileUrl)
      ? response.profileUrl
      : null;
  const tabUrlVideo = request.sourceUrl;
  const primaryVideoUrl = resolvedVideoLink ?? tabUrlVideo;

  return {
    type: "video",
    title:
      request.action === "record-element-region"
        ? "Region recording"
        : "Area recording",
    sourceUrl: primaryVideoUrl,
    ...(resolvedVideoLink && resolvedVideoLink !== tabUrlVideo
      ? { capturedFromUrl: tabUrlVideo }
      : {}),
    ...(profileUrlVideo ? { profileUrl: profileUrlVideo } : {}),
    dataUrl: response.dataUrl,
    width: response.width,
    height: response.height,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveTargetCanvasId(): Promise<string> {
  const { lastActiveCanvasId } = await chrome.storage.local.get(
    "lastActiveCanvasId",
  );
  const canvases = await listCanvases();
  if (canvases.length === 0) {
    const created = await ensureDefaultCanvas();
    return created.id;
  }
  if (
    typeof lastActiveCanvasId === "string" &&
    canvases.some((c) => c.id === lastActiveCanvasId)
  ) {
    return lastActiveCanvasId;
  }
  return canvases[0]!.id;
}

async function getTabStreamId(tabId: number): Promise<string> {
  // If `targetTabId` is set, Chrome only allows tabs where `activeTab` was granted by a
  // browser UI gesture — not clicks on injected page UI. Omit `targetTabId` and instead
  // activate the tab so the default target is correct.
  await chrome.tabs.update(tabId, { active: true });
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ consumerTabId: tabId }, (streamId) => {
      const err = chrome.runtime.lastError;
      if (err || !streamId) {
        reject(new Error(err?.message ?? "Could not get tab stream ID."));
        return;
      }
      resolve(streamId);
    });
  });
}

async function fetchUrlCard(
  url: string,
): Promise<{ title: string; description: string; imageDataUrl?: string }> {
  try {
    const response = await fetch(url, { credentials: "include" });
    const html = await response.text();
    const title =
      pickMeta(html, "property", "og:title") ||
      pickMeta(html, "name", "twitter:title") ||
      pickTitle(html) ||
      url;
    const description =
      pickMeta(html, "property", "og:description") ||
      pickMeta(html, "name", "description") ||
      pickMeta(html, "name", "twitter:description") ||
      "";
    const imageUrl =
      pickMeta(html, "property", "og:image") ||
      pickMeta(html, "name", "twitter:image");
    const imageDataUrl = imageUrl
      ? await safeFetchAsDataUrl(new URL(imageUrl, url).toString())
      : undefined;
    return { title, description, imageDataUrl };
  } catch {
    try {
      const parsed = new URL(url);
      return {
        title: parsed.hostname.replace(/^www\./, ""),
        description:
          parsed.pathname && parsed.pathname !== "/"
            ? parsed.pathname
            : "Saved link card",
      };
    } catch {
      return { title: url, description: "Saved link card" };
    }
  }
}

function pickMeta(
  html: string,
  attr: "property" | "name",
  value: string,
): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]*${attr}=["']${escapeRegExp(value)}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*${attr}=["']${escapeRegExp(value)}["'][^>]*>`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1].trim());
  }
  return null;
}

function pickTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1].trim()) : null;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function safeFetchAsDataUrl(url: string): Promise<string | undefined> {
  try {
    return await fetchAsDataUrl(url);
  } catch {
    return undefined;
  }
}
