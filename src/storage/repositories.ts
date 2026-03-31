import type { ArtifactRecord } from "@shared/messages";
import { MAIN_DOCUMENT_ID } from "@shared/document";
import { getDb } from "./db";

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function addArtifact(
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
    canvasId: MAIN_DOCUMENT_ID,
    createdAt: Date.now(),
  };
  await db.put("artifacts", artifact);
  return artifact;
}

export async function setArtifactCanvasPosition(
  artifactId: string,
  canvasX: number,
  canvasY: number,
): Promise<boolean> {
  if (!Number.isFinite(canvasX) || !Number.isFinite(canvasY)) return false;
  const db = await getDb();
  const row = await db.get("artifacts", artifactId);
  if (!row || row.canvasId !== MAIN_DOCUMENT_ID) return false;
  if (row.canvasX === canvasX && row.canvasY === canvasY) return true;
  await db.put("artifacts", { ...row, canvasX, canvasY });
  return true;
}

export async function deleteArtifact(artifactId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.get("artifacts", artifactId);
  if (!row || row.canvasId !== MAIN_DOCUMENT_ID) return false;
  if (row.blobId) {
    await db.delete("blobs", row.blobId);
  }
  await db.delete("artifacts", artifactId);
  return true;
}

export async function getArtifact(
  artifactId: string,
): Promise<ArtifactRecord | null> {
  const db = await getDb();
  const row = await db.get("artifacts", artifactId);
  if (!row || row.canvasId !== MAIN_DOCUMENT_ID) return null;
  return row;
}

export async function listArtifacts(): Promise<ArtifactRecord[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex(
    "artifacts",
    "by-canvasId",
    MAIN_DOCUMENT_ID,
  );
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function readBlob(blobId: string): Promise<Blob | null> {
  const db = await getDb();
  const blob = await db.get("blobs", blobId);
  return blob ?? null;
}

export async function readBlobAsDataUrl(
  blobId: string,
): Promise<string | null> {
  const blob = await readBlob(blobId);
  if (!blob) return null;
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1)
    binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  return `data:${blob.type};base64,${base64}`;
}

export async function setArtifactLocalVideoPath(
  artifactId: string,
  localVideoAbsolutePath: string,
): Promise<boolean> {
  const db = await getDb();
  const row = await db.get("artifacts", artifactId);
  if (!row || row.canvasId !== MAIN_DOCUMENT_ID || row.type !== "video") {
    return false;
  }
  await db.put("artifacts", { ...row, localVideoAbsolutePath });
  return true;
}

/**
 * Replace the video blob in place and mark reload so the canvas can refresh the asset.
 */
export async function replaceVideoBlobFromDisk(
  artifactId: string,
  blob: Blob,
): Promise<boolean> {
  const db = await getDb();
  const row = await db.get("artifacts", artifactId);
  if (!row || row.canvasId !== MAIN_DOCUMENT_ID || row.type !== "video") {
    return false;
  }
  if (!row.blobId) return false;
  await db.put("blobs", blob, row.blobId);
  await db.put("artifacts", {
    ...row,
    videoReloadedAt: Date.now(),
  });
  return true;
}

export async function replaceArtifactsForCanvas(
  artifacts: ArtifactRecord[],
): Promise<void> {
  const db = await getDb();
  const existing = await db.getAllFromIndex(
    "artifacts",
    "by-canvasId",
    MAIN_DOCUMENT_ID,
  );
  for (const row of existing) {
    if (row.blobId) {
      await db.delete("blobs", row.blobId);
    }
    await db.delete("artifacts", row.id);
  }
  for (const artifact of artifacts) {
    let next = { ...artifact };
    if (artifact.dataUrl?.startsWith("data:video/")) {
      const blob = await (await fetch(artifact.dataUrl)).blob();
      const blobId = `blob_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      await db.put("blobs", blob, blobId);
      next = { ...artifact, blobId, dataUrl: undefined };
    }
    await db.put("artifacts", next);
  }
}

