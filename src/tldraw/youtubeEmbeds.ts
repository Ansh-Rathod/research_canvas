import type { Editor } from "@tldraw/editor";
import { DEFAULT_EMBED_DEFINITIONS, type TLEmbedDefinition } from "@tldraw/tldraw";

/**
 * YouTube "Error 153" often appears when the embed player gets an invalid or
 * overly-restricted referrer (common for extension pages). The privacy-enhanced
 * host plus looser referrer on the iframe (see researchEmbedShapeUtil) matches
 * what works on normal sites after YouTube's 2025-ish embed changes.
 */
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
        return out.replace(
          "https://www.youtube.com/embed/",
          "https://www.youtube-nocookie.com/embed/",
        );
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

/** One-time fix for boards persisted with www.youtube.com embed URLs. */
export function migrateLegacyYoutubeEmbedUrls(editor: Editor) {
  for (const page of editor.getPages()) {
    for (const id of editor.getPageShapeIds(page.id)) {
      const shape = editor.getShape(id);
      if (!shape || shape.type !== "embed") continue;
      const props = shape.props as { url?: string };
      const url = props.url;
      if (typeof url !== "string") continue;
      if (!url.includes("www.youtube.com/embed/")) continue;
      if (url.includes("youtube-nocookie.com")) continue;
      editor.updateShape({
        id: shape.id,
        type: "embed",
        props: {
          ...props,
          url: url.replace(
            "https://www.youtube.com/embed/",
            "https://www.youtube-nocookie.com/embed/",
          ),
        },
      });
    }
  }
}
