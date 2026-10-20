# Estrae codici, nomi, taglie e foto (vista frontale) dai cataloghi PDF Bicycle Line.
# Uso: copia i PDF in /tmp/blcat come cyc.pdf run.pdf tri.pdf skt.pdf row.pdf, poi: python3 tools/extract_catalog.py
# Richiede: pip install pymupdf pillow numpy
import pymupdf, re, json, os, io, sys
from PIL import Image
SRC='/tmp/blcat'; OUT='/home/claude/bl-studio/img/products'
SPORTS={'cyc':'cycling','run':'running','tri':'triathlon','skt':'speed_skating','row':'rowing'}
HDR=re.compile(r'^([A-Z]\d{4})\b\s*(.*)$')
SIZE_TOK=re.compile(r'^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|\d{2,3}|TU|S/M|L/XL|M/L|XS/S|XL/XXL|\d{1,2}A|\d{1,2}-\d{1,2})$')
def norm_size(s):
    s=s.strip().upper()
    return {'2XL':'XXL','XXXL':'3XL'}.get(s,s)
def size_list(txt):
    parts=[p for p in re.split(r'\s*[-|,–/]\s*|\s+',txt.strip()) if p]
    # gestisce "S/M" come token unico se presente
    raw=[p.strip() for p in re.split(r'\s*[-|,–]\s*|\s{2,}',txt.strip()) if p.strip()]
    toks=raw if all(SIZE_TOK.match(r.upper()) for r in raw) else parts
    if toks and all(SIZE_TOK.match(t.upper()) for t in toks): return [norm_size(t) for t in toks]
    return None
res=[]
import numpy as np
def segs(prof,gap):
    out=[];start=None;last=None
    for i,v in enumerate(prof):
        if v>0:
            if start is None: start=i
            elif i-last>gap: out.append((start,last)); start=i
            last=i
    if start is not None: out.append((start,last))
    return out
def main_segment(pil):
    a=np.asarray(pil).astype(int); ink=(a.min(axis=2)<232)
    for _ in range(2):
        cols=segs(ink.sum(0),10)
        if not cols: return pil
        c0,c1=max(cols,key=lambda s:ink[:,s[0]:s[1]+1].sum())
        rows=segs(ink[:,c0:c1+1].sum(1),10)
        r0,r1=max(rows,key=lambda s:ink[s[0]:s[1]+1,c0:c1+1].sum())
        a=a[r0:r1+1,c0:c1+1]; ink=ink[r0:r1+1,c0:c1+1]
    a=np.pad(a,((8,8),(8,8),(0,0)),constant_values=255)
    return Image.fromarray(a.astype('uint8'))
os.makedirs(OUT,exist_ok=True)
for key,sport in SPORTS.items():
    d=pymupdf.open(f'{SRC}/{key}.pdf'); seen=set()
    os.makedirs(f'{OUT}/{sport}',exist_ok=True)
    for pi,pg in enumerate(d):
        lines=[]
        for b in pg.get_text('dict')['blocks']:
            for l in b.get('lines',[]):
                t=''.join(s['text'] for s in l['spans']).strip()
                if t: lines.append((l['bbox'],t,max(s['size'] for s in l['spans'])))
        heads=[(bb,t) for bb,t,sz in lines if sz>=11.5 and HDR.match(t)]
        heads.sort(key=lambda h:h[0][1])
        dd=[]; 
        for h in heads:
            c=HDR.match(h[1]).group(1)
            if any(HDR.match(x[1]).group(1)==c for x in dd): continue
            dd.append(h)
        heads=dd
        imgs=pg.get_image_info()
        # copia della pagina senza testi (per foto pulite)
        cdoc=pymupdf.open(); cdoc.insert_pdf(d,from_page=pi,to_page=pi); clean=cdoc[0]
        for bl in clean.get_text('dict')['blocks']:
            if bl.get('type')==0: clean.add_redact_annot(bl['bbox'])
        clean.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
        for i,(bb,t) in enumerate(heads):
            code,rest=HDR.match(t).groups()
            if code in seen: continue
            y0=bb[1]; y1=heads[i+1][0][1] if i+1<len(heads) else pg.rect.height
            ys=0 if (i==0 and y0<150) else y0-10
            # titolo: "MODEL - desc"
            parts=[p.strip() for p in re.split(r'\s*[-–]\s+',rest.strip()) if p.strip()]
            if len(parts)>=2: model,desc=parts[0],' - '.join(parts[1:])
            elif len(parts)==1: model,desc='',parts[0]
            else: continue
            # taglie
            block=[(b2,t2) for b2,t2,sz in lines if y0<=b2[1]<y1]
            sizes=None; label=''
            for b2,t2,sz in lines:
                if not (y0<=b2[1]<y1): continue
                m=re.match(r'^(Taglie(?:\s+\w+)?|Sizes)\s*:?\s*(.*)$',t2,re.I)
                if not m: continue
                label=m.group(1)
                near=[(b3,t3) for b3,t3,_ in lines if b3[0]>=b2[0]-5 and -4<=b3[1]-b2[1]<=30 and (b3,t3)!=(b2,t2) and size_list(t3)]
                near.sort(key=lambda x:(x[0][1],x[0][0]))
                acc=' - '.join([m.group(2)]+[t3 for _,t3 in near]).strip(' -')
                s2=size_list(acc) if acc else None
                if s2: sizes=s2; break
            # immagine principale: gruppo di immagini sovrapposte più grande (vista frontale)
            PA=pg.rect.width*pg.rect.height
            inblk=[im for im in imgs if ys<=(im['bbox'][1]+im['bbox'][3])/2<y1]
            masked=[im for im in inblk if im.get('has-mask')]
            src=masked if masked else inblk
            lim=0.40 if masked else 0.20
            cand=[pymupdf.Rect(im['bbox'])&pg.rect for im in src]
            cand=[r for r in cand if r.width>8 and r.height>8 and r.width*r.height<lim*PA]
            comps=[]
            for r in cand:
                g=[c for c in comps if any((x+(-3,-3,3,3)).intersects(r) for x in c)]
                merged=[r]+[x for c in g for x in c]
                comps=[c for c in comps if c not in g]+[merged]
            img=None
            if comps:
                def U(c):
                    u=pymupdf.Rect(c[0])
                    for x in c[1:]: u|=x
                    return u
                R=pg.rect
                inner=[U(c) for c in comps if not (U(c).x0<3 or U(c).x1>R.width-3 or U(c).y1>R.height-3)]
                best=max(inner or [U(c) for c in comps],key=lambda u:u.width*u.height)
                if best.width*best.height>2500:
                    clip=(best+(-2,-2,2,2))&pg.rect
                    pix=clean.get_pixmap(clip=clip,dpi=150,alpha=False)
                    pil=Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')
                    pil=main_segment(pil)
                    pil.thumbnail((420,420),Image.LANCZOS)
                    fn=f'{sport}/{code}.jpg'; pil.save(f'{OUT}/{fn}','JPEG',quality=82,optimize=True,progressive=True)
                    img='img/products/'+fn
            seen.add(code)
            res.append(dict(sport=sport,code=code,model=model,desc=desc,sizes=sizes,size_label=label,page=pi+1,image=img))
json.dump(res,open('/tmp/blcat/products.json','w'),ensure_ascii=False,indent=1)
for r in res: print(r['sport'][:4],r['code'],r['page'],'|',r['model'],'|',r['desc'][:50],'|',r['size_label'],r['sizes'],'|','IMG' if r['image'] else 'NOIMG')
print(len(res))
