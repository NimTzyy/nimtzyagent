#!/usr/bin/env python3
"""Generates the app icon and splash mark.

The mark is drawn from geometry rather than set in a typeface: an N built from
two stems and a diagonal stays crisp at every size the OS asks for. Run from the
project root:

    python3 tools/make-assets.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

BACKGROUND = (11, 11, 12, 255)
ACCENT = (251, 191, 36, 255)
ASSETS = Path(__file__).resolve().parent.parent / "assets"


def draw_mark(size: int, box: float, background: tuple | None) -> Image.Image:
    """Draws the N inside a square canvas.

    `box` is the fraction of the canvas the height of the mark occupies, which
    leaves room for the mask Android applies to adaptive icons.
    """
    scale = 4  # Supersample, then downscale: keeps the diagonals clean.
    canvas = size * scale
    image = Image.new("RGBA", (canvas, canvas), background if background else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    height = canvas * box * 0.94
    width = height * 0.66
    stem = height * 0.16
    # The diagonal carries the same optical weight as the stems: its horizontal
    # run is longer than its thickness by the slope of the letter.
    run = stem * (width**2 + height**2) ** 0.5 / height

    x0 = (canvas - width) / 2
    x1 = x0 + width
    y0 = (canvas - height) / 2
    y1 = y0 + height

    draw.rectangle([x0, y0, x0 + stem, y1], fill=ACCENT)
    draw.rectangle([x1 - stem, y0, x1, y1], fill=ACCENT)
    draw.polygon(
        [(x0, y0), (x0 + run, y0), (x1, y1), (x1 - run, y1)],
        fill=ACCENT,
    )

    return image.resize((size, size), Image.LANCZOS)


def write(image: Image.Image, name: str) -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    path = ASSETS / name
    image.save(path)
    print(f"{path} {image.size[0]}x{image.size[1]}")


def main() -> None:
    # Store icon: full bleed, opaque, no transparency for iOS.
    write(draw_mark(1024, 0.58, BACKGROUND), "icon.png")
    # Android adaptive foreground: transparent, inside the 66% safe zone.
    write(draw_mark(1024, 0.44, None), "adaptive-icon.png")
    # Splash mark: transparent, sized by the splash screen configuration.
    write(draw_mark(512, 0.62, None), "splash-icon.png")


if __name__ == "__main__":
    main()
