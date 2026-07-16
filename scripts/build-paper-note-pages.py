#!/usr/bin/env python3
"""Turn scanned two-page mock-exam spreads into clear, writable note pages.

The source PDF remains private. This script extracts its embedded scans without
rerasterizing the PDF, splits each spread into its original left/right pages,
gently improves contrast and sharpness, then adds a quiet note margin. Output
files are intended for the private ``matha-papers`` Storage bucket.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps
from pypdf import PdfReader


PAPER_GROUPS = (
    ("mock-1", 1, (2, 3, 4)),
    ("mock-2", 5, (6, 7, 8)),
    ("mock-3", 9, (10, 11)),
)


def extract_image(reader: PdfReader, page_no: int) -> Image.Image:
    images = list(reader.pages[page_no - 1].images)
    if len(images) != 1:
        raise RuntimeError(f"PDF page {page_no} has {len(images)} images; expected one scan")
    return images[0].image.convert("RGB")


def clean_half(spread: Image.Image, side: str) -> Image.Image:
    width, height = spread.size
    seam = width // 2
    if side == "left":
        page = spread.crop((8, 32, seam - 8, height - 18))
    else:
        page = spread.crop((seam + 8, 32, width - 8, height - 18))

    gray = ImageOps.grayscale(page)
    gray = ImageOps.autocontrast(gray, cutoff=(0.25, 0.8))
    gray = ImageEnhance.Brightness(gray).enhance(1.035)
    gray = ImageEnhance.Contrast(gray).enhance(1.08)
    gray = gray.filter(ImageFilter.UnsharpMask(radius=1.15, percent=105, threshold=3))
    return gray.convert("RGB")


def make_note_page(page: Image.Image) -> Image.Image:
    target_text_width = 1500
    scale = target_text_width / page.width
    page = page.resize(
        (target_text_width, round(page.height * scale)),
        Image.Resampling.LANCZOS,
    )

    pad_left, pad_top, pad_bottom, notes_width = 64, 64, 96, 500
    canvas_width = pad_left + target_text_width + notes_width + 48
    canvas_height = pad_top + page.height + pad_bottom
    canvas = Image.new("RGB", (canvas_width, canvas_height), "#fffefa")
    canvas.paste(page, (pad_left, pad_top))

    draw = ImageDraw.Draw(canvas)
    notes_x = pad_left + target_text_width + 28
    draw.line((notes_x, pad_top, notes_x, canvas_height - pad_bottom // 2), fill="#d7d2c9", width=2)
    for y in range(pad_top + 72, canvas_height - 48, 92):
        draw.line((notes_x + 26, y, canvas_width - 30, y), fill="#eeeae2", width=2)
    draw.rectangle((1, 1, canvas_width - 2, canvas_height - 2), outline="#e3dfd7", width=2)
    return canvas


def build(input_pdf: Path, output_dir: Path) -> None:
    reader = PdfReader(str(input_pdf))
    if len(reader.pages) != 11:
        raise RuntimeError(f"Expected 11 PDF pages, found {len(reader.pages)}")
    output_dir.mkdir(parents=True, exist_ok=True)

    for prefix, _cover_page, spread_pages in PAPER_GROUPS:
        exam_page = 1
        for pdf_page in spread_pages:
            spread = extract_image(reader, pdf_page)
            for side in ("left", "right"):
                note_page = make_note_page(clean_half(spread, side))
                output = output_dir / f"{prefix}-write-p{exam_page}.webp"
                note_page.save(output, "WEBP", quality=91, method=6, exact=True)
                print(f"{output.name}\t{note_page.width}x{note_page.height}\t{output.stat().st_size}")
                exam_page += 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_pdf", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    build(args.input_pdf, args.output_dir)


if __name__ == "__main__":
    main()
