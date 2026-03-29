import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  toDomPrecision,
  useEditor,
  useValue,
} from "@tldraw/editor";
import type { TLBaseShape } from "@tldraw/tlschema";
import {
  DefaultColorStyle,
  createShapePropsMigrationSequence,
  richTextValidator,
  type TLDefaultColorStyle,
} from "@tldraw/tlschema";
import type { TLRichText } from "@tldraw/tlschema";
import {
  LABEL_FONT_SIZES,
  RichTextLabel,
  TEXT_PROPS,
  toRichText,
  useDefaultColorTheme,
} from "@tldraw/tldraw";
import { useLayoutEffect, useMemo, useRef, type ReactElement } from "react";
import "./research-quote.css";

/** Total shape width: left bar + horizontal padding + text column (aligned with ~400px reading width used by auto-size text captures). */
export const RESEARCH_QUOTE_SHAPE_W = 445;

const LEFT_BAR_PX = 10;
/** Inner padding around quote text (px). */
const INNER_PAD_X = 26;
const INNER_PAD_Y = 26;
/** Starting height before layout measures content; same as default props `h`. */
export const RESEARCH_QUOTE_INITIAL_H = 64;
const MIN_H = RESEARCH_QUOTE_INITIAL_H;

export type TLResearchQuoteShape = TLBaseShape<
  "researchQuote",
  {
    w: number;
    h: number;
    richText: TLRichText;
    color: TLDefaultColorStyle;
  }
>;

const researchQuoteShapeProps = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  richText: richTextValidator,
  color: DefaultColorStyle,
};

export const researchQuoteShapeMigrations = createShapePropsMigrationSequence({
  sequence: [],
});

function ResearchQuoteShapeComponent({
  shape,
}: {
  shape: TLResearchQuoteShape;
}) {
  const editor = useEditor();
  const theme = useDefaultColorTheme();
  const measureRef = useRef<HTMLDivElement>(null);
  const { w, h, richText, color } = shape.props;
  const richTextKey = useMemo(() => JSON.stringify(richText), [richText]);
  const isOnlySelected = useValue(
    "researchQuoteSelected",
    () => editor.getOnlySelectedShapeId() === shape.id,
    [editor, shape.id],
  );

  const palette = theme[color];
  const bg = palette.note.fill;
  const leftBorder = palette.solid;

  // Fit height to content when the quote text or shape width changes (not when only h changes from a manual resize).
  useLayoutEffect(() => {
    const syncHeight = () => {
      const el = measureRef.current;
      if (!el) return;
      const nextH = Math.max(MIN_H, Math.ceil(el.scrollHeight));
      const cur = editor.getShape(shape.id) as TLResearchQuoteShape | undefined;
      if (!cur) return;
      if (Math.abs(nextH - cur.props.h) <= 1) return;
      editor.updateShape({
        id: shape.id,
        type: "researchQuote",
        props: {
          ...cur.props,
          h: nextH,
        },
      });
    };
    syncHeight();
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(syncHeight);
    });
    return () => {
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
    };
  }, [editor, shape.id, richTextKey, w]);

  return (
    <HTMLContainer
      id={shape.id}
      style={{
        width: toDomPrecision(w),
        height: toDomPrecision(h),
        pointerEvents: "all",
      }}
    >
      <div
        ref={measureRef}
        className="research-quote"
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          width: "100%",
          minHeight: "min-content",
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        }}
      >
        <div
          style={{
            width: LEFT_BAR_PX,
            flexShrink: 0,
            background: leftBorder,
          }}
        />
        <div
          className="research-quote__body"
          style={{
            flex: 1,
            minWidth: 0,
            background: bg,
            padding: `${INNER_PAD_Y}px ${INNER_PAD_X}px`,
            boxSizing: "border-box",
            position: "relative",
          }}
        >
          <RichTextLabel
            shapeId={shape.id}
            type="researchQuote"
            font="sans"
            fontSize={LABEL_FONT_SIZES.xl}
            lineHeight={TEXT_PROPS.lineHeight}
            align="start"
            verticalAlign="start"
            wrap
            richText={richText}
            isSelected={isOnlySelected}
            labelColor={theme.black.solid}
            padding={0}
            style={{
              position: "relative",
              inset: "unset",
              width: "100%",
              height: "auto",
              justifyContent: "flex-start",
              alignItems: "flex-start",
            }}
          />
        </div>
      </div>
    </HTMLContainer>
  );
}

/** @public */
export class ResearchQuoteShapeUtil extends BaseBoxShapeUtil<TLResearchQuoteShape> {
  static override type = "researchQuote" as const;
  static override props = researchQuoteShapeProps;
  static override migrations = researchQuoteShapeMigrations;

  override canEdit() {
    return true;
  }

  override getDefaultProps(): TLResearchQuoteShape["props"] {
    return {
      w: RESEARCH_QUOTE_SHAPE_W,
      h: MIN_H,
      richText: toRichText(""),
      color: "light-violet",
    };
  }

  override component(shape: TLResearchQuoteShape): ReactElement {
    return <ResearchQuoteShapeComponent shape={shape} />;
  }

  override indicator(shape: TLResearchQuoteShape) {
    return (
      <rect
        width={toDomPrecision(shape.props.w)}
        height={toDomPrecision(shape.props.h)}
        rx={6}
        ry={6}
      />
    );
  }
}
