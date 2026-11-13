"""Read the actual X11 window backing, not Chromium's capturePage surface."""
import ctypes as c
import json
import sys

from PIL import Image

x = c.CDLL('libX11.so.6')
x.XOpenDisplay.restype = c.c_void_p
x.XGetImage.argtypes = [c.c_void_p, c.c_ulong, c.c_int, c.c_int, c.c_uint, c.c_uint, c.c_ulong, c.c_int]
x.XGetImage.restype = c.c_void_p
x.XGetPixel.argtypes = [c.c_void_p, c.c_int, c.c_int]
x.XGetPixel.restype = c.c_ulong
x.XDestroyImage.argtypes = [c.c_void_p]
x.XCloseDisplay.argtypes = [c.c_void_p]
display = x.XOpenDisplay(None)
if not display:
    raise RuntimeError('Cannot connect to isolated X server')
image = x.XGetImage(display, int(sys.argv[1]), 0, 0, 640, 360, c.c_ulong(-1), 2)
if not image:
    raise RuntimeError('XGetImage failed')
pixels = []
for row in range(360):
    for col in range(640):
        pixel = x.XGetPixel(image, col, row)
        pixels.append(((pixel >> 16) & 255, (pixel >> 8) & 255, pixel & 255, (pixel >> 24) & 255))
snapshot = Image.new('RGBA', (640, 360))
snapshot.putdata(pixels)
snapshot.save(sys.argv[2])
glyphs = sum(1 for col in range(235, 530) for row in range(55, 140)
             if all(channel > 245 for channel in pixels[row * 640 + col][:3])
             and pixels[row * 640 + col][3] == 255)
print(json.dumps({'railRGBA': snapshot.getpixel((40, 220)),
                  'fieldRGBA': snapshot.getpixel((560, 220)),
                  'opaqueWhiteGlyphPixels': glyphs, 'source': 'XGetImage real native window'}))
x.XDestroyImage(image)
x.XCloseDisplay(display)
