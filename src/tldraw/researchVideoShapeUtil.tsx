import {
  HTMLContainer,
  TLVideoShape,
  useEditor,
  useEditorComponents,
  useIsEditing,
  useValue,
} from "@tldraw/editor";
import classNames from "classnames";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactEventHandler,
} from "react";
import { VideoShapeUtil } from "tldraw";
import { useImageOrVideoAsset } from "tldraw";

function BrokenAssetIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 30 30"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3,11 L3,3 11,3" strokeWidth="2" />
      <path d="M19,27 L27,27 L27,19" strokeWidth="2" />
      <path d="M27,3 L3,27" strokeWidth="2" />
    </svg>
  );
}

/** Touch double-tap: max ms between taps and max px movement (same as typical OS double-tap). */
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_MAX_DIST_PX = 32;

/**
 * Fork of tldraw's video shape: no top-right hyperlink button; centered play overlay when paused
 * so recordings read clearly as video. Hyperlink removed — use shape meta + toolbar on image only.
 *
 * Playback: only starts/toggles via double-click / double-tap on the video while the shape is
 * selected; deselecting pauses. Native controls apply only in edit mode when zoomed in enough.
 */
const ResearchVideoShape = memo(function ResearchVideoShape({
  shape,
}: {
  shape: TLVideoShape;
}) {
  const editor = useEditor();
  const showControls =
    editor.getShapeGeometry(shape).bounds.w * editor.getZoomLevel() >= 110;
  const isEditing = useIsEditing(shape.id);
  const editingWithControls = isEditing && showControls;
  const { Spinner } = useEditorComponents();

  const isSelected = useValue(
    "researchVideoShapeSelected",
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id],
  );

  const { asset, url } = useImageOrVideoAsset({
    shapeId: shape.id,
    assetId: shape.props.assetId,
    width: shape.props.w,
  });

  const rVideo = useRef<HTMLVideoElement>(null!);
  const rLastTouchTap = useRef<{ t: number; x: number; y: number } | null>(
    null,
  );

  const [isLoaded, setIsLoaded] = useState(false);
  const [showPlayOverlay, setShowPlayOverlay] = useState(false);

  const handleLoadedData = useCallback<ReactEventHandler<HTMLVideoElement>>(
    (e) => {
      const video = e.currentTarget;
      if (!video) return;
      setIsLoaded(true);
    },
    [],
  );

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const fullscreenChange = () =>
      setIsFullscreen(document.fullscreenElement === rVideo.current);
    document.addEventListener("fullscreenchange", fullscreenChange);

    return () => document.removeEventListener("fullscreenchange", fullscreenChange);
  });

  useEffect(() => {
    const video = rVideo.current;
    if (!video) return;
    const sync = () => setShowPlayOverlay(video.paused);
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("loadeddata", sync);
    sync();
    return () => {
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
      video.removeEventListener("loadeddata", sync);
    };
  }, [url, isLoaded]);

  const togglePlaybackFromGesture = useCallback(() => {
    const video = rVideo.current;
    if (!video || !isSelected || editingWithControls) return;
    if (video.paused) void video.play();
    else video.pause();
  }, [editingWithControls, isSelected]);

  useEffect(() => {
    const video = rVideo.current;
    if (!video) return;
    if (!isSelected) {
      video.pause();
    }
  }, [isSelected]);

  useEffect(() => {
    const video = rVideo.current;
    if (!video) return;

    if (isEditing) {
      if (document.activeElement !== video) {
        video.focus();
      }
    }
  }, [isEditing, isLoaded]);

  const showCenterPlay =
    isLoaded &&
    url &&
    showPlayOverlay &&
    !editingWithControls &&
    !isFullscreen;

  let videoStyle: CSSProperties | undefined;
  if (!isLoaded) {
    videoStyle = { display: "none" };
  } else if (isSelected || isEditing) {
    videoStyle = {
      pointerEvents: "all",
      ...(isSelected ? { touchAction: "manipulation" } : {}),
    };
  }

  const handleVideoPointerUp = useCallback(
    (e: React.PointerEvent<HTMLVideoElement>) => {
      if (editingWithControls) return;
      if (!isSelected) return;
      if (e.pointerType === "mouse") return;
      const now = Date.now();
      const { clientX: x, clientY: y } = e;
      const prev = rLastTouchTap.current;
      if (
        prev &&
        now - prev.t < DOUBLE_TAP_MS &&
        Math.hypot(x - prev.x, y - prev.y) < DOUBLE_TAP_MAX_DIST_PX
      ) {
        rLastTouchTap.current = null;
        e.preventDefault();
        e.stopPropagation();
        togglePlaybackFromGesture();
        return;
      }
      rLastTouchTap.current = { t: now, x, y };
    },
    [editingWithControls, isSelected, togglePlaybackFromGesture],
  );

  return (
    <HTMLContainer
      id={shape.id}
      style={{
        color: "var(--color-text-3)",
        backgroundColor: asset ? "transparent" : "var(--color-low)",
        border: asset ? "none" : "1px solid var(--color-low-border)",
      }}
    >
      <div className="tl-counter-scaled">
        <div
          className="tl-video-container research-video-container"
          style={{ position: "relative" }}
        >
          {!asset ? (
            <BrokenAssetIcon />
          ) : Spinner && !asset.props.src ? (
            <Spinner />
          ) : url ? (
            <>
              <video
                key={url}
                ref={rVideo}
                style={videoStyle}
                className={classNames(
                  "tl-video",
                  `tl-video-shape-${shape.id.split(":")[1]}`,
                  {
                    "tl-video-is-fullscreen": isFullscreen,
                  },
                )}
                width="100%"
                height="100%"
                draggable={false}
                playsInline
                autoPlay={false}
                muted
                loop
                disableRemotePlayback
                disablePictureInPicture
                controls={editingWithControls}
                onLoadedData={handleLoadedData}
                hidden={!isLoaded}
                aria-label={shape.props.altText}
                onPointerUp={handleVideoPointerUp}
                onDoubleClick={(e) => {
                  if (editingWithControls) return;
                  e.stopPropagation();
                  togglePlaybackFromGesture();
                }}
              >
                <source src={url} />
              </video>
              {!isLoaded && Spinner && <Spinner />}
              {showCenterPlay ? (
                <div
                  className="research-video-play-overlay"
                  aria-hidden
                  role="presentation"
                >
                  <svg
                    className="research-video-play-icon"
                    viewBox="0 0 24 24"
                    fill="white"
                    aria-hidden
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </HTMLContainer>
  );
});

export class ResearchVideoShapeUtil extends VideoShapeUtil {
  override component(shape: TLVideoShape) {
    return <ResearchVideoShape shape={shape} />;
  }
}
