import type { Editor } from "@tldraw/editor";
import { DEFAULT_EMBED_DEFINITIONS, type TLEmbedDefinition } from "@tldraw/tldraw";

function withYouTubeIdentityParams(embedUrl: string): string {
  try {
    const url = new URL(embedUrl);
    if (!/youtube(?:-nocookie)?\.com$/i.test(url.hostname)) return embedUrl;
    if (!url.pathname.startsWith("/embed/")) return embedUrl;
    url.searchParams.set("origin", "https://www.youtube.com");
    url.searchParams.set("widget_referrer", "https://www.youtube.com");
    return url.toString();
  } catch {
    return embedUrl;
  }
}

function rewriteYouTubeEmbedsForExtension(
  definitions: readonly TLEmbedDefinition[],
): TLEmbedDefinition[] {
  return definitions.map((def) => {
    if (def.type !== "youtube") return def;
    const base = def;
    return {
      ...base,
      hostnames: [
        ...base.hostnames,
        "youtube-nocookie.com",
        "*.youtube-nocookie.com",
      ],
      toEmbedUrl: (url: string) => {
        const out = base.toEmbedUrl(url);
        if (!out) return undefined;
        // Keep canonical youtube.com embeds for best compatibility with
        // current YouTube player requirements (Error 153 / referrer checks).
        const canonical = out.replace(
          "https://www.youtube-nocookie.com/embed/",
          "https://www.youtube.com/embed/",
        );
        return withYouTubeIdentityParams(canonical);
      },
      fromEmbedUrl: (url: string) => {
        const normalized = url
          .replace(/www\.youtube-nocookie\.com/gi, "www.youtube.com")
          .replace(/\byoutube-nocookie\.com\b/gi, "youtube.com");
        return base.fromEmbedUrl(normalized);
      },
    } as TLEmbedDefinition;
  });
}

export const RESEARCH_EMBED_DEFINITIONS =
  rewriteYouTubeEmbedsForExtension(DEFAULT_EMBED_DEFINITIONS);

/** One-time fix for boards persisted with youtube-nocookie embed URLs. */
export function migrateLegacyYoutubeEmbedUrls(editor: Editor) {
  for (const page of editor.getPages()) {
    for (const id of editor.getPageShapeIds(page.id)) {
      const shape = editor.getShape(id);
      if (!shape || shape.type !== "embed") continue;
      const props = shape.props as { url?: string };
      const url = props.url;
      if (typeof url !== "string") continue;
      if (!url.includes("youtube-nocookie.com/embed/")) continue;
      editor.updateShape({
        id: shape.id,
        type: "embed",
        props: {
          ...props,
          url: withYouTubeIdentityParams(
            url.replace(
              "https://www.youtube-nocookie.com/embed/",
              "https://www.youtube.com/embed/",
            ),
          ),
        },
      });
    }
  }
}
