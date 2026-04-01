# Research Canvas

A Chromium extension that adds a **side-panel research canvas** powered by [tldraw](https://tldraw.com), with captures from the current tab (images, video clips, URL cards, selected text, regions). Captured image/video bytes can be saved to a local file server and referenced by URL in the board.

**Requirements:** Chromium-based browser with **Manifest V3** and **Side Panel** support (e.g. Chrome **114+**).

## Local media server

The repo includes a small **Express** app (`local-server/server.mjs`) that receives image and video uploads from the extension and serves those files back over HTTP.

### Why it is needed

- **Smaller, faster canvas data:** If every capture were embedded in the tldraw document as base64 or huge data URLs, IndexedDB snapshots and exports would grow quickly and become slow to load and share. Uploading to disk and storing only **URLs** on the board keeps documents light.
- **Plain files you own:** Media lands under `local-media/images` and `local-media/videos` as normal files—easy to back up, open in other apps, or delete without editing JSON.
- **Fits the extension model:** The side panel talks to your machine over **HTTP** to `127.0.0.1`. The server is **localhost-only** (not exposed on your LAN) and uses **CORS** so browser security rules allow the upload requests from the extension.

You can still use the extension without this process running, but **image/video capture flows that save to the local server** expect it to be up; otherwise those uploads fail until you start the server (or retry from the Uploads UI).

### Features

| Feature | What it does | How you use it |
|--------|----------------|----------------|
| **Upload image** | `POST /upload/image` accepts one multipart file in the field `file`, picks an extension from the MIME type (e.g. PNG, JPEG, WebP), writes under `local-media/images`, returns JSON with a public `url`. | Run `npm run local-media-server`, then capture images from the toolbar/context menu as usual; the extension POSTs for you. |
| **Upload video** | Same as image, but `POST /upload/video` and `local-media/videos` (e.g. WebM). Optional `width` / `height` form fields are echoed back as metadata when present. | Same workflow for video clips. |
| **Serve media** | `GET` requests under `/media/...` map to files inside `local-media` (static files). Returned upload URLs look like `http://127.0.0.1:<port>/media/images/<file>` or `.../videos/<file>`. | The canvas loads these URLs as image/video shapes; you can also open the URL in a browser tab while the server runs. |
| **Health check** | `GET /health` returns JSON `{ ok, host, port }`. | Quick check that the server is listening: e.g. open `http://127.0.0.1:43123/health` or use `curl`. |
| **Safety limits** | One file per request, up to **300 MB**, in-memory buffer then written to disk. | Large captures stay within this cap; if you need bigger files, adjust `local-server/server.mjs`. |

**Configuration:** Default bind is **`127.0.0.1`** and default port is **`43123`**. You can set **`LOCAL_MEDIA_SERVER_PORT`** when starting the server to use another port. The built-in extension code expects **`http://127.0.0.1:43123`** unless you change `src/shared/localMediaUpload.ts` (and the matching constant in `src/tldraw/App.tsx`) or set the global `__RESEARCH_CANVAS_LOCAL_MEDIA_SERVER__` to match your port.

### How to run it

1. Install dependencies once: `npm install` (from the repo root).
2. Start the server: `npm run local-media-server`.
3. Leave that terminal open while you capture media that uploads to disk.
4. Confirm it is up: visit `http://127.0.0.1:43123/health` (or your chosen port).

Uploaded files appear under **`local-media/images`** and **`local-media/videos`** with names like `<timestamp>-<random>.<ext>`.

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

See **[Local media server](#local-media-server)** for why this exists, what each endpoint does, and how it fits capture workflows.

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
| `local-server/` | Local media upload + static file server (`npm run local-media-server`) |
| `local-media/` | On-disk images/videos written by that server (gitignored) |
| `src/sidepanel/` | React + tldraw UI (side panel) |
| `src/background/service-worker.ts` | MV3 service worker: captures, storage, side panel |
| `src/content/` | Content scripts + floating toolbar |
| `src/storage/` | IndexedDB helpers |
| `dist/` | **Load this folder** as the unpacked extension |

## License

Private project (`"private": true` in `package.json`). Add a license file if you intend to publish.
