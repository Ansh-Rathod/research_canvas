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

    const patchTree = (child: unknown): unknown => {
      if (!isValidElement(child)) return child;
      const element = child as ReactElement<Record<string, unknown>>;
      const children = (element.props as { children?: unknown }).children;
      const nextChildren = Children.map(children, patchTree);
      const nextProps: Record<string, unknown> = {};
      if (nextChildren !== children) nextProps.children = nextChildren;
      if (element.type === "iframe") {
        nextProps.referrerPolicy = "strict-origin-when-cross-origin";
      }
      if (Object.keys(nextProps).length === 0) return element;
      return cloneElement(element, nextProps);
    };

    const kids = (node.props as { children?: unknown }).children;
    const nextChildren = Children.map(kids, patchTree);
    return cloneElement(node, { children: nextChildren } as never);
  }
}
