import type { RuntimeMessage } from "@shared/messages";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isNormalWebUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function hasFullscreenCanvasTabOpen(): Promise<boolean> {
  const allTabs = await chrome.tabs.query({});
  const fullUrl = chrome.runtime.getURL("src/tldraw/index.html?fullscreen=1");
  return allTabs.some((t) => t.url === fullUrl);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

async function render() {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = "";

  const root = el("div");
  Object.assign(root.style, {
    width: "280px",
    padding: "10px",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    color: "#111827",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  });

  const title = el("div", "Research Canvas");
  Object.assign(title.style, { fontWeight: "600", fontSize: "14px" });
  root.append(title);

  const tab = await getActiveTab();
  const tabId = tab?.id;
  const tabUrl = tab?.url;
  const isWebTab = isNormalWebUrl(tabUrl);
  const fullScreenOpen = await hasFullscreenCanvasTabOpen();

  if (!fullScreenOpen) {
    const openBoardBtn = el("button", "Open board sidebar");
    Object.assign(openBoardBtn.style, {
      padding: "8px 10px",
      borderRadius: "8px",
      border: "1px solid rgba(17,24,39,0.2)",
      background: "white",
      cursor: "pointer",
      textAlign: "left",
    });
    openBoardBtn.onclick = () => {
      if (!tabId) return;
      void chrome.runtime.sendMessage({
        type: "OPEN_BOARD_SIDEBAR",
        tabId,
      } as RuntimeMessage);
      window.close();
    };
    root.append(openBoardBtn);
  }

  if (isWebTab) {
    const row = el("label");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "10px",
      padding: "6px 0",
    });
    const hostname = new URL(tabUrl!).hostname;
    const rowText = el("span");
    const setRowText = (visible: boolean) => {
      rowText.textContent = `${visible ? "Hide" : "Show"} floating capture toolbar\non ${hostname}`;
    };
    Object.assign(rowText.style, {
      whiteSpace: "pre-line",
      lineHeight: "1.3",
    });
    row.append(rowText);

    const toggle = el("input") as HTMLInputElement;
    toggle.type = "checkbox";
    toggle.disabled = !tabId;
    row.append(toggle);
    root.append(row);

    if (tabId) {
      const current = (await chrome.runtime.sendMessage({
        type: "GET_FLOATING_TOOLBAR_FOR_TAB",
        tabId,
      } as RuntimeMessage)) as { ok?: boolean; visible?: boolean };
      toggle.checked = !!current?.ok && !!current?.visible;
      setRowText(toggle.checked);
    } else {
      setRowText(false);
    }

    toggle.onchange = () => {
      if (!tabId) return;
      setRowText(toggle.checked);
      void chrome.runtime.sendMessage({
        type: "SET_FLOATING_TOOLBAR_FOR_TAB",
        tabId,
        visible: toggle.checked,
      } as RuntimeMessage);
    };
  }

  app.append(root);
}

void render();
