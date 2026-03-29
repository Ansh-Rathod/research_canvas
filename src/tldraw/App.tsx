import {
  type ArtifactRecord,
  type RuntimeMessage,
} from "@shared/messages";
import { MAIN_DOCUMENT_ID } from "@shared/document";
import { mergeDeletedArtifactTombstones } from "@storage/tombstones";
import type { Editor } from "@tldraw/editor";
import {
  Box,
  DefaultImageToolbarContent,
  DefaultVideoToolbarContent,
  renderPlaintextFromRichText,
  Tldraw,
  TldrawUiButtonIcon,
  TldrawUiContextualToolbar,
  TldrawUiToolbarButton,
  toRichText,
  useEditor,
  useValue,
} from "@tldraw/tldraw";
import "@tldraw/tldraw/tldraw.css";
import type { TLRichText } from "@tldraw/tlschema";
import { useCallback, useEffect, useRef, useState } from "react";
import "./embed-interactive.css";
import { ResearchEmbedShapeUtil } from "./researchEmbedShapeUtil";
import {
  RESEARCH_QUOTE_INITIAL_H,
  RESEARCH_QUOTE_SHAPE_W,
  ResearchQuoteShapeUtil,
} from "./researchQuoteShapeUtil";
import { ResearchVideoShapeUtil } from "./researchVideoShapeUtil";
import { toRichTextBold, toRichTextQuote } from "./textArtifacts";
import {
  migrateLegacyYoutubeEmbedUrls,
  RESEARCH_EMBED_DEFINITIONS,
} from "./youtubeEmbeds";

const RESEARCH_SHAPE_UTILS = [
  ResearchVideoShapeUtil,
  ResearchEmbedShapeUtil,
  ResearchQuoteShapeUtil,
];

const ARTIFACT_GRID_STEP_X = 320;
const ARTIFACT_GRID_STEP_Y = 220;
const ARTIFACT_VIEWPORT_PAD = 48;

/**
 * Place new artifacts in the **visible** page rect: grid from the top-left of the viewport
 * so captures appear where you’re looking instead of toward the canvas origin or “below” center.
 */
function artifactPositionInViewport(editor: Editor, index: number) {
  const vp = editor.getViewportPageBounds();
  if (vp.width < 1 || vp.height < 1) {
    return {
      x: 80 + (index % 3) * ARTIFACT_GRID_STEP_X,
      y: 80 + Math.floor(index / 3) * ARTIFACT_GRID_STEP_Y,
    };
  }
  const col = index % 3;
  const row = Math.floor(index / 3);
  let x = vp.x + ARTIFACT_VIEWPORT_PAD + col * ARTIFACT_GRID_STEP_X;
  let y = vp.y + ARTIFACT_VIEWPORT_PAD + row * ARTIFACT_GRID_STEP_Y;
  // Keep staggered rows on-screen when many artifacts (stay inside bottom edge with slack).
  const maxY = vp.maxY - ARTIFACT_VIEWPORT_PAD - 80;
  if (y > maxY) {
    y = Math.max(vp.y + ARTIFACT_VIEWPORT_PAD, maxY);
  }
  return { x, y };
}

function toShapeId(id: string) {
  return `shape:${id}` as any;
}

function toAssetId(id: string) {
  return `asset:${id}` as any;
}

function CanvasScene({
  artifacts,
  onArtifactsChanged,
}: {
  artifacts: ArtifactRecord[];
  onArtifactsChanged?: () => void;
}) {
  const editor = useEditor();
  const renderedArtifactIdsRef = useRef<Set<string>>(new Set());
  /** Tombstones user-deleted artifact ids synchronously so LIST_ARTIFACTS refreshes cannot recreate shapes before React state catches up. */
  const pendingDeletedArtifactIdsRef = useRef<Set<string>>(new Set());
  const onArtifactsChangedRef = useRef(onArtifactsChanged);
  onArtifactsChangedRef.current = onArtifactsChanged;
  /** `null` until chrome.storage load finishes — avoids writing `[]` before read and wiping deletions. */
  const [deletedArtifactIds, setDeletedArtifactIds] = useState<string[] | null>(
    null,
  );

  const buildMergedDeletedSet = (stateList: string[] | null) => {
    const merged = new Set<string>(stateList ?? []);
    for (const id of pendingDeletedArtifactIdsRef.current) {
      merged.add(id);
    }
    return merged;
  };
  const pageShapeSig = useValue(
    "page-shapes-signature",
    () => Array.from(editor.getCurrentPageShapeIds()).join("|"),
    [editor],
  );

  useEffect(() => {
    setDeletedArtifactIds(null);
    let cancelled = false;
    void chrome.storage.local
      .get("deletedArtifactIdsByCanvas")
      .then((res) => {
        if (cancelled) return;
        const all = (res.deletedArtifactIdsByCanvas ?? {}) as Record<
          string,
          string[]
        >;
        setDeletedArtifactIds(all[MAIN_DOCUMENT_ID] ?? []);
      })
      .catch(() => {
        if (!cancelled) setDeletedArtifactIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (deletedArtifactIds === null) return;
    const unique = [...new Set(deletedArtifactIds)];
    void chrome.storage.local.get("deletedArtifactIdsByCanvas").then((res) => {
      const all = (res.deletedArtifactIdsByCanvas ?? {}) as Record<
        string,
        string[]
      >;
      all[MAIN_DOCUMENT_ID] = unique;
      void chrome.storage.local.set({ deletedArtifactIdsByCanvas: all });
    });
  }, [deletedArtifactIds]);

  useEffect(() => {
    if (!editor) return;
    editor.selectNone();
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    return editor.sideEffects.registerAfterDeleteHandler("shape", (shape) => {
      const sid = String(shape.id);
      if (!sid.startsWith("shape:artifact_")) return;
      const artifactId = sid.replace(/^shape:/, "");
      pendingDeletedArtifactIdsRef.current.add(artifactId);
      void (async () => {
        const msg = (await chrome.runtime.sendMessage({
          type: "DELETE_ARTIFACT",
          artifactId,
        } as RuntimeMessage)) as { ok?: boolean };
        if (!msg?.ok) {
          pendingDeletedArtifactIdsRef.current.delete(artifactId);
          return;
        }
        setDeletedArtifactIds((prev) => {
          const list = prev ?? [];
          return list.filter((id) => id !== artifactId);
        });
        onArtifactsChangedRef.current?.();
      })();
    });
  }, [editor]);

  /** Drop optimistic tombstones once the artifact row is gone from the latest list (successful delete or prune). */
  useEffect(() => {
    const ids = new Set(artifacts.map((a) => a.id));
    const pending = pendingDeletedArtifactIdsRef.current;
    for (const id of [...pending]) {
      if (!ids.has(id)) pending.delete(id);
    }
  }, [artifacts]);

  useEffect(() => {
    if (!editor || deletedArtifactIds === null) return;
    const deletedSet = buildMergedDeletedSet(deletedArtifactIds);
    const maybeMarkDeleted = (
      artifact: ArtifactRecord,
      primaryShapeId: string,
    ) => {
      if (!renderedArtifactIdsRef.current.has(artifact.id)) return;
      if (editor.getShape(primaryShapeId as any)) return;
      if (deletedSet.has(artifact.id)) return;
      pendingDeletedArtifactIdsRef.current.add(artifact.id);
      setDeletedArtifactIds((prev) => {
        const list = prev ?? [];
        return list.includes(artifact.id) ? list : [...list, artifact.id];
      });
    };
    for (const artifact of artifacts) {
      if (deletedSet.has(artifact.id)) continue;
      maybeMarkDeleted(artifact, String(toShapeId(artifact.id)));
    }
  }, [artifacts, deletedArtifactIds, editor, pageShapeSig]);

  useEffect(() => {
    if (!editor || deletedArtifactIds === null) return;
    const deletedSet = buildMergedDeletedSet(deletedArtifactIds);

    artifacts.forEach((artifact, index) => {
      if (deletedSet.has(artifact.id)) return;
      const position = artifactPositionInViewport(editor, index);
      if (artifact.type === "text") {
        /** Legacy text artifacts omit this; match previous plain-text appearance via body styling. */
        const presentation = artifact.textPresentation ?? "body";
        const primaryId = String(toShapeId(artifact.id));
        const existing = editor.getShape(primaryId as any);
        const meta = { sourceUrl: artifact.sourceUrl };
        const rt = artifact.text ?? "";

        if (presentation === "heading") {
          if (existing) {
            renderedArtifactIdsRef.current.add(artifact.id);
            return;
          }
          editor.createShape({
            id: toShapeId(artifact.id),
            type: "text",
            x: position.x,
            y: position.y,
            props: {
              richText: toRichTextBold(rt),
              size: "xl",
              color: "black",
              font: "sans",
              textAlign: "start",
              w: 8,
              autoSize: true,
              scale: 1,
            },
            meta,
          });
          renderedArtifactIdsRef.current.add(artifact.id);
          return;
        }

        if (presentation === "body") {
          if (existing) {
            renderedArtifactIdsRef.current.add(artifact.id);
            return;
          }
          editor.createShape({
            id: toShapeId(artifact.id),
            type: "text",
            x: position.x,
            y: position.y,
            props: {
              richText: toRichText(rt),
              size: "s",
              color: "grey",
              font: "sans",
              textAlign: "start",
              w: 8,
              autoSize: true,
              scale: 1,
            },
            meta,
          });
          renderedArtifactIdsRef.current.add(artifact.id);
          return;
        }

        if (presentation === "note") {
          if (existing) {
            renderedArtifactIdsRef.current.add(artifact.id);
            return;
          }
          editor.createShape({
            id: toShapeId(artifact.id),
            type: "note",
            x: position.x,
            y: position.y,
            props: {
              color: "yellow",
              labelColor: "black",
              size: "m",
              font: "draw",
              align: "middle",
              verticalAlign: "middle",
              growY: 0,
              fontSizeAdjustment: 0,
              url: "",
              scale: 1,
              richText: toRichText(rt),
            },
            meta,
          });
          renderedArtifactIdsRef.current.add(artifact.id);
          return;
        }

        if (presentation === "quote") {
          if (existing) {
            renderedArtifactIdsRef.current.add(artifact.id);
            return;
          }
          const fillColor = artifact.quoteColor ?? "light-violet";
          editor.createShape({
            id: toShapeId(artifact.id),
            type: "researchQuote",
            x: position.x,
            y: position.y,
            props: {
              w: RESEARCH_QUOTE_SHAPE_W,
              h: RESEARCH_QUOTE_INITIAL_H,
              color: fillColor,
              richText: toRichTextQuote(rt),
            },
            meta,
          });
          renderedArtifactIdsRef.current.add(artifact.id);
          return;
        }

        return;
      }
      if (artifact.type === "image" && artifact.dataUrl) {
        const primaryId = String(toShapeId(artifact.id));
        const existing = editor.getShape(primaryId as any);
        if (existing) {
          renderedArtifactIdsRef.current.add(artifact.id);
          return;
        }
        const assetId = toAssetId(`${artifact.id}_asset`);
        editor.createAssets([
          {
            id: assetId,
            type: "image",
            typeName: "asset",
            props: {
              src: artifact.dataUrl,
              w: artifact.width ?? 420,
              h: artifact.height ?? 260,
              name: artifact.title,
              isAnimated: false,
              mimeType: "image/png",
            },
            meta: {},
          },
        ]);
        editor.createShape({
          id: toShapeId(artifact.id),
          type: "image",
          x: position.x,
          y: position.y,
          props: {
            assetId,
            w: artifact.width ?? 420,
            h: artifact.height ?? 260,
          },
          meta: {
            sourceUrl: artifact.sourceUrl,
            ...(artifact.capturedFromUrl
              ? { capturedFromUrl: artifact.capturedFromUrl }
              : {}),
            ...(artifact.profileUrl
              ? { profileUrl: artifact.profileUrl }
              : {}),
          },
        });
        renderedArtifactIdsRef.current.add(artifact.id);
        return;
      }
      if (artifact.type === "video") {
        const primaryId = String(toShapeId(artifact.id));
        const existing = editor.getShape(primaryId as any);
        if (existing) {
          renderedArtifactIdsRef.current.add(artifact.id);
          return;
        }
        const assetId = toAssetId(`${artifact.id}_video_asset`);
        const src = artifact.dataUrl ?? artifact.sourceUrl;
        if (!src) return;
        editor.createAssets([
          {
            id: assetId,
            type: "video",
            typeName: "asset",
            props: {
              src,
              w: artifact.width ?? 420,
              h: artifact.height ?? 260,
              name: artifact.title,
              isAnimated: true,
              mimeType: "video/webm",
            },
            meta: {},
          },
        ]);
        editor.createShape({
          id: toShapeId(artifact.id),
          type: "video",
          x: position.x,
          y: position.y,
          props: {
            w: artifact.width ?? 420,
            h: artifact.height ?? 260,
            assetId,
            time: 0,
            playing: false,
            autoplay: false,
            url: "",
            altText: `${artifact.title} (saved locally)`,
          },
          meta: {
            sourceUrl: artifact.sourceUrl,
            ...(artifact.capturedFromUrl
              ? { capturedFromUrl: artifact.capturedFromUrl }
              : {}),
            ...(artifact.profileUrl ? { profileUrl: artifact.profileUrl } : {}),
          },
        });
        renderedArtifactIdsRef.current.add(artifact.id);
        return;
      }
      if (artifact.type === "link") {
        const cardShapeId = String(toShapeId(artifact.id));
        const existing = editor.getShape(cardShapeId as any);
        const youtubeEmbedUrl = toYouTubeEmbedUrl(artifact.sourceUrl);
        if (youtubeEmbedUrl) {
          if (existing) {
            editor.updateShape({
              id: existing.id as any,
              type: "embed",
              props: {
                ...(existing.props as any),
                url: youtubeEmbedUrl,
                w: Math.max(420, Number((existing.props as any)?.w ?? 560)),
                h: Math.max(260, Number((existing.props as any)?.h ?? 315)),
              },
              meta: {
                ...(existing.meta as any),
                sourceUrl: artifact.sourceUrl,
              },
            });
            renderedArtifactIdsRef.current.add(artifact.id);
            return;
          }
          editor.createShape({
            id: toShapeId(artifact.id),
            type: "embed",
            x: position.x,
            y: position.y,
            props: { url: youtubeEmbedUrl, w: 560, h: 315 },
            meta: { sourceUrl: artifact.sourceUrl },
          });
          renderedArtifactIdsRef.current.add(artifact.id);
          return;
        }

        const bookmarkAssetId = toAssetId(`${artifact.id}_bookmark_asset`);
        if (existing) {
          editor.createAssets([
            {
              id: bookmarkAssetId,
              type: "bookmark",
              typeName: "asset",
              props: {
                src: artifact.sourceUrl,
                title: artifact.title || safeDomain(artifact.sourceUrl),
                description: artifact.description || "",
                image: artifact.dataUrl || "",
                favicon: "",
              },
              meta: {},
            },
          ]);
          editor.updateShape({
            id: existing.id as any,
            type: "bookmark",
            props: {
              ...(existing.props as any),
              url: artifact.sourceUrl,
              assetId: bookmarkAssetId,
              w: Math.max(320, Number((existing.props as any)?.w ?? 460)),
              h: Math.max(180, Number((existing.props as any)?.h ?? 280)),
            },
            meta: { ...(existing.meta as any), sourceUrl: artifact.sourceUrl },
          });
          renderedArtifactIdsRef.current.add(artifact.id);
          return;
        }
        editor.createAssets([
          {
            id: bookmarkAssetId,
            type: "bookmark",
            typeName: "asset",
            props: {
              src: artifact.sourceUrl,
              title: artifact.title || safeDomain(artifact.sourceUrl),
              description: artifact.description || "",
              image: artifact.dataUrl || "",
              favicon: "",
            },
            meta: {},
          },
        ]);
        editor.createShape({
          id: toShapeId(artifact.id),
          type: "bookmark",
          x: position.x,
          y: position.y,
          props: {
            url: artifact.sourceUrl,
            assetId: bookmarkAssetId,
            w: 460,
            h: 280,
          },
          meta: { sourceUrl: artifact.sourceUrl },
        });
        renderedArtifactIdsRef.current.add(artifact.id);
        return;
      }
      const primaryId = String(toShapeId(artifact.id));
      const existing = editor.getShape(primaryId as any);
      if (existing) {
        renderedArtifactIdsRef.current.add(artifact.id);
        return;
      }
      editor.createShape({
        id: toShapeId(artifact.id),
        type: "text",
        x: position.x,
        y: position.y,
        props: {
          richText: toRichText(
            `[Video] ${artifact.title}\n${artifact.sourceUrl}`,
          ),
        },
        meta: { sourceUrl: artifact.sourceUrl },
      });
      renderedArtifactIdsRef.current.add(artifact.id);
    });
  }, [artifacts, deletedArtifactIds, editor]);
  return null;
}

function safeDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return rawUrl;
  }
}

function toYouTubeEmbedUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let videoId = "";
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v") ?? "";
      } else if (url.pathname.startsWith("/shorts/")) {
        videoId = url.pathname.split("/")[2] ?? "";
      } else if (url.pathname.startsWith("/embed/")) {
        videoId = url.pathname.split("/")[2] ?? "";
      }
    } else if (host === "youtu.be") {
      videoId = url.pathname.replace("/", "");
    }
    if (!videoId) return null;
    return `https://www.youtube-nocookie.com/embed/${videoId}`;
  } catch {
    return null;
  }
}

function ToolbarUrlButton() {
  const editor = useEditor();
  const selectedIds = editor.getSelectedShapeIds();
  if (selectedIds.length !== 1) return null;
  const shape = editor.getShape(selectedIds[0]);
  const meta = (shape?.meta as {
    sourceUrl?: string;
    capturedFromUrl?: string;
    profileUrl?: string;
  }) ?? {};
  const sourceUrl = String(meta.sourceUrl ?? "");
  const capturedFromUrl = String(meta.capturedFromUrl ?? "");
  const profileUrl = String(meta.profileUrl ?? "");
  if (!sourceUrl) return null;
  const primaryTitle = [
    `Post or link: ${sourceUrl}`,
    profileUrl ? `Profile: ${profileUrl}` : "",
    capturedFromUrl ? `Captured while on: ${capturedFromUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return (
    <>
      <TldrawUiToolbarButton
        type="icon"
        onClick={() => window.open(sourceUrl, "_blank", "noopener,noreferrer")}
        title={primaryTitle || sourceUrl}
        aria-label="Open post or primary link"
      >
        <TldrawUiButtonIcon icon="external-link" small />
      </TldrawUiToolbarButton>
      {profileUrl ? (
        <TldrawUiToolbarButton
          type="icon"
          onClick={() =>
            window.open(profileUrl, "_blank", "noopener,noreferrer")
          }
          title={`Open profile: ${profileUrl}`}
          aria-label="Open profile"
        >
          <TldrawUiButtonIcon icon="user" small />
        </TldrawUiToolbarButton>
      ) : null}
      {capturedFromUrl ? (
        <TldrawUiToolbarButton
          type="icon"
          onClick={() =>
            window.open(capturedFromUrl, "_blank", "noopener,noreferrer")
          }
          title={`Open page where captured: ${capturedFromUrl}`}
          aria-label="Open page where captured"
        >
          <TldrawUiButtonIcon icon="home" small />
        </TldrawUiToolbarButton>
      ) : null}
    </>
  );
}

function ImageToolbarWithUrl() {
  const editor = useEditor();
  const imageShapeId = useValue(
    "imageShape",
    () => {
      const onlySelectedShape = editor.getOnlySelectedShape();
      if (!onlySelectedShape || onlySelectedShape.type !== "image") return null;
      return onlySelectedShape.id;
    },
    [editor],
  );
  const showToolbar = useValue(
    "showToolbar",
    () => editor.isInAny("select.idle", "select.pointing_shape", "select.crop"),
    [editor],
  );
  const isLocked = useValue(
    "locked",
    () => (imageShapeId ? editor.getShape(imageShapeId)?.isLocked : false),
    [editor, imageShapeId],
  );
  const isInCropTool = useValue(
    "editorPath",
    () => editor.isIn("select.crop."),
    [editor],
  );
  const getSelectionBounds = useCallback(() => {
    const fullBounds = editor.getSelectionScreenBounds();
    if (!fullBounds) return undefined;
    return new Box(fullBounds.x, fullBounds.y, fullBounds.width, 0);
  }, [editor]);
  if (!imageShapeId || !showToolbar || isLocked) return null;

  return (
    <TldrawUiContextualToolbar
      className="tlui-image__toolbar"
      getSelectionBounds={getSelectionBounds}
      label="Image"
    >
      <DefaultImageToolbarContent
        imageShapeId={imageShapeId as any}
        isManipulating={isInCropTool}
        onEditAltTextStart={() => {}}
        onManipulatingStart={() => editor.setCurrentTool("select.crop.idle")}
        onManipulatingEnd={() => {
          editor.setCroppingShape(null);
          editor.setCurrentTool("select.idle");
        }}
      />
      <ToolbarUrlButton />
    </TldrawUiContextualToolbar>
  );
}

function CaptureSourceContextToolbar() {
  const editor = useEditor();
  const captureSource = useValue(
    "captureSourceToolbar",
    () => {
      const s = editor.getOnlySelectedShape();
      if (!s) return null;
      if (
        s.type !== "text" &&
        s.type !== "note" &&
        s.type !== "geo" &&
        s.type !== "researchQuote"
      )
        return null;
      const url = String(
        (s.meta as { sourceUrl?: string } | undefined)?.sourceUrl ?? "",
      );
      if (!url) return null;
      return { id: s.id, sourceUrl: url };
    },
    [editor],
  );
  const showToolbar = useValue(
    "captureSourceShowToolbar",
    () => editor.isInAny("select.idle", "select.pointing_shape"),
    [editor],
  );
  const getSelectionBounds = useCallback(() => {
    const fullBounds = editor.getSelectionScreenBounds();
    if (!fullBounds) return undefined;
    return new Box(fullBounds.x, fullBounds.y, fullBounds.width, 0);
  }, [editor]);

  if (!captureSource || !showToolbar) return null;

  const copyPlainText = () => {
    const shape = editor.getShape(captureSource.id);
    if (!shape) return;
    const rt = (shape.props as { richText?: TLRichText }).richText;
    if (!rt) return;
    const plain = renderPlaintextFromRichText(editor, rt);
    void navigator.clipboard.writeText(plain);
  };

  return (
    <TldrawUiContextualToolbar
      key={String(captureSource.id)}
      className="tlui-capture-source__toolbar"
      getSelectionBounds={getSelectionBounds}
      label="Capture"
    >
      <TldrawUiToolbarButton
        type="icon"
        onClick={copyPlainText}
        title="Copy text"
        aria-label="Copy text"
      >
        <TldrawUiButtonIcon icon="clipboard-copy" small />
      </TldrawUiToolbarButton>
      <TldrawUiToolbarButton
        type="icon"
        onClick={() =>
          window.open(captureSource.sourceUrl, "_blank", "noopener,noreferrer")
        }
        title={captureSource.sourceUrl}
        aria-label="Open source URL"
      >
        <TldrawUiButtonIcon icon="external-link" small />
      </TldrawUiToolbarButton>
    </TldrawUiContextualToolbar>
  );
}

function VideoToolbarWithUrl() {
  const editor = useEditor();
  const videoShapeId = useValue(
    "videoShape",
    () => {
      const onlySelectedShape = editor.getOnlySelectedShape();
      if (!onlySelectedShape || onlySelectedShape.type !== "video") return null;
      return onlySelectedShape.id;
    },
    [editor],
  );
  const showToolbar = useValue(
    "showVideoToolbar",
    () => editor.isInAny("select.idle", "select.pointing_shape"),
    [editor],
  );
  const isLocked = useValue(
    "videoLocked",
    () => (videoShapeId ? editor.getShape(videoShapeId)?.isLocked : false),
    [editor, videoShapeId],
  );
  const getSelectionBounds = useCallback(() => {
    const fullBounds = editor.getSelectionScreenBounds();
    if (!fullBounds) return undefined;
    return new Box(fullBounds.x, fullBounds.y, fullBounds.width, 0);
  }, [editor]);
  if (!videoShapeId || !showToolbar || isLocked) return null;

  return (
    <TldrawUiContextualToolbar
      className="tlui-video__toolbar"
      getSelectionBounds={getSelectionBounds}
      label="Video"
    >
      <DefaultVideoToolbarContent
        videoShapeId={videoShapeId as any}
        onEditAltTextStart={() => {}}
      />
    </TldrawUiContextualToolbar>
  );
}

export function ResearchCanvasApp() {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const loadArtifactsSeq = useRef(0);
  const loadArtifactsRef = useRef<() => Promise<void>>(async () => {});

  const loadArtifacts = useCallback(async () => {
    const seq = (loadArtifactsSeq.current += 1);
    const res = (await chrome.runtime.sendMessage({
      type: "LIST_ARTIFACTS",
    } as RuntimeMessage)) as { ok: boolean; artifacts: ArtifactRecord[] };
    if (seq !== loadArtifactsSeq.current) return;
    if (res.ok) setArtifacts(res.artifacts);
  }, []);

  loadArtifactsRef.current = loadArtifacts;

  useEffect(() => {
    void chrome.storage.local.remove("pendingCaptureRequest");
    let cancelled = false;
    void (async () => {
      await mergeDeletedArtifactTombstones();
      if (cancelled) return;
      await loadArtifacts();
      if (!cancelled) setSessionReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadArtifacts]);

  useEffect(() => {
    const heartbeat = () => {
      const now = Date.now();
      void chrome.storage.local.set({ sidePanelHeartbeatAt: now });
      void chrome.runtime.sendMessage({
        type: "SIDE_PANEL_HEARTBEAT",
      } as RuntimeMessage);
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 2000);
    /** When the side panel is hidden (Chrome UI) but not unloaded, stop heartbeats so the toolbar can open it again. */
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        void chrome.storage.local.remove("sidePanelHeartbeatAt");
        void chrome.runtime.sendMessage({
          type: "SIDE_PANEL_HIDDEN",
        } as RuntimeMessage);
      } else {
        heartbeat();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
      void chrome.storage.local.remove("sidePanelHeartbeatAt");
      void chrome.runtime.sendMessage({
        type: "SIDE_PANEL_HIDDEN",
      } as RuntimeMessage);
    };
  }, []);

  useEffect(() => {
    const listener = (msg: RuntimeMessage) => {
      if (msg.type === "CLOSE_SIDE_PANEL") {
        window.close();
        return;
      }
      if (msg.type === "OPEN_CANVAS") {
        void loadArtifactsRef.current();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const onTldrawMount = useCallback((editor: Editor) => {
    migrateLegacyYoutubeEmbedUrls(editor);
    const gridSeededKey = `research-canvas-grid-seeded-v1-${MAIN_DOCUMENT_ID}`;
    try {
      if (!localStorage.getItem(gridSeededKey)) {
        editor.updateInstanceState({ isGridMode: true });
        localStorage.setItem(gridSeededKey, "1");
      }
    } catch {
      editor.updateInstanceState({ isGridMode: true });
    }
  }, []);

  const muted = "#555555";

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
      <main style={{ flex: 1, minHeight: 0 }}>
        {!sessionReady ? (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              height: "100%",
              color: muted,
              fontFamily: "system-ui, sans-serif",
              fontSize: 14,
            }}
          >
            Loading…
          </div>
        ) : (
          <Tldraw
            persistenceKey={`canvas-v2-${MAIN_DOCUMENT_ID}`}
            embeds={RESEARCH_EMBED_DEFINITIONS}
            shapeUtils={RESEARCH_SHAPE_UTILS}
            onMount={onTldrawMount}
            components={{
              ImageToolbar: ImageToolbarWithUrl,
              VideoToolbar: VideoToolbarWithUrl,
            }}
          >
            <CanvasScene
              artifacts={artifacts}
              onArtifactsChanged={() => {
                void loadArtifacts();
              }}
            />
            <CaptureSourceContextToolbar />
          </Tldraw>
        )}
      </main>
    </div>
  );
}
