export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function chooseAreaRect(): Promise<Rect> {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483647";
    overlay.style.cursor = "crosshair";
    overlay.style.background = "rgba(0,0,0,0.08)";
    overlay.style.userSelect = "none";

    const box = document.createElement("div");
    box.style.position = "fixed";
    box.style.border = "2px solid #4f46e5";
    box.style.background = "rgba(79,70,229,0.12)";
    box.style.pointerEvents = "none";
    box.style.display = "none";

    let startX = 0;
    let startY = 0;
    let active = false;

    const clean = () => {
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

    overlay.addEventListener("mousedown", (event) => {
      active = true;
      startX = event.clientX;
      startY = event.clientY;
      box.style.display = "block";
      box.style.left = `${startX}px`;
      box.style.top = `${startY}px`;
      box.style.width = "0px";
      box.style.height = "0px";
    });

    overlay.addEventListener("mousemove", (event) => {
      if (!active) return;
      const x = Math.min(startX, event.clientX);
      const y = Math.min(startY, event.clientY);
      const width = Math.abs(startX - event.clientX);
      const height = Math.abs(startY - event.clientY);
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
    });

    overlay.addEventListener("mouseup", (event) => {
      if (!active) return;
      active = false;
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
    });

    document.addEventListener("keydown", onKeyDown);
    document.body.append(overlay, box);
  });
}
