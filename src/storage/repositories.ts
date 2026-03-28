import type { ArtifactRecord, CanvasRecord } from "@shared/messages";
import { getDb } from "./db";

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function ensureDefaultCanvas() {
  const db = await getDb();
  const all = await db.getAll("canvases");
  if (all.length > 0) return all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return createCanvas("Research Canvas");
}

export async function createCanvas(name: string): Promise<CanvasRecord> {
  const now = Date.now();
  const canvas: CanvasRecord = {
    id: makeId("canvas"),
    name,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDb();
  await db.put("canvases", canvas);
  return canvas;
}

export async function listCanvases(): Promise<CanvasRecord[]> {
  const db = await getDb();
  const canvases = await db.getAll("canvases");
  return canvases.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteCanvas(canvasId: string): Promise<void> {
  const db = await getDb();
  const artifacts = await db.getAllFromIndex(
    "artifacts",
    "by-canvasId",
    canvasId,
  );
  for (const artifact of artifacts) {
    if (artifact.blobId) {
      await db.delete("blobs", artifact.blobId);
    }
    await db.delete("artifacts", artifact.id);
  }
  await db.delete("canvases", canvasId);
}

export async function addArtifact(
  canvasId: string,
  input: Omit<ArtifactRecord, "id" | "canvasId" | "createdAt">,
): Promise<ArtifactRecord> {
  const db = await getDb();
  const id = makeId("artifact");
  let blobId = input.blobId;
  if (input.dataUrl?.startsWith("data:video/")) {
    const blob = await (await fetch(input.dataUrl)).blob();
    blobId = makeId("blob");
    await db.put("blobs", blob, blobId);
  }
  const dataUrl = input.type === "video" ? undefined : input.dataUrl;
  const artifact: ArtifactRecord = {
    ...input,
    dataUrl,
    id,
    blobId,
    canvasId,
    createdAt: Date.now(),
  };
  await db.put("artifacts", artifact);
  const canvas = await db.get("canvases", canvasId);
  if (canvas) {
    canvas.updatedAt = Date.now();
    await db.put("canvases", canvas);
  }
  return artifact;
}

export async function deleteArtifact(
  canvasId: string,
  artifactId: string,
): Promise<boolean> {
  const db = await getDb();
  const row = await db.get("artifacts", artifactId);
  if (!row || row.canvasId !== canvasId) return false;
  if (row.blobId) {
    await db.delete("blobs", row.blobId);
  }
  await db.delete("artifacts", artifactId);
  const canvas = await db.get("canvases", canvasId);
  if (canvas) {
    canvas.updatedAt = Date.now();
    await db.put("canvases", canvas);
  }
  return true;
}

export async function listArtifacts(
  canvasId: string,
): Promise<ArtifactRecord[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("artifacts", "by-canvasId", canvasId);
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function readBlobAsDataUrl(
  blobId: string,
): Promise<string | null> {
  const db = await getDb();
  const blob = await db.get("blobs", blobId);
  if (!blob) return null;
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1)
    binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  return `data:${blob.type};base64,${base64}`;
}
