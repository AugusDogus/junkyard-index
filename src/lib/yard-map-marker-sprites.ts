import {
  YardMapMarkerPaint,
  type YardMarkerColors,
  type YardMarkerContext,
  type YardMarkerLook,
} from "./yard-map-marker-paint";

/** Device pixels kept clear around a sprite's marker for its antialiasing. */
const PAD_PX = 2;

/** The canvas calls a stamp draws with: shapes, or a sprite image. */
export type YardMarkerStampContext<Image> = YardMarkerContext & {
  drawImage(image: Image, x: number, y: number, w: number, h: number): void;
};

/**
 * Draws one marker look. Plain dots and pins, nearly every marker on a
 * frame, are stamped from an image of the marker drawn once per size,
 * density and theme: one canvas call each instead of two filled circles.
 * Hovered, open and resizing markers are drawn as shapes.
 */
export type YardMarkerStamp<Image> = (
  context: YardMarkerStampContext<Image>,
  look: YardMarkerLook,
  colors: YardMarkerColors,
  density: number,
) => void;

/**
 * A stamp that renders its sprites with `render`: a `side`-pixel square
 * canvas, painted by `paint` in device pixels. Its center falls on a device
 * pixel corner, as the frame snaps every marker's center, so a sprite drawn
 * at a whole device pixel offset covers the same pixels as the shape.
 */
function create<Image>(
  render: (side: number, paint: (context: YardMarkerContext) => void) => Image,
): YardMarkerStamp<Image> {
  const sprites = new Map<string, { image: Image; side: number }>();
  return (context, look, colors, density) => {
    const plain =
      look.emphasis === 1 &&
      !look.selected &&
      (look.size === YardMapMarkerPaint.DOT_PX ||
        look.size === YardMapMarkerPaint.PIN_PX);
    if (!plain) {
      YardMapMarkerPaint.shape(context, look, colors);
      return;
    }
    const key = `${look.size} ${density} ${colors.paper} ${colors.ink}`;
    let sprite = sprites.get(key);
    if (!sprite) {
      const side = 2 * (Math.ceil((look.size * density) / 2) + PAD_PX);
      const image = render(side, (spriteContext) =>
        YardMapMarkerPaint.shape(
          spriteContext,
          {
            x: side / 2,
            y: side / 2,
            size: look.size * density,
            emphasis: density,
            selected: false,
          },
          colors,
        ),
      );
      sprite = { image, side };
      sprites.set(key, sprite);
    }
    const side = sprite.side / density;
    context.drawImage(
      sprite.image,
      look.x - side / 2,
      look.y - side / 2,
      side,
      side,
    );
  };
}

export const YardMapMarkerSprites = { PAD_PX, create } as const;
