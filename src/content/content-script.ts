import type { RuntimeMessage } from "@shared/messages";
import {
  FLOATING_TOOLBAR_HIDDEN_KEY,
  mountFloatingCaptureToolbar,
  showToolbarRecordingControls,
  unmountFloatingCaptureToolbar,
} from "./floating-capture-toolbar";
import { chooseElementRect } from "./element-picker-overlay";
import type { Rect } from "./selection-overlay";
import { chooseAreaRect } from "./selection-overlay";

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  void (async () => {
    if ((message as any).type === "PING") {
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "REQUEST_SELECTED_TEXT") {
      const text = window.getSelection()?.toString().trim() ?? "";
      if (!text) {
        sendResponse({ ok: false, error: "No text selected." });
        return;
      }
      sendResponse({ ok: true, text });
      return;
    }

    if (message.type === "REQUEST_AREA_RECT") {
      const rect = await chooseAreaRect();
      sendResponse({ ok: true, rect, devicePixelRatio: window.devicePixelRatio || 1 });
      return;
    }

    if (message.type === "REQUEST_ELEMENT_PICK") {
      const { rect, linkUrl, profileUrl } = await chooseElementRect();
      sendResponse({
        ok: true,
        rect,
        devicePixelRatio: window.devicePixelRatio || 1,
        ...(linkUrl ? { linkUrl } : {}),
        ...(profileUrl ? { profileUrl } : {}),
      });
      return;
    }

    if (message.type === "REQUEST_AREA_RECORDING") {
      const result = await recordCroppedTabSnippet(message.streamId, async () => ({
        rect: await chooseAreaRect(),
      }));
      sendResponse({ ok: true, ...result });
      return;
    }

    if (message.type === "REQUEST_ELEMENT_RECORDING") {
      const result = await recordCroppedTabSnippet(message.streamId, async () => {
        const r = await chooseElementRect();
        return {
          rect: r.rect,
          linkUrl: r.linkUrl,
          profileUrl: r.profileUrl,
        };
      });
      sendResponse({ ok: true, ...result });
      return;
    }

  })().catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

void (async () => {
  try {
    const url = new URL(window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      mountFloatingCaptureToolbar();
      return;
    }
    const hostname = url.hostname;
    const stored = await chrome.storage.local.get([
      FLOATING_TOOLBAR_HIDDEN_KEY,
      "floatingToolbarVisibilityByDomain",
    ]);
    const byDomain = (stored.floatingToolbarVisibilityByDomain ??
      {}) as Record<string, boolean>;
    // One-time migration: if map is empty but old global hidden flag is set, treat current domain as hidden.
    if (
      Object.keys(byDomain).length === 0 &&
      stored[STRING(FLOATING_TOOLBAR_HIDDEN_KEY)] === true
    ) {
      byDomain[hostname] = true;
      await chrome.storage.local.set({ floatingToolbarVisibilityByDomain: byDomain });
    }
    const hiddenForDomain = byDomain[hostname] === true;
    if (!hiddenForDomain) {
      mountFloatingCaptureToolbar();
    }
  } catch {
    mountFloatingCaptureToolbar();
  }
})();


type RectPickResult = {
  rect: Rect;
  linkUrl?: string | null;
  profileUrl?: string | null;
};

/**
 * Duplicated from `@shared/captureRect` intentionally: Vite would emit a shared chunk for that
 * import, and MV3 content scripts are injected as classic scripts — `import` fails on pages.
 */
const CAPTURE_RECT_INSET_PX = 6;
const CAPTURE_RECORDING_BLEED_GUARD_PX = 1;
const RECORDING_OUTLINE_GAP_PX = 2;

type RectLike = { x: number; y: number; width: number; height: number };

function insetRectForCapture(rect: RectLike, insetPx: number): RectLike | null {
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

function shrinkRectSymmetricForCapture(
  rect: RectLike,
  g: number,
): RectLike | null {
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

const RECORDING_OUTLINE_BORDER_PX = 3;

/**
 * Integer pixel rect used for crop + outline. Matches how `mapRectToVideoSource` floors
 * source coords — avoids fractional viewport coords where outline bars could overlap the
 * sampled column/row (e.g. green flash on the left edge).
 */
function snapRectForRecording(rect: Rect): Rect {
  const x = Math.ceil(rect.x);
  const y = Math.ceil(rect.y);
  const x2 = Math.floor(rect.x + rect.width);
  const y2 = Math.floor(rect.y + rect.height);
  return {
    x,
    y,
    width: Math.max(1, x2 - x),
    height: Math.max(1, y2 - y),
  };
}

/** Green bars just *outside* the crop rect so they are not included in tab capture. */
function showRecordingRegionOutline(rect: Rect): () => void {
  let removed = false;
  const b = RECORDING_OUTLINE_BORDER_PX;
  const x = rect.x;
  const y = rect.y;
  const w = rect.width;
  const h = rect.height;
  const g = RECORDING_OUTLINE_GAP_PX;

  const styleBar = (el: HTMLDivElement) => {
    el.setAttribute("data-research-canvas-recording-outline", "");
    el.style.position = "fixed";
    el.style.background = "#22c55e";
    el.style.pointerEvents = "none";
    el.style.zIndex = "2147483646";
  };

  const top = document.createElement("div");
  styleBar(top);
  Object.assign(top.style, {
    left: `${x - b - g}px`,
    top: `${y - b - g}px`,
    width: `${w + 2 * (b + g)}px`,
    height: `${b}px`,
  });

  const bottom = document.createElement("div");
  styleBar(bottom);
  Object.assign(bottom.style, {
    left: `${x - b - g}px`,
    top: `${y + h + g}px`,
    width: `${w + 2 * (b + g)}px`,
    height: `${b}px`,
  });

  const left = document.createElement("div");
  styleBar(left);
  Object.assign(left.style, {
    left: `${x - b - g}px`,
    top: `${y - b - g}px`,
    width: `${b}px`,
    height: `${h + 2 * (b + g)}px`,
  });

  const right = document.createElement("div");
  styleBar(right);
  Object.assign(right.style, {
    left: `${x + w + g}px`,
    top: `${y - b - g}px`,
    width: `${b}px`,
    height: `${h + 2 * (b + g)}px`,
  });

  for (const el of [top, bottom, left, right]) {
    document.body.append(el);
  }

  return () => {
    if (removed) return;
    removed = true;
    top.remove();
    bottom.remove();
    left.remove();
    right.remove();
  };
}

async function runTabRecordingPipeline(
  stream: MediaStream,
  cropRect: Rect,
  linkUrl: string | null | undefined,
  profileUrl: string | null | undefined,
  removeOutline: () => void,
) {
  const [track] = stream.getVideoTracks();
  const video = document.createElement("video");
  video.srcObject = new MediaStream([track]);
  video.muted = true;
  await video.play();

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const sourceRect = mapRectToVideoSource(
    cropRect,
    viewportWidth,
    viewportHeight,
    video.videoWidth,
    video.videoHeight,
  );

  const outCanvas = document.createElement("canvas");
  outCanvas.width = sourceRect.width;
  outCanvas.height = sourceRect.height;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Canvas context missing.");

  const fps = 15;
  const drawInterval = window.setInterval(() => {
    outCtx.drawImage(
      video,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      0,
      0,
      sourceRect.width,
      sourceRect.height,
    );
  }, 1000 / fps);
  const croppedStream = outCanvas.captureStream(fps);
  const finalStream = new MediaStream();
  const [croppedVideoTrack] = croppedStream.getVideoTracks();
  if (croppedVideoTrack) finalStream.addTrack(croppedVideoTrack);
  stream.getAudioTracks().forEach((audioTrack) => finalStream.addTrack(audioTrack));

  const RECORDING_MIME = "video/webm;codecs=vp8,opus";
  const chunks: Blob[] = [];
  const createRecorder = () => {
    const r = new MediaRecorder(finalStream, { mimeType: RECORDING_MIME });
    r.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    return r;
  };

  const result = await showToolbarRecordingControls({
    createRecorder,
    clearChunks: () => {
      chunks.length = 0;
    },
    removeOutline,
  });

  window.clearInterval(drawInterval);
  track.stop();
  stream.getAudioTracks().forEach((audioTrack) => audioTrack.stop());
  croppedStream.getTracks().forEach((t) => t.stop());
  finalStream.getTracks().forEach((t) => t.stop());
  video.pause();
  video.srcObject = null;

  if (result === "cancelled") {
    throw new Error("Recording cancelled.");
  }
  if (result === "retake") {
    return { status: "retake" as const };
  }

  const blob = new Blob(chunks, { type: "video/webm" });
  if (blob.size === 0) {
    throw new Error("No video captured.");
  }
  return {
    status: "success" as const,
    dataUrl: await blobToDataUrl(blob),
    width: cropRect.width,
    height: cropRect.height,
    ...(linkUrl ? { linkUrl } : {}),
    ...(profileUrl ? { profileUrl } : {}),
  };
}

async function recordCroppedTabSnippet(
  streamId: string,
  pickRect: () => Promise<RectPickResult>,
) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { rect, linkUrl, profileUrl } = await pickRect();
    const paddedRect = insetRectForCapture(rect, CAPTURE_RECT_INSET_PX) ?? rect;
    let cropRect = snapRectForRecording(paddedRect);
    const bleedGuard = shrinkRectSymmetricForCapture(
      cropRect,
      CAPTURE_RECORDING_BLEED_GUARD_PX,
    );
    if (bleedGuard) cropRect = bleedGuard;
    const removeOutline = showRecordingRegionOutline(cropRect);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
          maxFrameRate: 30,
        },
      },
    } as MediaStreamConstraints);
    try {
      const pipelineResult = await runTabRecordingPipeline(
        stream,
        cropRect,
        linkUrl,
        profileUrl,
        removeOutline,
      );
      if (pipelineResult.status === "retake") {
        stream.getTracks().forEach((t) => t.stop());
        removeOutline();
        continue;
      }
      stream.getTracks().forEach((t) => t.stop());
      removeOutline();
      return {
        dataUrl: pipelineResult.dataUrl,
        width: pipelineResult.width,
        height: pipelineResult.height,
        ...(pipelineResult.linkUrl ? { linkUrl: pipelineResult.linkUrl } : {}),
        ...(pipelineResult.profileUrl
          ? { profileUrl: pipelineResult.profileUrl }
          : {}),
      };
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      removeOutline();
      throw e;
    }
  }
}

/**
 * Tab recording without `chrome.tabCapture.getMediaStreamId` (required for floating toolbar:
 * that API needs an activeTab grant; page clicks do not count). Call `getDisplayMedia` in the
 * same turn as the toolbar click, then run the same crop/record pipeline.
 */
async function recordCroppedTabSnippetWithDisplayMedia(
  initialStream: MediaStream,
  pickRect: () => Promise<RectPickResult>,
) {
  let stream = initialStream;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { rect, linkUrl, profileUrl } = await pickRect();
      const paddedRect = insetRectForCapture(rect, CAPTURE_RECT_INSET_PX) ?? rect;
      let cropRect = snapRectForRecording(paddedRect);
      const bleedGuard = shrinkRectSymmetricForCapture(
        cropRect,
        CAPTURE_RECORDING_BLEED_GUARD_PX,
      );
      if (bleedGuard) cropRect = bleedGuard;
      const removeOutline = showRecordingRegionOutline(cropRect);
      try {
        const pipelineResult = await runTabRecordingPipeline(
          stream,
          cropRect,
          linkUrl,
          profileUrl,
          removeOutline,
        );
        if (pipelineResult.status === "retake") {
          stream.getTracks().forEach((t) => t.stop());
          removeOutline();
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
            preferCurrentTab: true,
          } as DisplayMediaStreamOptions & { preferCurrentTab?: boolean });
          continue;
        }
        removeOutline();
        return {
          dataUrl: pipelineResult.dataUrl,
          width: pipelineResult.width,
          height: pipelineResult.height,
          ...(pipelineResult.linkUrl ? { linkUrl: pipelineResult.linkUrl } : {}),
          ...(pipelineResult.profileUrl
            ? { profileUrl: pipelineResult.profileUrl }
            : {}),
        };
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop());
        removeOutline();
        throw e;
      }
    }
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

function beginToolbarRecordingFromClick(
  action: "record-area-video" | "record-element-region",
): void {
  const pickRect =
    action === "record-area-video"
      ? async () => ({ rect: await chooseAreaRect() })
      : async () => {
          const r = await chooseElementRect();
          return {
            rect: r.rect,
            linkUrl: r.linkUrl,
            profileUrl: r.profileUrl,
          };
        };

  void chrome.runtime.sendMessage({
    type: "ENSURE_SIDE_PANEL_OPEN",
  } satisfies RuntimeMessage);

  const p = navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
    preferCurrentTab: true,
  } as DisplayMediaStreamOptions & { preferCurrentTab?: boolean });

  void p
    .then((stream) => recordCroppedTabSnippetWithDisplayMedia(stream, pickRect))
    .then((payload) =>
      chrome.runtime.sendMessage({
        type: "FINALIZE_PAGE_RECORDING",
        action,
        dataUrl: payload.dataUrl,
        width: payload.width,
        height: payload.height,
        ...(payload.linkUrl ? { linkUrl: payload.linkUrl } : {}),
        ...(payload.profileUrl ? { profileUrl: payload.profileUrl } : {}),
      } satisfies RuntimeMessage),
    )
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        return;
      }
      console.error("Research Canvas toolbar recording failed:", err);
    });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read video blob."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function mapRectToVideoSource(
  rect: { x: number; y: number; width: number; height: number },
  viewportWidth: number,
  viewportHeight: number,
  sourceWidth: number,
  sourceHeight: number
) {
  const vw = Math.max(1, viewportWidth);
  const vh = Math.max(1, viewportHeight);
  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);

  const viewportRatio = vw / vh;
  const sourceRatio = sw / sh;

  let contentX = 0;
  let contentY = 0;
  let contentW = sw;
  let contentH = sh;

  if (sourceRatio > viewportRatio) {
    contentW = sh * viewportRatio;
    contentX = (sw - contentW) / 2;
  } else if (sourceRatio < viewportRatio) {
    contentH = sw / viewportRatio;
    contentY = (sh - contentH) / 2;
  }

  const x = contentX + (rect.x / vw) * contentW;
  const y = contentY + (rect.y / vh) * contentH;
  const width = (rect.width / vw) * contentW;
  const height = (rect.height / vh) * contentH;

  return {
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y)),
    width: Math.max(1, Math.min(sw, Math.floor(width))),
    height: Math.max(1, Math.min(sh, Math.floor(height))),
  };
}

function tryMountFloatingToolbar() {
  void chrome.storage.local.get(FLOATING_TOOLBAR_HIDDEN_KEY, (r) => {
    if (r[FLOATING_TOOLBAR_HIDDEN_KEY]) return;
    try {
      mountFloatingCaptureToolbar({
        onRecordingAction: beginToolbarRecordingFromClick,
      });
    } catch (e) {
      console.error("Research Canvas: failed to mount floating toolbar", e);
    }
  });
}

tryMountFloatingToolbar();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[FLOATING_TOOLBAR_HIDDEN_KEY]) return;
  const v = changes[FLOATING_TOOLBAR_HIDDEN_KEY].newValue as
    | boolean
    | undefined;
  if (v === true) {
    unmountFloatingCaptureToolbar();
  } else if (v === false) {
    tryMountFloatingToolbar();
  }
});
