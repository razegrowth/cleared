"""Six directions on one sheet: mark on paper, then the toolbar tile at 128/32/16."""
import glob, io, json, re, sys
import resvg_py
from PIL import Image, ImageDraw, ImageFont, ImageOps

def mark_png(svg_path, size, pad=0.0):
    svg = open(svg_path).read()
    svg = re.sub(r'fill="#[0-9a-fA-F]{3,8}"', 'fill="#000000"', svg)
    png = resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size)
    im = Image.open(io.BytesIO(bytes(png))).convert("RGBA")
    return im

def fit(im, box):
    """Scale the mark's ink into a box, keep aspect, centred."""
    a = im.getchannel("A"); bb = a.getbbox(); im = im.crop(bb)
    s = min(box / im.width, box / im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)

def tile(svg, px, inset=0.2, radius=0.225):
    """White mark on a black rounded square: the toolbar icon."""
    big = 512
    t = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(t).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * radius), fill=(17, 17, 17, 255))
    m = fit(mark_png(svg, 1024), int(big * (1 - 2 * inset)))
    white = Image.new("RGBA", m.size, (255, 255, 255, 255)); white.putalpha(m.getchannel("A"))
    t.alpha_composite(white, ((big - m.width) // 2, (big - m.height) // 2))
    return t.resize((px, px), Image.LANCZOS)

if __name__ == "__main__":
    dirs = sorted(glob.glob("build/*/"))
    W, H = 760, 200
    sheet = Image.new("RGB", (W, H * len(dirs)), "white")
    d = ImageDraw.Draw(sheet)
    try: f = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 18)
    except Exception: f = ImageFont.load_default()
    for i, b in enumerate(dirs):
        y = i * H
        m = fit(mark_png(b + "mark.svg", 1024), 160)
        sheet.paste(m, (20 + (160 - m.width) // 2, y + 20 + (160 - m.height) // 2), m)
        x = 210
        for px in (128, 32, 16):
            t = tile(b + "mark.svg", px)
            sheet.paste(t, (x, y + 20 + (128 - px) // 2), t); x += px + 30
        # 16 px shown 4x, nearest-neighbour, to see the real pixels
        t16 = tile(b + "mark.svg", 16).resize((64, 64), Image.NEAREST)
        sheet.paste(t16, (x, y + 52), t16)
        title = json.load(open(glob.glob(f"directions/{b.split('/')[1]}.json")[0]))["title"]
        d.text((x + 90, y + 70), title, fill="black", font=f)
        d.line([(0, y + H - 1), (W, y + H - 1)], fill=(230, 230, 230))
    sheet.save(sys.argv[1] if len(sys.argv) > 1 else "sheet.png")
