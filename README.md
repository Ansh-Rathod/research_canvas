# Research Canvas

A Chromium extension that adds a **side-panel research canvas** powered by [tldraw](https://tldraw.com), with captures from the current tab (images, video clips, URL cards, selected text, regions). Captured image/video bytes can be saved to a local file server and referenced by URL in the board.

**Requirements:** Chromium-based browser with **Manifest V3** and **Side Panel** support (e.g. Chrome **114+**).

## Development

### 1. Install dependencies

```bash
npm install
```

### 2. Build the extension

Production build (outputs to `dist/`):

```bash
npm run build
```

This runs Vite and copies `manifest.json` into `dist/`.

### 3. Watch mode (optional)

Rebuild automatically when you change source files:

```bash
npm run dev
```

Leave this running while you develop. After each rebuild, **reload the extension** in the browser (see below).

### 4. Start the local media server (required for image/video uploads)

```bash
npm run local-media-server
```

This starts an Express server at `http://127.0.0.1:43123`, writes uploads to:

- `local-media/images`
- `local-media/videos`

Keep this process running while capturing images/videos from the toolbar/context menu so the board stores media URLs instead of base64 payloads.

### 5. Typecheck

```bash
npm run check
```

## Install in the browser (load unpacked)

1. Build at least once so `dist/` exists (`npm run build`).
2. Open **`chrome://extensions`** (or **Edge:** `edge://extensions`).
3. Turn on **Developer mode** (toggle in the toolbar).
4. Click **Load unpacked**.
5. Select the **`dist`** folder inside this project  
   (e.g. `/path/to/research/dist`), **not** the repo root.

The extension should appear as **Research Canvas**. Pin it to the toolbar if you want quick access.

### After code changes

Run **`npm run build`** again (or use **`npm run dev`** and wait for a rebuild), then on `chrome://extensions` click **Reload** on the Research Canvas card.

## Using the extension

- Click the **extension icon** to open or focus the **side panel** (Research Canvas).
- Use the **floating toolbar** on web pages for captures, or the **context menu** / **keyboard shortcuts** defined in `manifest.json` under `commands` (set shortcuts under **chrome://extensions/shortcuts**).
- Right-click the page → **Show Research Canvas floating toolbar** if you hid the floating bar.
- Open the board sidebar and use the **Uploads** button to view the upload process dialog (queued/uploading/success/error and retry failures).

## Project layout (short)

| Path | Role |
|------|------|
| `src/sidepanel/` | React + tldraw UI (side panel) |
| `src/background/service-worker.ts` | MV3 service worker: captures, storage, side panel |
| `src/content/` | Content scripts + floating toolbar |
| `src/storage/` | IndexedDB helpers |
| `dist/` | **Load this folder** as the unpacked extension |

## License

Private project (`"private": true` in `package.json`). Add a license file if you intend to publish.
