import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const distDir = resolve(process.cwd(), "dist");
await mkdir(distDir, { recursive: true });
await copyFile(resolve(process.cwd(), "manifest.json"), resolve(distDir, "manifest.json"));
