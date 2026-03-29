import { MAIN_DOCUMENT_ID } from "@shared/document";

const STORAGE_KEY = "deletedArtifactIdsByCanvas";

/** Merge per-canvas tombstone lists from the multi-canvas era into `MAIN_DOCUMENT_ID`. */
export async function mergeDeletedArtifactTombstones(): Promise<void> {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const raw = res[STORAGE_KEY] as Record<string, string[]> | undefined;
  if (!raw || Object.keys(raw).length === 0) return;
  const merged = new Set<string>();
  for (const ids of Object.values(raw)) {
    for (const id of ids) merged.add(id);
  }
  await chrome.storage.local.set({
    [STORAGE_KEY]: { [MAIN_DOCUMENT_ID]: [...merged] },
  });
}
