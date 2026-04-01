import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const MEDIA_ROOT = path.join(ROOT_DIR, "local-media");
const IMAGES_DIR = path.join(MEDIA_ROOT, "images");
const VIDEOS_DIR = path.join(MEDIA_ROOT, "videos");
const PORT = Number(process.env.LOCAL_MEDIA_SERVER_PORT || 43123);
const HOST = "127.0.0.1";

await fs.mkdir(IMAGES_DIR, { recursive: true });
await fs.mkdir(VIDEOS_DIR, { recursive: true });

const app = express();
app.use(cors());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 300 * 1024 * 1024,
  },
});

function timestampedFileName(ext) {
  const safeExt = ext.startsWith(".") ? ext : `.${ext || "bin"}`;
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`;
}

function extFromMime(mimeType, kind) {
  if (!mimeType) return kind === "image" ? ".png" : ".webm";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg")) return ".jpg";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("webm")) return ".webm";
  return kind === "image" ? ".png" : ".webm";
}

function parseMaybeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function uploadHandler(kind) {
  return async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Missing file in multipart field 'file'." });
        return;
      }
      const ext = extFromMime(file.mimetype, kind);
      const fileName = timestampedFileName(ext);
      const dir = kind === "image" ? IMAGES_DIR : VIDEOS_DIR;
      const absolutePath = path.join(dir, fileName);
      await fs.writeFile(absolutePath, file.buffer);

      const width = parseMaybeNumber(req.body?.width);
      const height = parseMaybeNumber(req.body?.height);
      const mimeType = file.mimetype || (kind === "image" ? "image/png" : "video/webm");
      const mediaFolder = kind === "image" ? "images" : "videos";
      const url = `http://${HOST}:${PORT}/media/${mediaFolder}/${fileName}`;

      res.json({
        ok: true,
        kind,
        fileName,
        absolutePath,
        size: file.size,
        mimeType,
        url,
        width,
        height,
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Upload failed.",
      });
    }
  };
}

app.post("/upload/image", upload.single("file"), uploadHandler("image"));
app.post("/upload/video", upload.single("file"), uploadHandler("video"));
app.use("/media", express.static(MEDIA_ROOT));

app.get("/health", (_req, res) => {
  res.json({ ok: true, host: HOST, port: PORT });
});

app.listen(PORT, HOST, () => {
  console.log(`Local media server running at http://${HOST}:${PORT}`);
});
