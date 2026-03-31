export type CaptureAction =
  | "capture-selected-text-heading"
  | "capture-selected-text-body"
  | "capture-selected-text-note"
  | "capture-selected-text-quote"
  | "capture-area-image"
  | "capture-element-region"
  | "record-area-video"
  | "record-element-region"
  | "capture-media-element"
  | "capture-url-card";

/** How captured page text is presented on the canvas (stored on text artifacts). */
export type TextPresentation = "heading" | "body" | "note" | "quote";

/** tldraw default color token for quote geo fill; persisted on artifacts for reload. */
export type QuoteColorToken = string;

export type ArtifactType = "text" | "image" | "video" | "link";

export interface ArtifactRecord {
  id: string;
  canvasId: string;
  type: ArtifactType;
  sourceUrl: string;
  /** Tab URL when capture resolved a more specific link (e.g. feed vs post). */
  capturedFromUrl?: string;
  /** e.g. Instagram profile URL when `sourceUrl` is the post. */
  profileUrl?: string;
  title: string;
  createdAt: number;
  dataUrl?: string;
  blobId?: string;
  text?: string;
  width?: number;
  height?: number;
  description?: string;
  /** Set for captured text: how to render (legacy captures omit → treated as body in UI). */
  textPresentation?: TextPresentation;
  /** Quote variant: persisted tldraw palette token for geo fill. */
  quoteColor?: QuoteColorToken;
  /**
   * Page-space position on the canvas when the artifact shape was first placed (or last saved).
   * Used so sync does not re-derive placement from a changing viewport (tab switch, deferred media).
   */
  canvasX?: number;
  canvasY?: number;
  /**
   * Absolute filesystem path to the mirrored recording file under Downloads (set after capture).
   * Used to open the same file in Pimosa and reload after in-place edits.
   */
  localVideoAbsolutePath?: string;
  /** Bumped when video bytes are re-imported from disk so the canvas asset can refresh. */
  videoReloadedAt?: number;
}

export interface PendingCaptureRequest {
  id: string;
  tabId: number;
  action: CaptureAction;
  sourceUrl: string;
  mediaType?: "image" | "video";
  mediaUrl?: string;
  canvasId?: string;
}

export type RuntimeMessage =
  /**
   * Content script → SW: open the Research Canvas side panel for this tab (call from a user
   * gesture, e.g. before starting toolbar recording) so the canvas is visible while work runs.
   */
  | { type: "ENSURE_SIDE_PANEL_OPEN" }
  /** Page toolbar: open/close the extension’s Chrome side panel (like the toolbar icon). */
  | { type: "TOGGLE_CHROME_SIDE_PANEL" }
  /**
   * Side panel → service worker: panel JS is alive (sync timestamp, no `await` before
   * `sidePanel.open()` in toggle — storage alone would require `await` and break the gesture).
   */
  | { type: "SIDE_PANEL_HEARTBEAT" }
  /** Side panel became hidden — clear SW “live” state so the toolbar toggle can open again. */
  | { type: "SIDE_PANEL_HIDDEN" }
  /** Service worker → side panel document to dismiss the panel. */
  | { type: "CLOSE_SIDE_PANEL" }
  | { type: "DELETE_ARTIFACT"; artifactId: string }
  /** Side panel → SW: persist page coordinates for stable artifact→shape placement across reloads. */
  | {
      type: "SET_ARTIFACT_CANVAS_POSITION";
      artifactId: string;
      canvasId: string;
      canvasX: number;
      canvasY: number;
    }
  | { type: "LIST_ARTIFACTS"; canvasId: string }
  | {
      type: "APPLY_CANVAS_BACKUP";
      backup: {
        version: 1;
        mainDocumentId: string;
        createdAt: number;
        isPrivate?: boolean;
        tldrawSnapshot: unknown;
        artifacts: ArtifactRecord[];
        deletedArtifactIds: string[];
      };
    }
  | { type: "TRIGGER_CAPTURE"; action: CaptureAction }
  /** Recording finished in the page using `getDisplayMedia` (toolbar); background adds titles/URLs. */
  | {
      type: "FINALIZE_PAGE_RECORDING";
      action: "record-area-video" | "record-element-region";
      dataUrl: string;
      width: number;
      height: number;
      linkUrl?: string;
      profileUrl?: string;
    }
  | { type: "REQUEST_AREA_RECT" }
  | { type: "REQUEST_ELEMENT_PICK" }
  | { type: "REQUEST_CAPTURE_VISIBLE_TAB" }
  | { type: "REQUEST_SELECTED_TEXT" }
  | { type: "REQUEST_AREA_RECORDING"; streamId: string }
  | { type: "REQUEST_ELEMENT_RECORDING"; streamId: string }
  | { type: "CAPTURE_RESULT"; requestId: string; artifact: Omit<ArtifactRecord, "id" | "canvasId" | "createdAt"> }
  | { type: "CAPTURE_ERROR"; requestId: string; message: string }
  | { type: "OPEN_CANVAS"; artifactId?: string }
  | { type: "OPEN_CANVAS_TAB" }
  | { type: "OPEN_BOARD_SIDEBAR"; tabId: number }
  | { type: "SET_FLOATING_TOOLBAR_VISIBILITY"; visible: boolean }
  | { type: "SET_FLOATING_TOOLBAR_FOR_TAB"; tabId: number; visible: boolean }
  | { type: "GET_FLOATING_TOOLBAR_FOR_TAB"; tabId: number }
  /**
   * Full-screen canvas tab became active (tab switch or focus) — background should close any live
   * side panel instance so the floating toolbar toggle semantics stay consistent.
   */
  | { type: "FULLSCREEN_CANVAS_ACTIVE" };

export const CONTEXT_MENU_IDS: Record<CaptureAction, string> = {
  "capture-selected-text-heading":
    "research-canvas/capture-selected-text-heading",
  "capture-selected-text-body": "research-canvas/capture-selected-text-body",
  "capture-selected-text-note": "research-canvas/capture-selected-text-note",
  "capture-selected-text-quote": "research-canvas/capture-selected-text-quote",
  "capture-area-image": "research-canvas/capture-area-image",
  "capture-element-region": "research-canvas/capture-element-region",
  "record-area-video": "research-canvas/record-area-video",
  "record-element-region": "research-canvas/record-element-region",
  "capture-media-element": "research-canvas/capture-media-element",
  "capture-url-card": "research-canvas/capture-url-card",
};

export function textPresentationFromCaptureAction(
  action: CaptureAction,
): TextPresentation | null {
  switch (action) {
    case "capture-selected-text-heading":
      return "heading";
    case "capture-selected-text-body":
      return "body";
    case "capture-selected-text-note":
      return "note";
    case "capture-selected-text-quote":
      return "quote";
    default:
      return null;
  }
}

export function isSelectedTextCaptureAction(action: CaptureAction): boolean {
  return textPresentationFromCaptureAction(action) !== null;
}
