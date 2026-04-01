import { type ArtifactRecord, type RuntimeMessage } from "@shared/messages";
import type { CanvasMeta } from "@storage/canvases";
import { MAIN_DOCUMENT_ID } from "@shared/document";
import {
  getLastOpenCanvasId,
  loadCanvases,
  makeCanvasId,
  nextCanvasName,
  saveCanvases,
  setLastOpenCanvasId,
  withUpdatedTimestamp,
} from "@storage/canvases";
import { listArtifacts, readBlobAsDataUrl } from "@storage/repositories";
import { mergeDeletedArtifactTombstones } from "@storage/tombstones";
import type { Editor } from "@tldraw/editor";
import {
  Box,
  DefaultImageToolbarContent,
  DefaultMainMenu,
  DefaultMainMenuContent,
  DefaultVideoToolbarContent,
  renderPlaintextFromRichText,
  serializeTldrawJson,
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
import {
  applyCanvasBackup,
  isCanvasBackup,
  isTldrawSnapshot,
  parseOfficialTldrawFile,
} from "./backup";
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
 * Place new artifacts in the **visible** viewport: a small grid anchored at the **center** of
 * what’s on screen (page space). Top-left anchoring felt wrong when zoomed out (huge page rect)
 * and pushed items to the edges; center anchoring stays stable at any zoom.
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
  const cx = vp.midX;
  const cy = vp.midY;
  // Three columns centered on the viewport; middle column near `cx`.
  let x = cx - ARTIFACT_GRID_STEP_X + col * ARTIFACT_GRID_STEP_X;
  // First row sits slightly above geometric center so the card reads as “in the middle”.
  const firstRowY = cy - 90 + row * ARTIFACT_GRID_STEP_Y;
  let y = firstRowY;
  const minX = vp.x + ARTIFACT_VIEWPORT_PAD;
  const maxX = vp.maxX - ARTIFACT_VIEWPORT_PAD - 200;
  const minY = vp.y + ARTIFACT_VIEWPORT_PAD;
  const maxY = vp.maxY - ARTIFACT_VIEWPORT_PAD - 120;
  x = Math.max(minX, Math.min(x, maxX));
  y = Math.max(minY, Math.min(y, maxY));
  return { x, y };
}

function artifactGridFallbackPosition(index: number) {
  return {
    x: 80 + (index % 3) * ARTIFACT_GRID_STEP_X,
    y: 80 + Math.floor(index / 3) * ARTIFACT_GRID_STEP_Y,
  };
}

/**
 * When false, avoid viewport-based placement (hidden tab / zero-size panel) so we do not snap to
 * arbitrary fallback coords that change when the user returns.
 *
 * Note: tldraw also syncs the document across surfaces that share `persistenceKey` via
 * BroadcastChannel (`tldraw-tab-sync-…`). Two live canvases (e.g. two windows) merge edits; that
 * can look like “jumping” when switching focus.
 */
function isPlacementEnvironmentViable(editor: Editor): boolean {
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  ) {
    return false;
  }
  const vp = editor.getViewportPageBounds();
  return vp.width >= 1 && vp.height >= 1;
}

function resolveArtifactPlacement(
  editor: Editor,
  artifact: ArtifactRecord,
  index: number,
): { x: number; y: number } | null {
  const cx = artifact.canvasX;
  const cy = artifact.canvasY;
  if (
    typeof cx === "number" &&
    typeof cy === "number" &&
    Number.isFinite(cx) &&
    Number.isFinite(cy)
  ) {
    return { x: cx, y: cy };
  }
  if (isPlacementEnvironmentViable(editor)) {
    return artifactPositionInViewport(editor, index);
  }
  // Avoid persisting unstable fallback coords while hidden / zero-size.
  // We'll retry on the next visibility/resize epoch.
  return null;
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
  canvasId,
}: {
  artifacts: ArtifactRecord[];
  onArtifactsChanged?: () => void;
  canvasId: string;
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

  /** Re-run artifact→shape sync when the side panel becomes visible or resizes so deferred creates use a valid viewport. */
  const [placementEpoch, setPlacementEpoch] = useState(0);
  useEffect(() => {
    const bump = () => {
      if (document.visibilityState === "visible") {
        requestAnimationFrame(() => setPlacementEpoch((n) => n + 1));
      }
    };
    document.addEventListener("visibilitychange", bump);
    window.addEventListener("resize", bump);
    return () => {
      document.removeEventListener("visibilitychange", bump);
      window.removeEventListener("resize", bump);
    };
  }, []);

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
        setDeletedArtifactIds(all[canvasId] ?? []);
      })
      .catch(() => {
        if (!cancelled) setDeletedArtifactIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canvasId]);

  useEffect(() => {
    if (deletedArtifactIds === null) return;
    const unique = [...new Set(deletedArtifactIds)];
    void chrome.storage.local.get("deletedArtifactIdsByCanvas").then((res) => {
      const all = (res.deletedArtifactIdsByCanvas ?? {}) as Record<
        string,
        string[]
      >;
      all[canvasId] = unique;
      void chrome.storage.local.set({ deletedArtifactIdsByCanvas: all });
    });
  }, [deletedArtifactIds, canvasId]);

  useEffect(() => {
    if (!editor) return;
    editor.selectNone();
  }, [editor]);

  useEffect(() => {
    renderedArtifactIdsRef.current.clear();
    pendingDeletedArtifactIdsRef.current.clear();
    setDeletedArtifactIds(null);
  }, [canvasId]);

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

    const persistNewPlacement = (artifactId: string, x: number, y: number) => {
      if (import.meta.env.DEV) {
        console.debug("[ResearchCanvas] createShape", { artifactId, x, y });
      }
      void chrome.runtime
        .sendMessage({
          type: "SET_ARTIFACT_CANVAS_POSITION",
          artifactId,
          canvasId,
          canvasX: x,
          canvasY: y,
        } as RuntimeMessage)
        .then(() => onArtifactsChangedRef.current?.());
    };

    artifacts.forEach((artifact, index) => {
      if (deletedSet.has(artifact.id)) return;
      const position = resolveArtifactPlacement(editor, artifact, index);
      if (!position) return;
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
          persistNewPlacement(artifact.id, position.x, position.y);
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
          persistNewPlacement(artifact.id, position.x, position.y);
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
          persistNewPlacement(artifact.id, position.x, position.y);
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
          persistNewPlacement(artifact.id, position.x, position.y);
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
            ...(artifact.profileUrl ? { profileUrl: artifact.profileUrl } : {}),
          },
        });
        persistNewPlacement(artifact.id, position.x, position.y);
        renderedArtifactIdsRef.current.add(artifact.id);
        return;
      }
      if (artifact.type === "video") {
        const primaryId = String(toShapeId(artifact.id));
        const existing = editor.getShape(primaryId as any);
        const src = artifact.dataUrl ?? artifact.sourceUrl;
        if (existing) {
          if (existing.type === "video") {
            const prevRev = Number(
              (existing.meta as { videoReloadedAt?: number })
                ?.videoReloadedAt ?? 0,
            );
            const newRev = Number(artifact.videoReloadedAt ?? 0);
            const assetId = (existing.props as { assetId?: string }).assetId;
            if (newRev > prevRev && src && assetId) {
              const prevAsset = editor.getAsset(assetId as any);
              editor.updateAssets([
                {
                  id: assetId as any,
                  type: "video",
                  typeName: "asset",
                  props: {
                    ...((prevAsset as { props?: object })?.props ?? {}),
                    src,
                    w: artifact.width ?? 420,
                    h: artifact.height ?? 260,
                    name: artifact.title,
                    isAnimated: true,
                    mimeType: "video/webm",
                  },
                  meta: (prevAsset as { meta?: object })?.meta ?? {},
                },
              ]);
            }
            editor.updateShape({
              id: existing.id as any,
              type: "video",
              meta: {
                ...((existing.meta as object) ?? {}),
                sourceUrl: artifact.sourceUrl,
                artifactId: artifact.id,
                ...(artifact.capturedFromUrl
                  ? { capturedFromUrl: artifact.capturedFromUrl }
                  : {}),
                ...(artifact.profileUrl
                  ? { profileUrl: artifact.profileUrl }
                  : {}),
                ...(artifact.localVideoAbsolutePath
                  ? { localVideoAbsolutePath: artifact.localVideoAbsolutePath }
                  : {}),
                ...(artifact.videoReloadedAt
                  ? { videoReloadedAt: artifact.videoReloadedAt }
                  : {}),
              },
            });
          }
          renderedArtifactIdsRef.current.add(artifact.id);
          return;
        }
        const assetId = toAssetId(`${artifact.id}_video_asset`);
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
            artifactId: artifact.id,
            ...(artifact.capturedFromUrl
              ? { capturedFromUrl: artifact.capturedFromUrl }
              : {}),
            ...(artifact.profileUrl ? { profileUrl: artifact.profileUrl } : {}),
            ...(artifact.localVideoAbsolutePath
              ? { localVideoAbsolutePath: artifact.localVideoAbsolutePath }
              : {}),
            ...(artifact.videoReloadedAt
              ? { videoReloadedAt: artifact.videoReloadedAt }
              : {}),
          },
        });
        persistNewPlacement(artifact.id, position.x, position.y);
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
          persistNewPlacement(artifact.id, position.x, position.y);
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
        persistNewPlacement(artifact.id, position.x, position.y);
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
      persistNewPlacement(artifact.id, position.x, position.y);
      renderedArtifactIdsRef.current.add(artifact.id);
    });
  }, [artifacts, deletedArtifactIds, editor, placementEpoch]);
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
    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com"
    ) {
      if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v") ?? "";
      } else if (url.pathname.startsWith("/shorts/")) {
        videoId = url.pathname.split("/")[2] ?? "";
      } else if (url.pathname.startsWith("/live/")) {
        videoId = url.pathname.split("/")[2] ?? "";
      } else if (url.pathname.startsWith("/embed/")) {
        videoId = url.pathname.split("/")[2] ?? "";
      }
    } else if (host === "youtube-nocookie.com") {
      if (url.pathname.startsWith("/embed/")) {
        videoId = url.pathname.split("/")[2] ?? "";
      }
    } else if (host === "youtu.be") {
      videoId = url.pathname.replace("/", "");
    }
    if (!videoId) return null;
    const embed = new URL(`https://www.youtube.com/embed/${videoId}`);
    // Required identity hints for stricter YouTube embed validation paths.
    embed.searchParams.set("origin", "https://www.youtube.com");
    embed.searchParams.set("widget_referrer", "https://www.youtube.com");
    return embed.toString();
  } catch {
    return null;
  }
}

function ToolbarUrlButton() {
  const editor = useEditor();
  const selectedIds = editor.getSelectedShapeIds();
  if (selectedIds.length !== 1) return null;
  const shape = editor.getShape(selectedIds[0]);
  const meta =
    (shape?.meta as {
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

function BackupMainMenu() {
  return (
    <DefaultMainMenu>
      <DefaultMainMenuContent />
    </DefaultMainMenu>
  );
}

const TLDRAW_COMPONENTS = {
  ImageToolbar: ImageToolbarWithUrl,
  VideoToolbar: VideoToolbarWithUrl,
  MainMenu: BackupMainMenu,
  ColorSchemeMenu: null,
} as any;

type PendingImport = {
  canvasId: string;
  snapshot: unknown;
  sourceKind: "wrapped-backup" | "official-tldr" | "raw-snapshot";
  applyMode: "merge" | "restore";
};

export function ResearchCanvasApp() {
  const [canvases, setCanvases] = useState<CanvasMeta[]>([]);
  const [currentCanvasId, setCurrentCanvasId] = useState<string | null>(null);
  const [isBlurredPrivate, setIsBlurredPrivate] = useState(false);
  const [importStatus, setImportStatus] = useState<string>("");
  const [showSidebar, setShowSidebar] = useState(false);
  const [openCanvasMenuId, setOpenCanvasMenuId] = useState<string | null>(null);
  const [uiTheme, setUiTheme] = useState<"light" | "dark">("light");
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const [mountedEditorCanvasId, setMountedEditorCanvasId] = useState<
    string | null
  >(null);
  const loadArtifactsSeq = useRef(0);
  const activeCanvasIdRef = useRef<string>(MAIN_DOCUMENT_ID);
  const loadArtifactsRef = useRef<() => Promise<void>>(async () => {});
  const editorRef = useRef<Editor | null>(null);
  const pendingImportRef = useRef<PendingImport | null>(null);

  const isFullScreenTab = (() => {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get("fullscreen") === "1";
    } catch {
      return false;
    }
  })();
  const isSidePanelMode = !isFullScreenTab;

  const currentCanvas = canvases.find((c) => c.id === currentCanvasId) ?? null;
  const effectiveCanvasId = currentCanvas?.id ?? "main";
  const isDarkTheme = uiTheme === "dark";

  useEffect(() => {
    activeCanvasIdRef.current = effectiveCanvasId;
  }, [effectiveCanvasId]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("research-canvas-ui-theme");
      if (saved === "dark" || saved === "light") {
        setUiTheme(saved);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("research-canvas-ui-theme", uiTheme);
    } catch {}
  }, [uiTheme]);

  const loadArtifacts = useCallback(async (targetCanvasId?: string) => {
    const canvasIdToLoad = targetCanvasId ?? activeCanvasIdRef.current;
    const seq = (loadArtifactsSeq.current += 1);
    const base = await listArtifacts();
    const withData: ArtifactRecord[] = await Promise.all(
      base.map(async (row) => {
        if (row.dataUrl) return row;
        if (row.blobId) {
          const dataUrl = await readBlobAsDataUrl(row.blobId);
          return { ...row, dataUrl: dataUrl ?? undefined };
        }
        return row;
      }),
    );
    if (seq !== loadArtifactsSeq.current) return;
    if (canvasIdToLoad !== activeCanvasIdRef.current) return;
    setArtifacts(withData.filter((row) => row.canvasId === canvasIdToLoad));
  }, []);

  loadArtifactsRef.current = () => loadArtifacts(activeCanvasIdRef.current);

  useEffect(() => {
    void chrome.storage.local.remove("pendingCaptureRequest");
    let cancelled = false;
    void (async () => {
      await mergeDeletedArtifactTombstones();
      if (cancelled) return;
      const storedCanvases = await loadCanvases();
      const lastId = await getLastOpenCanvasId();
      const initial =
        storedCanvases.find((c) => c.id === lastId) ?? storedCanvases[0];
      setCanvases(storedCanvases);
      setCurrentCanvasId(initial.id);
      const isPrivate = !!initial.isPrivate;
      setIsBlurredPrivate(isPrivate);
      if (cancelled) return;
      await loadArtifacts(initial.id);
      if (!cancelled) setSessionReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadArtifacts]);

  useEffect(() => {
    const pending = pendingImportRef.current;
    if (!pending) return;
    if (pending.canvasId !== effectiveCanvasId) return;
    if (mountedEditorCanvasId !== pending.canvasId) {
      console.debug("[ResearchCanvas] import: waiting for editor mount", {
        pendingCanvasId: pending.canvasId,
        mountedEditorCanvasId,
      });
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    void (async () => {
      try {
        await applyCanvasBackup(editor, pending.snapshot as any, {
          mode: pending.applyMode,
        });
        await loadArtifacts(pending.canvasId);
        console.debug("[ResearchCanvas] import: apply completed", {
          sourceKind: pending.sourceKind,
        });
        setImportStatus("Import complete.");
        window.alert("Research Canvas: Import complete. Check your page list.");
      } catch (error) {
        console.error("Failed to apply imported canvas backup:", error);
        const message =
          error instanceof Error ? error.message : "Unknown import error.";
        const userMessage = message.includes("empty")
          ? "Import failed: the file snapshot is empty."
          : message.includes("readable tldraw snapshot")
            ? "Import failed: this file does not contain a compatible snapshot."
            : `Import failed: ${message}`;
        setImportStatus(userMessage);
        window.alert(`Research Canvas: ${userMessage}`);
      } finally {
        pendingImportRef.current = null;
      }
    })();
  }, [effectiveCanvasId, loadArtifacts, mountedEditorCanvasId]);

  useEffect(() => {
    if (!isSidePanelMode) {
      return;
    }

    const heartbeat = () => {
      const now = Date.now();
      void chrome.storage.local.set({ sidePanelHeartbeatAt: now });
      void chrome.runtime.sendMessage({
        type: "SIDE_PANEL_HEARTBEAT",
        canvasId: effectiveCanvasId,
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
  }, [effectiveCanvasId, isSidePanelMode]);

  useEffect(() => {
    if (!isFullScreenTab) {
      return;
    }

    const notifyActive = () => {
      void chrome.runtime.sendMessage({
        type: "FULLSCREEN_CANVAS_ACTIVE",
        canvasId: effectiveCanvasId,
      } as RuntimeMessage);
    };

    notifyActive();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        notifyActive();
      }
    };
    const onFocus = () => notifyActive();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [effectiveCanvasId, isFullScreenTab]);

  useEffect(() => {
    const listener = (msg: RuntimeMessage) => {
      if (msg.type === "CLOSE_SIDE_PANEL") {
        if (isSidePanelMode) {
          window.close();
        }
        return;
      }
      if (msg.type === "OPEN_CANVAS") {
        void loadArtifactsRef.current();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const onTldrawMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      setMountedEditorCanvasId(effectiveCanvasId);
      editor.user.updateUserPreferences({ colorScheme: uiTheme });
      migrateLegacyYoutubeEmbedUrls(editor);
      const gridSeededKey = `research-canvas-grid-seeded-v1-${effectiveCanvasId}`;
      try {
        if (!localStorage.getItem(gridSeededKey)) {
          editor.updateInstanceState({ isGridMode: true });
          localStorage.setItem(gridSeededKey, "1");
        }
      } catch {
        editor.updateInstanceState({ isGridMode: true });
      }
    },
    [effectiveCanvasId, uiTheme],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.user.updateUserPreferences({ colorScheme: uiTheme });
  }, [uiTheme, effectiveCanvasId]);

  const handleExportBackup = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !currentCanvas) return;
    try {
      const json = await serializeTldrawJson(editor);
      const blob = new Blob([json], { type: "application/vnd.tldraw+json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      const safeName = currentCanvas.name.replace(/[^a-zA-Z0-9-_]+/g, "_");
      link.href = url;
      link.download = `research-canvas-${safeName}-${date}.tldr`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export canvas backup:", error);
      window.alert("Research Canvas: Failed to export backup.");
    }
  }, [currentCanvas]);

  const importFromFile = useCallback(
    async (file: File) => {
      const editor = editorRef.current;
      if (!editor) return;
      console.debug("[ResearchCanvas] import: picked file", {
        name: file.name,
        size: file.size,
        type: file.type,
      });
      setImportStatus(`Importing ${file.name}...`);
      const reader = new FileReader();
      reader.onload = () => {
        void (async () => {
          try {
            const text = String(reader.result || "");
            console.debug("[ResearchCanvas] import: file text length", {
              length: text.length,
            });
            const raw = JSON.parse(text);
            console.debug("[ResearchCanvas] import: parsed JSON keys", {
              keys: Object.keys(raw ?? {}),
            });
            const officialStoreSnapshot = parseOfficialTldrawFile(editor, text);
            const isWrapped = isCanvasBackup(raw);
            const isSnapshot = isTldrawSnapshot(raw);
            const importKind: PendingImport["sourceKind"] = isWrapped
              ? "wrapped-backup"
              : officialStoreSnapshot
                ? "official-tldr"
                : "raw-snapshot";

            if (
              !officialStoreSnapshot &&
              !isWrapped &&
              !isSnapshot &&
              !raw?.document &&
              !raw?.store
            ) {
              throw new Error(
                "Selected file is not a valid .tldr snapshot or Research Canvas backup.",
              );
            }

            if (
              !window.confirm(
                "Importing will create a new canvas from this file. Continue?",
              )
            ) {
              setImportStatus("Import cancelled.");
              return;
            }
            console.debug("[ResearchCanvas] import: applying data", {
              importKind,
              officialTldrParsed: !!officialStoreSnapshot,
              isWrappedBackup: isWrapped,
              isSnapshot,
            });
            const baseName = file.name.replace(/\.(tldr|json)$/i, "");
            const newId = makeCanvasId();
            const newName = nextCanvasName(canvases, `Imported - ${baseName}`);
            const importedIsPrivate =
              isWrapped && typeof (raw as any).isPrivate === "boolean"
                ? !!(raw as any).isPrivate
                : false;
            const created: CanvasMeta = {
              id: newId,
              name: newName,
              isPrivate: importedIsPrivate,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            const nextCanvases = [...canvases, created];
            await saveCanvases(nextCanvases);
            await setLastOpenCanvasId(newId);
            setCanvases(nextCanvases);
            setCurrentCanvasId(newId);
            let snapshotSource: unknown =
              officialStoreSnapshot ||
              (isWrapped || isSnapshot || raw?.document || raw?.store
                ? raw
                : null);
            if (!snapshotSource) {
              throw new Error("Could not parse import file.");
            }
            if (isWrapped) {
              snapshotSource = {
                ...(snapshotSource as any),
                mainDocumentId: newId,
              };
            }
            pendingImportRef.current = {
              canvasId: newId,
              snapshot: snapshotSource,
              sourceKind: importKind,
              applyMode: "restore",
            };
            console.debug("[ResearchCanvas] import: queued apply", {
              canvasId: newId,
              sourceKind: importKind,
              importedIsPrivate,
            });
            setImportStatus("Applying import...");
          } catch (error) {
            console.error("Failed to import canvas backup:", error);
            const message =
              error instanceof Error ? error.message : "Unknown import error.";
            const userMessage = message.includes("not a valid")
              ? "Import failed: file is not a valid .tldr or Research Canvas backup."
              : message.includes("Unexpected token")
                ? "Import failed: file is not valid JSON."
                : `Import failed: ${message}`;
            setImportStatus(userMessage);
            window.alert(`Research Canvas: ${userMessage}`);
          }
        })();
      };
      reader.readAsText(file);
    },
    [canvases, loadArtifacts],
  );

  const openImportPicker = useCallback(() => {
    console.debug("[ResearchCanvas] import: open file picker");
    setImportStatus("Opening file picker...");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tldr,.json,application/json,application/vnd.tldraw+json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        setImportStatus("No file selected.");
        return;
      }
      void importFromFile(file);
    };
    input.click();
  }, [importFromFile]);

  const handleCreateCanvas = useCallback(async () => {
    const id = makeCanvasId();
    const name = nextCanvasName(canvases);
    const now = Date.now();
    const created: CanvasMeta = {
      id,
      name,
      isPrivate: false,
      createdAt: now,
      updatedAt: now,
    };
    const next = [...canvases, created];
    setCanvases(next);
    await saveCanvases(next);
    await setLastOpenCanvasId(id);
    setCurrentCanvasId(id);
    setIsBlurredPrivate(false);
    await loadArtifacts(id);
  }, [canvases, loadArtifacts]);

  const handleSelectCanvas = useCallback(
    async (id: string) => {
      if (id === currentCanvasId) return;
      const nextCurrent = canvases.find((c) => c.id === id);
      if (!nextCurrent) return;
      setCurrentCanvasId(id);
      await setLastOpenCanvasId(id);
      const isPrivate = !!nextCurrent.isPrivate;
      setIsBlurredPrivate(isPrivate);
      await loadArtifacts(id);
    },
    [canvases, currentCanvasId, loadArtifacts],
  );

  const handleRenameCanvas = useCallback(
    async (id: string) => {
      const target = canvases.find((c) => c.id === id);
      if (!target) return;
      const nextName = window.prompt("Rename canvas", target.name);
      if (!nextName) return;
      const trimmed = nextName.trim();
      if (!trimmed || trimmed === target.name) return;
      const updated = canvases.map((c) =>
        c.id === id ? withUpdatedTimestamp({ ...c, name: trimmed }) : c,
      );
      setCanvases(updated);
      await saveCanvases(updated);
    },
    [canvases],
  );

  const handleTogglePrivate = useCallback(
    async (id: string) => {
      const updated = canvases.map((c) =>
        c.id === id
          ? withUpdatedTimestamp({ ...c, isPrivate: !c.isPrivate })
          : c,
      );
      setCanvases(updated);
      await saveCanvases(updated);
      if (currentCanvasId === id) {
        const nowPrivate = updated.find((c) => c.id === id)?.isPrivate;
        if (nowPrivate) {
          setIsBlurredPrivate(true);
        } else {
          setIsBlurredPrivate(false);
        }
      }
    },
    [canvases, currentCanvasId],
  );

  const handleDeleteCanvas = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this canvas? This cannot be undone.")) return;
      const remaining = canvases.filter((c) => c.id !== id);
      if (!remaining.length) {
        const freshId = makeCanvasId();
        const now = Date.now();
        const created: CanvasMeta = {
          id: freshId,
          name: "Board 1",
          isPrivate: false,
          createdAt: now,
          updatedAt: now,
        };
        setCanvases([created]);
        await saveCanvases([created]);
        await setLastOpenCanvasId(freshId);
        setCurrentCanvasId(freshId);
        setIsBlurredPrivate(false);
        await loadArtifacts(freshId);
        return;
      }
      setCanvases(remaining);
      await saveCanvases(remaining);
      if (currentCanvasId === id) {
        const next = remaining[0];
        setCurrentCanvasId(next.id);
        await setLastOpenCanvasId(next.id);
        const isPrivate = !!next.isPrivate;
        setIsBlurredPrivate(isPrivate);
        await loadArtifacts(next.id);
      }
    },
    [canvases, currentCanvasId, loadArtifacts],
  );

  const visibleCanvases = canvases;

  useEffect(() => {
    if (!importStatus) return;
    const timeout = window.setTimeout(() => {
      setImportStatus("");
    }, 4000);
    return () => window.clearTimeout(timeout);
  }, [importStatus]);

  const muted = "#555555";

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        background: isDarkTheme ? "#0f172a" : "#ffffff",
        color: isDarkTheme ? "#e5e7eb" : "#111827",
      }}
      data-fullscreen-canvas={isFullScreenTab ? "1" : "0"}
    >
      {openCanvasMenuId ? (
        <div
          onClick={() => setOpenCanvasMenuId(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 19,
          }}
        />
      ) : null}
      <main style={{ flex: 1, minHeight: 0, position: "relative" }}>
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
          <>
            <button
              type="button"
              onClick={() => setIsBlurredPrivate(true)}
              style={{
                position: "absolute",
                bottom: 110,
                right: 6,
                zIndex: 10000,
                width: 24,
                height: 24,
                borderRadius: 999,
                border: "none",
                background: isDarkTheme
                  ? "rgba(226,232,240,0.95)"
                  : "rgba(17,24,39,0.9)",
                color: isDarkTheme ? "#111827" : "white",
                fontSize: 12,
                cursor: "pointer",
                display:
                  currentCanvas?.isPrivate && !isBlurredPrivate ? "flex" : "none",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="Lock board"
              aria-label="Lock board"
            >
              🔒
            </button>
            <button
              type="button"
              onClick={() => {
                void chrome.runtime.sendMessage({
                  type: "OPEN_CANVAS_TAB",
                } as RuntimeMessage);
              }}
              style={{
                position: "absolute",
                bottom: 80,
                right: 6,
                zIndex: 10000,
                width: 24,
                height: 24,
                borderRadius: 999,
                border: "none",
                background: isDarkTheme
                  ? "rgba(226,232,240,0.95)"
                  : "rgba(17,24,39,0.9)",
                color: isDarkTheme ? "#111827" : "white",
                fontSize: 12,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="Open full-screen board"
            >
              ⛶
            </button>
            <button
              type="button"
              onClick={() => setShowSidebar((v) => !v)}
              style={{
                position: "absolute",
                bottom: 50,
                right: 6,
                zIndex: 10000,
                width: 24,
                height: 24,
                borderRadius: 999,
                border: "none",
                background: isDarkTheme
                  ? "rgba(226,232,240,0.95)"
                  : "rgba(17,24,39,0.9)",
                color: isDarkTheme ? "#111827" : "white",
                fontSize: 14,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title={
                showSidebar ? "Hide boards sidebar" : "Show boards sidebar"
              }
            >
              {showSidebar ? "⟨⟨" : "⟩⟩"}
            </button>
            {importStatus ? (
              <div
                onClick={() => setImportStatus("")}
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  zIndex: 9999,
                  fontSize: 12,
                  background: "rgba(17,24,39,0.9)",
                  color: "white",
                  padding: "6px 10px",
                  borderRadius: 8,
                  fontFamily: "system-ui, sans-serif",
                  cursor: "pointer",
                }}
              >
                {importStatus}
              </div>
            ) : null}
            <Tldraw
              persistenceKey={`canvas-v2-${effectiveCanvasId}`}
              embeds={RESEARCH_EMBED_DEFINITIONS}
              shapeUtils={RESEARCH_SHAPE_UTILS}
              onMount={onTldrawMount}
              components={TLDRAW_COMPONENTS}
            >
              <CanvasScene
                artifacts={artifacts}
                canvasId={effectiveCanvasId}
                onArtifactsChanged={() => {
                  void loadArtifacts();
                }}
              />
              <CaptureSourceContextToolbar />
            </Tldraw>
            {currentCanvas?.isPrivate && isBlurredPrivate ? (
              <>
                <div
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const now = Date.now();
                    const last = (window as any).__researchCanvasLastRightClickAt as
                      | number
                      | undefined;
                    (window as any).__researchCanvasLastRightClickAt = now;
                    if (last && now - last < 650 && currentCanvas) {
                      setIsBlurredPrivate(false);
                      (window as any).__researchCanvasLastRightClickAt = undefined;
                    }
                  }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    backdropFilter: "blur(50px)",
                    backgroundColor: "rgba(15,23,42,0.7)",
                    pointerEvents: "auto",
                    zIndex: 40,
                  }}
                />
              </>
            ) : null}
          </>
        )}
      </main>
      {showSidebar ? (
        <aside
          style={{
            width: 220,
            borderLeft: isDarkTheme ? "2px solid #353341" : "2px solid #E8E9EA",
            background: isDarkTheme ? "#202125" : "#EDF0F2",
            color: isDarkTheme ? "#e5e7eb" : "#111827",
            padding: 8,
            boxSizing: "border-box",
            fontFamily: "system-ui, sans-serif",
            fontSize: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <span style={{ fontWeight: 600 }}>Boards</span>
            <button
              type="button"
              onClick={handleCreateCanvas}
              style={{
                border: isDarkTheme
                  ? "1px solid rgba(148,163,184,0.5)"
                  : "1px solid rgba(0,0,0,0.15)",
                background: "transparent",
                color: "inherit",
                borderRadius: 6,
                padding: "2px 6px",
                cursor: "pointer",
                fontSize: 20,
              }}
            >
              +
            </button>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {visibleCanvases.map((canvas) => {
              const isCurrent = canvas.id === currentCanvasId;
              return (
                <div
                  key={canvas.id}
                  style={{
                    padding: "6px 6px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: isCurrent
                      ? isDarkTheme
                        ? "rgba(148,163,184,0.2)"
                        : "rgba(17,24,39,0.08)"
                      : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 4,
                  }}
                  onClick={() => handleSelectCanvas(canvas.id)}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      title={canvas.name}
                      style={{
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                      }}
                    >
                      {canvas.name}
                    </span>
                    {canvas.isPrivate ? (
                      <span
                        style={{
                          fontSize: 10,
                          opacity: 0.7,
                        }}
                      >
                        Locked
                      </span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      title="More actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenCanvasMenuId((prev) =>
                          prev === canvas.id ? null : canvas.id,
                        );
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        fontSize: 18,
                        padding: 0,
                        lineHeight: 1,
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        fill="none"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M12 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM12 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM10 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"
                          fill={isDarkTheme ? "#FFFFFF" : "#000000"}
                        />
                      </svg>
                    </button>
                    {openCanvasMenuId === canvas.id ? (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: "absolute",
                          top: "110%",
                          right: 0,
                          minWidth: 140,
                          background: "#111827",
                          color: "white",
                          borderRadius: 6,
                          boxShadow:
                            "0 10px 15px -3px rgba(0,0,0,0.3), 0 4px 6px -4px rgba(0,0,0,0.3)",
                          padding: 4,
                          zIndex: 20,
                          fontSize: 11,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setOpenCanvasMenuId(null);
                            void handleRenameCanvas(canvas.id);
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "6px 10px",
                            border: "none",
                            background: "transparent",
                            color: "inherit",
                            cursor: "pointer",
                            borderRadius: 4,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "rgba(249,250,251,0.1)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "transparent";
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenCanvasMenuId(null);
                            void handleTogglePrivate(canvas.id);
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "6px 10px",
                            border: "none",
                            background: "transparent",
                            color: "inherit",
                            cursor: "pointer",
                            borderRadius: 4,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "rgba(249,250,251,0.1)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "transparent";
                          }}
                        >
                          {canvas.isPrivate ? "Unlock board" : "Lock board"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenCanvasMenuId(null);
                            void handleExportBackup();
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "6px 10px",
                            border: "none",
                            background: "transparent",
                            color: "inherit",
                            cursor: "pointer",
                            borderRadius: 4,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "rgba(249,250,251,0.1)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "transparent";
                          }}
                        >
                          Export backup
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenCanvasMenuId(null);
                            void handleDeleteCanvas(canvas.id);
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "6px 10px",
                            border: "none",
                            background: "transparent",
                            color: "#fca5a5",
                            cursor: "pointer",
                            borderRadius: 4,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "rgba(248,113,113,0.18)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "transparent";
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <button
              type="button"
              onClick={openImportPicker}
              style={{
                flex: 1,
                borderRadius: 6,
                border: isDarkTheme
                  ? "1px solid rgba(148,163,184,0.5)"
                  : "1px solid rgba(17,24,39,0.2)",
                padding: "4px 6px",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Import .tldr
            </button>
            <button
              type="button"
              title={
                isDarkTheme ? "Switch to light theme" : "Switch to dark theme"
              }
              aria-label={
                isDarkTheme ? "Switch to light theme" : "Switch to dark theme"
              }
              onClick={() =>
                setUiTheme((prev) => (prev === "dark" ? "light" : "dark"))
              }
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: isDarkTheme
                  ? "1px solid rgba(148,163,184,0.5)"
                  : "1px solid rgba(17,24,39,0.2)",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                {isDarkTheme ? (
                  <path
                    d="M12 4V2M12 22v-2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4 12H2M22 12h-2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : (
                  <path
                    d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            </button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
