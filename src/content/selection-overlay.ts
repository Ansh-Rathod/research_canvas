export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function appendSelectionLayer(overlay: HTMLElement, box: HTMLElement): void {
  if (document.body) {
    document.body.append(overlay, box);
    return;
  }
  document.documentElement.append(overlay, box);
}

/**
 * Dim layer must stay **below** the selection rect or the border is painted underneath and
 * disappears while dragging (worse on dark / private-window pages where contrast fails).
 */
const OVERLAY_Z = "2147483646";
const SELECTION_BOX_Z = "2147483647";

export async function chooseAreaRect(): Promise<Rect> {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = OVERLAY_Z;
    overlay.style.cursor = "crosshair";
    overlay.style.background = "rgba(0,0,0,0.08)";
    overlay.style.userSelect = "none";

    const box = document.createElement("div");
    box.style.position = "fixed";
    box.style.zIndex = SELECTION_BOX_Z;
    box.style.border = "2px solid #4f46e5";
    box.style.background = "rgba(79,70,229,0.12)";
    box.style.pointerEvents = "none";
    box.style.display = "none";

    let startX = 0;
    let startY = 0;
    let active = false;

    const clean = () => {
      window.removeEventListener("mousemove", onWindowMove, true);
      window.removeEventListener("mouseup", onWindowUp, true);
      overlay.remove();
      box.remove();
      document.removeEventListener("keydown", onKeyDown);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clean();
        reject(new Error("Selection cancelled."));
      }
    };

    const updateBoxFromEvent = (event: MouseEvent) => {
      const x = Math.min(startX, event.clientX);
      const y = Math.min(startY, event.clientY);
      const width = Math.abs(startX - event.clientX);
      const height = Math.abs(startY - event.clientY);
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
    };

    const onWindowMove = (event: MouseEvent) => {
      if (!active) return;
      updateBoxFromEvent(event);
    };

    const onWindowUp = (event: MouseEvent) => {
      if (!active) return;
      active = false;
      window.removeEventListener("mousemove", onWindowMove, true);
      window.removeEventListener("mouseup", onWindowUp, true);
      const x = Math.min(startX, event.clientX);
      const y = Math.min(startY, event.clientY);
      const width = Math.abs(startX - event.clientX);
      const height = Math.abs(startY - event.clientY);
      clean();
      if (width < 10 || height < 10) {
        reject(new Error("Selected area is too small."));
        return;
      }
      resolve({ x, y, width, height });
    };

    overlay.addEventListener("mousedown", (event) => {
      event.preventDefault();
      active = true;
      startX = event.clientX;
      startY = event.clientY;
      box.style.display = "block";
      box.style.left = `${startX}px`;
      box.style.top = `${startY}px`;
      box.style.width = "0px";
      box.style.height = "0px";
      window.addEventListener("mousemove", onWindowMove, true);
      window.addEventListener("mouseup", onWindowUp, true);
    });

    document.addEventListener("keydown", onKeyDown);
    appendSelectionLayer(overlay, box);
  });
}
