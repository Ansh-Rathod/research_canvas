import {
  HTMLContainer,
  TLVideoShape,
  useEditor,
  useEditorComponents,
  useIsEditing,
} from "@tldraw/editor";
import classNames from "classnames";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactEventHandler,
} from "react";
import { VideoShapeUtil } from "tldraw";
import { useImageOrVideoAsset, usePrefersReducedMotion } from "tldraw";

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

/**
 * Fork of tldraw's video shape: no top-right hyperlink button; centered play overlay when paused
 * so recordings read clearly as video. Hyperlink removed — use shape meta + toolbar on image only.
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
  const prefersReducedMotion = usePrefersReducedMotion();
  const { Spinner } = useEditorComponents();

  const { asset, url } = useImageOrVideoAsset({
    shapeId: shape.id,
    assetId: shape.props.assetId,
    width: shape.props.w,
  });

  const rVideo = useRef<HTMLVideoElement>(null!);

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

  useEffect(() => {
    const video = rVideo.current;
    if (!video) return;

    if (isEditing) {
      if (document.activeElement !== video) {
        video.focus();
      }
    }
  }, [isEditing, isLoaded]);

  const editingWithControls = isEditing && showControls;
  const showCenterPlay =
    isLoaded &&
    url &&
    showPlayOverlay &&
    !editingWithControls &&
    !isFullscreen;

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
                style={
                  isEditing
                    ? { pointerEvents: "all" }
                    : !isLoaded
                      ? { display: "none" }
                      : undefined
                }
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
                autoPlay={shape.props.autoplay && !prefersReducedMotion}
                muted
                loop
                disableRemotePlayback
                disablePictureInPicture
                controls={editingWithControls}
                onLoadedData={handleLoadedData}
                hidden={!isLoaded}
                aria-label={shape.props.altText}
              >
                <source src={url} />
              </video>
              {!isLoaded && Spinner && <Spinner />}
              {showCenterPlay ? (
                <button
                  type="button"
                  className="research-video-play-overlay"
                  aria-label="Play video"
                  onPointerDown={(e) => {
                    stopEventPropagationSafe(e);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void rVideo.current?.play();
                  }}
                >
                  <svg
                    className="research-video-play-icon"
                    viewBox="0 0 24 24"
                    fill="white"
                    aria-hidden
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </HTMLContainer>
  );
});

function stopEventPropagationSafe(e: React.PointerEvent) {
  try {
    e.stopPropagation();
  } catch {
    /* ignore */
  }
}

export class ResearchVideoShapeUtil extends VideoShapeUtil {
  override component(shape: TLVideoShape) {
    return <ResearchVideoShape shape={shape} />;
  }
}
