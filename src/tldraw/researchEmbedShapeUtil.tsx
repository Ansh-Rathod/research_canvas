import type { TLEmbedShape } from "@tldraw/editor";
import { EmbedShapeUtil } from "@tldraw/tldraw";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
} from "react";

/**
 * tldraw sets referrerPolicy="no-referrer-when-downgrade" on all embed iframes.
 * YouTube’s embedded player now commonly fails (Error 153) without a usable
 * referrer from the embedding document — swap to a policy that still avoids
 * leaking full URLs to cross-origin embeds.
 */
export class ResearchEmbedShapeUtil extends EmbedShapeUtil {
  override component(shape: TLEmbedShape) {
    const node = super.component(shape);
    if (!isValidElement(node)) return node;

    const kids = (node.props as { children?: unknown }).children;
    const patchIframe = (child: unknown) => {
      if (!isValidElement(child)) return child;
      if (child.type === "iframe") {
        return cloneElement(child as ReactElement<Record<string, unknown>>, {
          referrerPolicy: "strict-origin-when-cross-origin",
        });
      }
      return child;
    };

    const nextChildren = Children.map(kids, patchIframe);
    return cloneElement(node, { children: nextChildren } as never);
  }
}
