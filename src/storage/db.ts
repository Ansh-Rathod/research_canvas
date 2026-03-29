import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import { MAIN_DOCUMENT_ID } from "@shared/document";
import type { ArtifactRecord } from "@shared/messages";

interface ResearchCanvasDb extends DBSchema {
  artifacts: {
    key: string;
    value: ArtifactRecord;
    indexes: { "by-canvasId": string; "by-createdAt": number };
  };
  blobs: {
    key: string;
    value: Blob;
  };
}

let dbPromise: Promise<IDBPDatabase<ResearchCanvasDb>> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<ResearchCanvasDb>("research-canvas-db", 2, {
      async upgrade(db, oldVersion, newVersion, transaction) {
        const targetVersion = newVersion ?? 2;
        if (oldVersion < 1) {
          const artifacts = db.createObjectStore("artifacts", { keyPath: "id" });
          artifacts.createIndex("by-canvasId", "canvasId");
          artifacts.createIndex("by-createdAt", "createdAt");
          db.createObjectStore("blobs");
          if (targetVersion < 2) {
            const canvases = (
              db as unknown as IDBPDatabase<{
                canvases: { key: string; value: { id: string }; indexes: unknown };
              }>
            ).createObjectStore("canvases", { keyPath: "id" });
            canvases.createIndex("by-updatedAt", "updatedAt");
          }
        }
        if (oldVersion < 2) {
          const artifactStore = transaction.objectStore("artifacts");
          const all: ArtifactRecord[] = await artifactStore.getAll();
          for (const row of all) {
            if (row.canvasId !== MAIN_DOCUMENT_ID) {
              await artifactStore.put({
                ...row,
                canvasId: MAIN_DOCUMENT_ID,
              });
            }
          }
          const idb = db as unknown as IDBDatabase;
          if (idb.objectStoreNames.contains("canvases")) {
            idb.deleteObjectStore("canvases");
          }
        }
      },
    });
  }
  return dbPromise;
}
