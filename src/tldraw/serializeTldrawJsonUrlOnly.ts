import type { Editor, TLRecord } from "@tldraw/editor";
import type { TLAssetId } from "@tldraw/tlschema";

/** Must match tldraw `LATEST_TLDRAW_FILE_FORMAT_VERSION` in `serializeTldrawJson`. */
const TLDRAW_FILE_FORMAT_VERSION = 1;

function normalizeLocalMediaUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url
    .replace("/media/image/", "/media/images/")
    .replace("/media/video/", "/media/videos/");
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Same rules as App.tsx `toPortableMediaUrl` — stable paths for local server media in exports. */
function toPortableMediaUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const normalized = normalizeLocalMediaUrl(url) ?? url;
  if (
    normalized.startsWith("/media/images/") ||
    normalized.startsWith("/media/videos/")
  ) {
    return normalized;
  }
  if (!isHttpUrl(normalized)) return normalized;
  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname;
    if (
      path.startsWith("/media/images/") ||
      path.startsWith("/media/videos/")
    ) {
      return path;
    }
  } catch {
    return normalized;
  }
  return normalized;
}

function pruneUnusedAssets(records: TLRecord[]) {
  const usedAssets = new Set<TLAssetId>();
  for (const record of records) {
    if (
      record.typeName === "shape" &&
      "assetId" in record.props &&
      record.props.assetId
    ) {
      usedAssets.add(record.props.assetId as TLAssetId);
    }
  }
  return records.filter(
    (r) => r.typeName !== "asset" || usedAssets.has(r.id as TLAssetId),
  );
}

/**
 * Like tldraw's `serializeTldrawJson`, but never inlines assets as `data:` base64.
 * Non-bookmark image/video assets with URL `src` are written as portable `https://...` or `/media/...` only.
 */
export async function serializeTldrawJsonUrlOnly(
  editor: Editor,
): Promise<string> {
  const records: TLRecord[] = [];
  for (const record of editor.store.allRecords()) {
    switch (record.typeName) {
      case "asset": {
        if (
          record.type !== "bookmark" &&
          record.props.src &&
          !String(record.props.src).startsWith("data:")
        ) {
          let src = String(record.props.src);
          try {
            if (!src.startsWith("http")) {
              const resolved =
                (await editor.resolveAssetUrl(record.id, {
                  shouldResolveToOriginal: true,
                })) || "";
              if (resolved) src = resolved;
            }
          } catch {
            /* keep src */
          }
          const assetSrcToSave = toPortableMediaUrl(src) ?? src;
          records.push({
            ...record,
            props: {
              ...record.props,
              src: assetSrcToSave,
            },
          });
        } else {
          records.push(record);
        }
        break;
      }
      default:
        records.push(record);
        break;
    }
  }

  return JSON.stringify({
    tldrawFileFormatVersion: TLDRAW_FILE_FORMAT_VERSION,
    schema: editor.store.schema.serialize(),
    records: pruneUnusedAssets(records),
  });
}
