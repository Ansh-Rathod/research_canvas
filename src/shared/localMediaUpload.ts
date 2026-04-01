export type UploadKind = "image" | "video";

export interface UploadMediaInput {
  kind: UploadKind;
  blob: Blob;
  width?: number;
  height?: number;
  fileName?: string;
}

export interface UploadMediaResult {
  url: string;
  mimeType: string;
  absolutePath?: string;
  width?: number;
  height?: number;
}

const LOCAL_MEDIA_SERVER_BASE =
  (globalThis as any).__RESEARCH_CANVAS_LOCAL_MEDIA_SERVER__ ||
  "http://127.0.0.1:43123";

export async function uploadMediaToLocalServer(
  input: UploadMediaInput,
): Promise<UploadMediaResult> {
  const formData = new FormData();
  const ext = input.kind === "image" ? "png" : "webm";
  const fileName =
    input.fileName ??
    `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  formData.append("file", new File([input.blob], fileName, { type: input.blob.type }));
  if (typeof input.width === "number") formData.append("width", String(input.width));
  if (typeof input.height === "number")
    formData.append("height", String(input.height));

  const response = await fetch(`${LOCAL_MEDIA_SERVER_BASE}/upload/${input.kind}`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      text || `Local server upload failed (${response.status}) for ${input.kind}.`,
    );
  }

  const json = (await response.json()) as {
    ok?: boolean;
    url?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    absolutePath?: string;
    error?: string;
  };
  if (!json.url) {
    throw new Error(json.error || "Upload succeeded but no media URL was returned.");
  }
  return {
    url: json.url,
    mimeType: json.mimeType || input.blob.type || "application/octet-stream",
    absolutePath: json.absolutePath,
    width: json.width,
    height: json.height,
  };
}
