"""Genera js/catalog-images.js e js/brand-assets.js (immagini in base64 per il PDF:
servono perché aprendo index.html da file:// il browser non permette di leggere le foto dal disco).
Uso: python3 tools/build_images_js.py"""
import base64, json, os
from PIL import Image
def durl(p, mime):
    return f'data:{mime};base64,' + base64.b64encode(open(p, 'rb').read()).decode()
imgs = {}
for root, _, files in os.walk('img/products'):
    for f in sorted(files):
        if f.endswith('.jpg'):
            p = os.path.join(root, f).replace(os.sep, '/')
            w, h = Image.open(p).size
            imgs[p] = [durl(p, 'image/jpeg'), w, h]
open('js/catalog-images.js', 'w').write('/* Generato da tools/build_images_js.py */\nwindow.BLImages = ' + json.dumps(imgs) + ';\n')
lw, lh = Image.open('img/brand/bl-logo.png').size; sw, sh = Image.open('img/brand/bl-slogan.png').size
brand = {'logo': durl('img/brand/bl-logo.png', 'image/png'), 'logoW': lw, 'logoH': lh, 'slogan': durl('img/brand/bl-slogan.png', 'image/png'), 'sloganW': sw, 'sloganH': sh}
open('js/brand-assets.js', 'w').write('/* Generato da tools/build_images_js.py */\nwindow.BLBrand = ' + json.dumps(brand) + ';\n')
print(len(imgs), os.path.getsize('js/catalog-images.js'), os.path.getsize('js/brand-assets.js'))
