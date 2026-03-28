import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { ArtifactRecord, CanvasRecord } from "@shared/messages";

interface ResearchCanvasDb extends DBSchema {
  canvases: {
    key: string;
    value: CanvasRecord;
    indexes: { "by-updatedAt": number };
  };
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
    dbPromise = openDB<ResearchCanvasDb>("research-canvas-db", 1, {
      upgrade(db) {
        const canvases = db.createObjectStore("canvases", { keyPath: "id" });
        canvases.createIndex("by-updatedAt", "updatedAt");

        const artifacts = db.createObjectStore("artifacts", { keyPath: "id" });
        artifacts.createIndex("by-canvasId", "canvasId");
        artifacts.createIndex("by-createdAt", "createdAt");

        db.createObjectStore("blobs");
      }
    });
  }
  return dbPromise;
}
