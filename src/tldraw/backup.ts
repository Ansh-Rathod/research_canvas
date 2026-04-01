import { MAIN_DOCUMENT_ID } from "@shared/document";
import type { ArtifactRecord, RuntimeMessage } from "@shared/messages";
import type { Editor } from "@tldraw/editor";
import { getSnapshot, loadSnapshot } from "@tldraw/editor";
import { parseTldrawJsonFile } from "@tldraw/tldraw";

export type CanvasBackupVersion = 1;

export type CanvasBackupV1 = {
  version: CanvasBackupVersion;
  mainDocumentId: string;
  createdAt: number;
  /** Canvas privacy state at export time (optional for backward compatibility). */
  isPrivate?: boolean;
  /** Full tldraw editor snapshot (document + session) for this canvas. */
  tldrawSnapshot: unknown;
  /** Artifacts for this canvas with any blob-backed media resolved to data URLs. */
  artifacts: ArtifactRecord[];
  /** Deleted artifact ids for this canvas, used to preserve tombstones. */
  deletedArtifactIds: string[];
};

export type CanvasBackup = CanvasBackupV1;

type TldrawLikeSnapshot = {
  document?: {
    store?: Record<string, any>;
  };
  session?: unknown;
};

type StoreSnapshotLike = {
  store: Record<string, any>;
  schema?: unknown;
};

export function isCanvasBackup(input: unknown): input is CanvasBackup {
  if (!input || typeof input !== "object") return false;
  const obj = input as Partial<CanvasBackupV1>;
  if (obj.version !== 1) return false;
  if (typeof obj.mainDocumentId !== "string") return false;
  if (typeof obj.createdAt !== "number") return false;
  if (obj.isPrivate != null && typeof obj.isPrivate !== "boolean") return false;
  if (!Array.isArray(obj.artifacts)) return false;
  if (!Array.isArray(obj.deletedArtifactIds)) return false;
  if (!toStoreSnapshotLike(obj.tldrawSnapshot)) return false;
  return true;
}

export function isTldrawSnapshot(input: unknown): input is TldrawLikeSnapshot {
  if (!input || typeof input !== "object") return false;
  const snapshot = input as TldrawLikeSnapshot;
  return (
    (!!snapshot.document && typeof snapshot.document === "object") ||
    !!(input as any).store
  );
}

function toStoreSnapshotLike(input: unknown): StoreSnapshotLike | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as any;
  if (raw.store && typeof raw.store === "object") {
    return { store: raw.store, schema: raw.schema };
  }
  if (raw.document?.store && typeof raw.document.store === "object") {
    return { store: raw.document.store, schema: raw.document.schema };
  }
  return null;
}

function getPageNamesFromSnapshot(snapshot: TldrawLikeSnapshot): Set<string> {
  const names = new Set<string>();
  const records = snapshot.document?.store ?? {};
  for (const value of Object.values(records)) {
    if (
      value &&
      typeof value === "object" &&
      (value as any).typeName === "page"
    ) {
      names.add(String((value as any).name ?? ""));
    }
  }
  return names;
}

function filterImportableStore(store: Record<string, any>): Record<string, any> {
  const next: Record<string, any> = {};
  for (const [id, record] of Object.entries(store)) {
    if (!record || typeof record !== "object") continue;
    const typeName = String((record as any).typeName ?? "");
    // Keep all record types except the root document record so camera,
    // instance-page state, and similar metadata survive round-trip import.
    if (!typeName || typeName === "document") continue;
    next[id] = record;
  }
  return next;
}

function getStoreTypeCounts(store: Record<string, any>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of Object.values(store)) {
    if (!record || typeof record !== "object") continue;
    const typeName = String((record as any).typeName ?? "unknown");
    counts[typeName] = (counts[typeName] ?? 0) + 1;
  }
  return counts;
}

function makeUniqueId(base: string, used: Set<string>): string {
  const cleaned = base.replace(/[^a-zA-Z0-9:_-]/g, "_");
  let candidate = `${cleaned}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  while (used.has(candidate)) {
    candidate = `${cleaned}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
  }
  used.add(candidate);
  return candidate;
}

function deepRemapIds(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === "string") {
    return idMap.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepRemapIds(v, idMap));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      next[k] = deepRemapIds(v, idMap);
    }
    return next;
  }
  return value;
}

function remapIncomingStoreIds(
  currentStore: Record<string, any>,
  incomingStore: Record<string, any>,
): Record<string, any> {
  const usedIds = new Set<string>(Object.keys(currentStore));
  const idMap = new Map<string, string>();
  const filtered = filterImportableStore(incomingStore);

  for (const oldId of Object.keys(filtered)) {
    if (usedIds.has(oldId)) {
      idMap.set(oldId, makeUniqueId(oldId, usedIds));
    } else {
      usedIds.add(oldId);
      idMap.set(oldId, oldId);
    }
  }

  const remapped: Record<string, any> = {};
  for (const [oldId, record] of Object.entries(filtered)) {
    const newId = idMap.get(oldId) ?? oldId;
    const rewritten = deepRemapIds(record, idMap) as Record<string, unknown>;
    remapped[newId] = { ...rewritten, id: newId };
  }
  return remapped;
}

function addPagesWithUniqueNames(
  current: StoreSnapshotLike,
  incoming: StoreSnapshotLike,
): StoreSnapshotLike {
  const currentStore = current.store ?? {};
  const incomingStore = remapIncomingStoreIds(currentStore, incoming.store ?? {});
  const mergedStore: Record<string, any> = { ...currentStore };
  const existingPageNames = getPageNamesFromSnapshot({
    document: { store: currentStore },
  });

  for (const [recordId, record] of Object.entries(incomingStore)) {
    if (!record || typeof record !== "object") continue;
    if ((record as any).typeName !== "page") {
      mergedStore[recordId] = record;
      continue;
    }
    const baseName = String((record as any).name ?? "Imported page") || "Imported page";
    let candidate = baseName;
    let suffix = 2;
    while (existingPageNames.has(candidate)) {
      candidate = `${baseName} (${suffix})`;
      suffix += 1;
    }
    existingPageNames.add(candidate);
    mergedStore[recordId] = { ...record, name: candidate };
  }

  return {
    ...current,
    ...incoming,
    store: mergedStore,
  };
}

export function parseOfficialTldrawFile(
  editor: Editor,
  jsonText: string,
): StoreSnapshotLike | null {
  try {
    const parsed = parseTldrawJsonFile({
      schema: (editor.store as any).schema,
      json: jsonText,
    });
    if (!parsed.ok) return null;
    const snapshot = (parsed.value as any).getStoreSnapshot?.();
    if (!snapshot?.store) return null;
    return snapshot as StoreSnapshotLike;
  } catch {
    return null;
  }
}

function sanitizeArtifactsForBackup(rows: ArtifactRecord[]): ArtifactRecord[] {
  return rows.map((artifact) => {
    if (artifact.type !== "image" && artifact.type !== "video") {
      return artifact;
    }
    const mediaUrl = artifact.mediaUrl;
    return {
      ...artifact,
      mediaUrl,
      dataUrl: undefined,
      blobId: undefined,
    };
  });
}

async function getArtifactsForBackup(
  canvasId: string,
): Promise<ArtifactRecord[]> {
  const msg = (await chrome.runtime.sendMessage({
    type: "LIST_ARTIFACTS",
    canvasId,
  } as RuntimeMessage)) as { ok?: boolean; artifacts?: ArtifactRecord[] };
  if (!msg?.ok || !msg.artifacts) {
    return [];
  }
  return sanitizeArtifactsForBackup(msg.artifacts);
}

async function getDeletedArtifactIdsForBackup(
  canvasId: string,
): Promise<string[]> {
  try {
    const res = await chrome.storage.local.get("deletedArtifactIdsByCanvas");
    const all = (res.deletedArtifactIdsByCanvas ?? {}) as Record<
      string,
      string[]
    >;
    return all[canvasId] ?? [];
  } catch {
    return [];
  }
}

export async function buildCanvasBackup(
  editor: Editor,
  canvasId: string,
  options?: { isPrivate?: boolean },
): Promise<CanvasBackup> {
  const snapshot = getSnapshot(editor.store);
  const [artifacts, deletedArtifactIds] = await Promise.all([
    getArtifactsForBackup(canvasId),
    getDeletedArtifactIdsForBackup(canvasId),
  ]);
  const backup: CanvasBackupV1 = {
    version: 1,
    mainDocumentId: canvasId,
    createdAt: Date.now(),
    isPrivate: !!options?.isPrivate,
    tldrawSnapshot: snapshot,
    artifacts,
    deletedArtifactIds,
  };
  return backup;
}

export async function applyCanvasBackup(
  editor: Editor,
  backupOrSnapshot: CanvasBackup | TldrawLikeSnapshot | StoreSnapshotLike,
  options?: { mode?: "merge" | "restore" },
): Promise<void> {
  console.debug("[ResearchCanvas] applyCanvasBackup: start", {
    isWrappedBackup: isCanvasBackup(backupOrSnapshot),
    mode: options?.mode ?? "merge",
  });
  if (isCanvasBackup(backupOrSnapshot)) {
    // For extension-generated backups, treat them as a full restore of the
    // canvas document rather than a merge. This avoids duplicated shapes when
    // artifacts are also restored.
    const incoming = toStoreSnapshotLike(backupOrSnapshot.tldrawSnapshot);
    if (!incoming) {
      throw new Error(
        "Backup file did not contain a readable tldraw snapshot.",
      );
    }
    const recordCount = Object.keys(incoming.store ?? {}).length;
    if (!recordCount) {
      throw new Error(
        "Backup file snapshot was empty. Export may have failed before data was written.",
      );
    }
    console.debug("[ResearchCanvas] applyCanvasBackup: restore backup", {
      records: recordCount,
      recordTypes: getStoreTypeCounts(incoming.store ?? {}),
    });
    editor.loadSnapshot(incoming as any);
    console.debug(
      "[ResearchCanvas] applyCanvasBackup: sending APPLY_CANVAS_BACKUP message",
      {
        artifacts: backupOrSnapshot.artifacts?.length ?? 0,
        deletedArtifactIds: backupOrSnapshot.deletedArtifactIds?.length ?? 0,
      },
    );
    await chrome.runtime.sendMessage({
      type: "APPLY_CANVAS_BACKUP",
      backup: backupOrSnapshot,
    } as RuntimeMessage);
    return;
  }

  // For external snapshots (.tldr, raw snapshots), merge into the current
  // document by appending pages and importable records.
  const incoming = toStoreSnapshotLike(backupOrSnapshot);
  const currentSnap = getSnapshot(editor.store) as any;
  const current = toStoreSnapshotLike(currentSnap) ?? {
    store: currentSnap.document?.store ?? {},
    schema: currentSnap.document?.schema,
  };
  if (!incoming) {
    throw new Error("Import file did not contain a readable tldraw snapshot.");
  }
  console.debug("[ResearchCanvas] applyCanvasBackup: merge import", {
    currentRecords: Object.keys(current.store ?? {}).length,
    incomingRecords: Object.keys(incoming.store ?? {}).length,
    incomingImportableRecords: Object.keys(
      filterImportableStore(incoming.store ?? {}),
    ).length,
    incomingRecordTypes: getStoreTypeCounts(incoming.store ?? {}),
  });
  if ((options?.mode ?? "merge") === "restore") {
    if (!Object.keys(incoming.store ?? {}).length) {
      throw new Error(
        "Import snapshot was empty. File is valid JSON but does not contain drawing data.",
      );
    }
    editor.loadSnapshot(incoming as any);
    return;
  }
  const merged = addPagesWithUniqueNames(current, incoming);
  editor.loadSnapshot(merged as any);
}

