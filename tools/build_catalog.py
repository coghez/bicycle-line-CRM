"""Genera js/catalog-data.js dai prodotti estratti dai cataloghi PDF (products.json).
Uso: python3 tools/build_catalog.py /percorso/products.json"""
import json, re, sys
P = json.load(open(sys.argv[1]))

T = {  # descrizione -> (it, en, fr, de, es)
 'Bib shorts': ('Salopette', 'Bib shorts', 'Cuissard à bretelles', 'Trägerhose', 'Culotte con tirantes'),
 'Bib tights': ('Calzamaglia con bretelle', 'Bib tights', 'Collant à bretelles', 'Lange Trägerhose', 'Culotte largo con tirantes'),
 'Body Triathlon': ('Body triathlon', 'Triathlon suit', 'Trifonction', 'Triathlon-Einteiler', 'Mono de triatlón'),
 'Body da pattinaggio velocità manica corta': ('Body pattinaggio velocità manica corta', 'Short-sleeve speed skating suit', 'Combinaison patinage de vitesse manches courtes', 'Speedskating-Einteiler kurzarm', 'Mono de patinaje de velocidad manga corta'),
 'Body manica corta atletica': ('Body atletica manica corta', 'Short-sleeve athletics suit', 'Combinaison athlétisme manches courtes', 'Leichtathletik-Einteiler kurzarm', 'Mono de atletismo manga corta'),
 'Body manica corta con zip corta': ('Body manica corta con zip corta', 'Short-sleeve suit with short zip', 'Trifonction manches courtes zip court', 'Einteiler kurzarm mit kurzem Reißverschluss', 'Mono manga corta con cremallera corta'),
 'Body manica corta con zip divisibile': ('Body manica corta con zip divisibile', 'Short-sleeve suit with full-length zip', 'Trifonction manches courtes zip intégral', 'Einteiler kurzarm mit durchgehendem Reißverschluss', 'Mono manga corta con cremallera completa'),
 'Body pattinaggio manica corta': ('Body pattinaggio manica corta', 'Short-sleeve skating suit', 'Combinaison patinage manches courtes', 'Skating-Einteiler kurzarm', 'Mono de patinaje manga corta'),
 'Body senza manica con zip posteriore': ('Body senza maniche con zip posteriore', 'Sleeveless suit with back zip', 'Trifonction sans manches zip dans le dos', 'Ärmelloser Einteiler mit Rückenreißverschluss', 'Mono sin mangas con cremallera trasera'),
 'Body smanicato': ('Body smanicato', 'Sleeveless rowing suit', 'Combinaison d\'aviron sans manches', 'Ärmelloser Ruderanzug', 'Mono de remo sin mangas'),
 'Body triathlon senza maniche con zip corta': ('Body triathlon senza maniche con zip corta', 'Sleeveless triathlon suit with short zip', 'Trifonction sans manches zip court', 'Ärmelloser Triathlon-Einteiler mit kurzem Reißverschluss', 'Mono de triatlón sin mangas con cremallera corta'),
 'CYCLE-01 - Men’s aerodynamic skinsuit': ('CYCLE-01 · Body aerodinamico', 'CYCLE-01 · Aerodynamic skinsuit', 'CYCLE-01 · Combinaison aérodynamique', 'CYCLE-01 · Aero-Einteiler', 'CYCLE-01 · Mono aerodinámico'),
 'Calzamaglia': ('Calzamaglia', 'Tights', 'Collant', 'Tights', 'Mallas'),
 'Canotta': ('Canotta', 'Singlet', 'Débardeur', 'Singlet', 'Camiseta de tirantes'),
 'Canottiera aderente': ('Canottiera aderente', 'Fitted tank top', 'Débardeur ajusté', 'Enges Tanktop', 'Camiseta de tirantes ajustada'),
 'Costume maniche corte': ('Costume maniche corte', 'Short-sleeve swimsuit', 'Maillot de bain manches courtes', 'Badeanzug kurzarm', 'Bañador manga corta'),
 'Costume senza maniche': ('Costume senza maniche', 'Sleeveless swimsuit', 'Maillot de bain sans manches', 'Ärmelloser Badeanzug', 'Bañador sin mangas'),
 'Full-zip short-sleeve jersey': ('Maglia manica corta zip intera', 'Full-zip short-sleeve jersey', 'Maillot manches courtes zip intégral', 'Kurzarmtrikot mit durchgehendem Reißverschluss', 'Maillot manga corta cremallera completa'),
 'Fuseaux 3/4': ('Fuseaux 3/4', '3/4 tights', 'Corsaire 3/4', '3/4-Tights', 'Mallas 3/4'),
 'Fuseaux lungo': ('Fuseaux lungo', 'Long tights', 'Collant long', 'Lange Tights', 'Mallas largas'),
 'Giacca antivento': ('Giacca antivento', 'Windproof jacket', 'Veste coupe-vent', 'Windjacke', 'Chaqueta cortavientos'),
 'Gilet estivo (tessuto antivento dietro, elastico davanti)': ('Gilet estivo (antivento dietro, elastico davanti)', 'Summer gilet (windproof back, stretch front)', 'Gilet été (dos coupe-vent, devant élastique)', 'Sommerweste (Rücken winddicht, Front elastisch)', 'Chaleco de verano (espalda cortavientos, delantero elástico)'),
 'Gilet invernale (dietro in tessuto Windtex, davanti Roubaix)': ('Gilet invernale (dietro Windtex, davanti Roubaix)', 'Winter gilet (Windtex back, Roubaix front)', 'Gilet hiver (dos Windtex, devant Roubaix)', 'Winterweste (Rücken Windtex, Front Roubaix)', 'Chaleco de invierno (espalda Windtex, delantero Roubaix)'),
 'Gilet invernale (tutto in tessuto invernale Windtex)': ('Gilet invernale (tutto Windtex)', 'Winter gilet (full Windtex)', 'Gilet hiver (entièrement Windtex)', 'Winterweste (komplett Windtex)', 'Chaleco de invierno (todo Windtex)'),
 'Gilet leggero antivento': ('Gilet leggero antivento', 'Lightweight windproof gilet', 'Gilet coupe-vent léger', 'Leichte Windweste', 'Chaleco cortavientos ligero'),
 'Jacket': ('Giacca', 'Jacket', 'Veste', 'Jacke', 'Chaqueta'),
 'Long-sleeve skinsuit': ('Body manica lunga', 'Long-sleeve skinsuit', 'Combinaison manches longues', 'Langarm-Einteiler', 'Mono manga larga'),
 'Long-sleeved T-shirt': ('T-shirt manica lunga', 'Long-sleeved T-shirt', 'T-shirt manches longues', 'Langarm-T-Shirt', 'Camiseta manga larga'),
 'Long-sleeved jersey': ('Maglia manica lunga', 'Long-sleeved jersey', 'Maillot manches longues', 'Langarmtrikot', 'Maillot manga larga'),
 'Maglia a maniche corte': ('Maglia manica corta', 'Short-sleeve top', 'Maillot manches courtes', 'Kurzarmshirt', 'Camiseta manga corta'),
 'Maglia a maniche lunghe': ('Maglia manica lunga', 'Long-sleeve top', 'Maillot manches longues', 'Langarmshirt', 'Camiseta manga larga'),
 'Maglia a maniche lunghe con zip corta': ('Maglia manica lunga con zip corta', 'Long-sleeve top with short zip', 'Maillot manches longues zip court', 'Langarmshirt mit kurzem Reißverschluss', 'Camiseta manga larga con cremallera corta'),
 'Maglia manica lunga termica con zip corta': ('Maglia termica manica lunga con zip corta', 'Thermal long-sleeve top with short zip', 'Maillot thermique manches longues zip court', 'Thermo-Langarmshirt mit kurzem Reißverschluss', 'Camiseta térmica manga larga con cremallera corta'),
 'Mantellina leggera antivento': ('Mantellina leggera antivento', 'Lightweight windproof jacket', 'Veste coupe-vent légère', 'Leichte Windjacke', 'Chaqueta cortavientos ligera'),
 'Midweight short-sleeved jersey': ('Maglia manica corta mezza stagione', 'Midweight short-sleeved jersey', 'Maillot manches courtes mi-saison', 'Kurzarmtrikot Übergang', 'Maillot manga corta entretiempo'),
 'Pantaloncini con perizoma': ('Pantaloncini con perizoma', 'Shorts with thong brief', 'Short avec string intégré', 'Shorts mit String-Innenslip', 'Pantalón corto con tanga interior'),
 'Pantaloncini con slip': ('Pantaloncini con slip', 'Shorts with brief', 'Short avec slip', 'Shorts mit Innenslip', 'Pantalón corto con slip'),
 'Pantaloncini elasticizzati': ('Pantaloncini elasticizzati', 'Stretch shorts', 'Short élastique', 'Elastische Shorts', 'Pantalón corto elástico'),
 'Pantaloncini senza slip': ('Pantaloncini senza slip', 'Shorts without brief', 'Short sans slip', 'Shorts ohne Innenslip', 'Pantalón corto sin slip'),
 'Pantaloncino 2-in-1': ('Pantaloncino 2-in-1', '2-in-1 shorts', 'Short 2 en 1', '2-in-1-Shorts', 'Pantalón corto 2 en 1'),
 'Pantaloncino con slip interno': ('Pantaloncino con slip interno', 'Shorts with inner brief', 'Short avec slip intérieur', 'Shorts mit Innenslip', 'Pantalón corto con slip interior'),
 'Pantaloncino senza bretelle': ('Pantaloncino senza bretelle', 'Shorts without straps', 'Cuissard sans bretelles', 'Shorts ohne Träger', 'Pantalón corto sin tirantes'),
 'Pantaloni da riscaldamento': ('Pantaloni da riscaldamento', 'Warm-up trousers', 'Pantalon d\'échauffement', 'Aufwärmhose', 'Pantalón de calentamiento'),
 'Pantaloni da riscaldamento invernali': ('Pantaloni da riscaldamento invernali', 'Winter warm-up trousers', 'Pantalon d\'échauffement hiver', 'Winter-Aufwärmhose', 'Pantalón de calentamiento de invierno'),
 'Printed long-sleeved Chronosuit': ('Body crono manica lunga stampato', 'Printed long-sleeved chronosuit', 'Combinaison chrono manches longues imprimée', 'Bedruckter Zeitfahranzug langarm', 'Mono contrarreloj manga larga estampado'),
 'Reggiseno sportivo': ('Reggiseno sportivo', 'Sports bra', 'Brassière de sport', 'Sport-BH', 'Sujetador deportivo'),
 'Short-sleeve jersey': ('Maglia manica corta', 'Short-sleeve jersey', 'Maillot manches courtes', 'Kurzarmtrikot', 'Maillot manga corta'),
 'Short-sleeve skinsuit': ('Body manica corta', 'Short-sleeve skinsuit', 'Combinaison manches courtes', 'Kurzarm-Einteiler', 'Mono manga corta'),
 'Short-sleeved Road racesuit': ('Body strada manica corta', 'Short-sleeved road racesuit', 'Combinaison route manches courtes', 'Straßen-Rennanzug kurzarm', 'Mono de carretera manga corta'),
 'Short-sleeved T-shirt': ('T-shirt manica corta', 'Short-sleeved T-shirt', 'T-shirt manches courtes', 'Kurzarm-T-Shirt', 'Camiseta manga corta'),
 'Short-sleeved jersey': ('Maglia manica corta', 'Short-sleeved jersey', 'Maillot manches courtes', 'Kurzarmtrikot', 'Maillot manga corta'),
 'Short-sleeved jersey with zip': ('Maglia manica corta con zip', 'Short-sleeved jersey with zip', 'Maillot manches courtes zippé', 'Kurzarmtrikot mit Reißverschluss', 'Maillot manga corta con cremallera'),
 'Short-sleeved waterproof jacket': ('Giacca impermeabile manica corta', 'Short-sleeved waterproof jacket', 'Veste imperméable manches courtes', 'Wasserdichte Kurzarmjacke', 'Chaqueta impermeable manga corta'),
 'Short-sleeved zipped jersey': ('Maglia manica corta con zip', 'Short-sleeved zipped jersey', 'Maillot manches courtes zippé', 'Kurzarmtrikot mit Reißverschluss', 'Maillot manga corta con cremallera'),
 'Shorts': ('Shorts', 'Shorts', 'Short', 'Shorts', 'Pantalón corto'),
 'Shorts without bib straps': ('Pantaloncino senza bretelle', 'Shorts without bib straps', 'Cuissard sans bretelles', 'Radhose ohne Träger', 'Culotte sin tirantes'),
 'Silicon logos long-sleeved Chronosuit': ('Body crono manica lunga con loghi in silicone', 'Long-sleeved chronosuit with silicone logos', 'Combinaison chrono manches longues logos silicone', 'Zeitfahranzug langarm mit Silikonlogos', 'Mono contrarreloj manga larga con logos de silicona'),
 'Silicon logos short-sleeved Chronosuit': ('Body crono manica corta con loghi in silicone', 'Short-sleeved chronosuit with silicone logos', 'Combinaison chrono manches courtes logos silicone', 'Zeitfahranzug kurzarm mit Silikonlogos', 'Mono contrarreloj manga corta con logos de silicona'),
 'Sleeveless jersey': ('Maglia smanicata', 'Sleeveless jersey', 'Maillot sans manches', 'Ärmelloses Trikot', 'Maillot sin mangas'),
 'T-Shirt a maniche lunghe con collo rotondo': ('T-shirt manica lunga girocollo', 'Long-sleeve crew-neck T-shirt', 'T-shirt manches longues col rond', 'Langarm-T-Shirt Rundhals', 'Camiseta manga larga cuello redondo'),
 'T-shirt manica corta collo a V': ('T-shirt manica corta collo a V', 'Short-sleeve V-neck T-shirt', 'T-shirt manches courtes col en V', 'Kurzarm-T-Shirt mit V-Ausschnitt', 'Camiseta manga corta cuello en V'),
 'T-shirt manica corta collo a giro': ('T-shirt manica corta girocollo', 'Short-sleeve crew-neck T-shirt', 'T-shirt manches courtes col rond', 'Kurzarm-T-Shirt Rundhals', 'Camiseta manga corta cuello redondo'),
 'T-shirt manica lunga leggera': ('T-shirt manica lunga leggera', 'Lightweight long-sleeve T-shirt', 'T-shirt manches longues légère', 'Leichtes Langarm-T-Shirt', 'Camiseta manga larga ligera'),
 'T-shirt manica lunga termica': ('T-shirt manica lunga termica', 'Thermal long-sleeve T-shirt', 'T-shirt thermique manches longues', 'Thermo-Langarm-T-Shirt', 'Camiseta térmica manga larga'),
 'Thermal 3/4 bibshorts': ('Salopette 3/4 termica', 'Thermal 3/4 bib knickers', 'Corsaire thermique à bretelles', 'Thermo-3/4-Trägerhose', 'Culotte 3/4 térmico con tirantes'),
 'Thermal bib shorts': ('Salopette termica', 'Thermal bib shorts', 'Cuissard thermique à bretelles', 'Thermo-Trägerhose kurz', 'Culotte térmico con tirantes'),
 'Tights': ('Calzamaglia senza bretelle', 'Tights', 'Collant', 'Lange Radhose', 'Mallas'),
 'Top': ('Top', 'Top', 'Top', 'Top', 'Top'),
 'Water repellent long-sleeved jersey': ('Maglia manica lunga idrorepellente', 'Water-repellent long-sleeved jersey', 'Maillot manches longues déperlant', 'Wasserabweisendes Langarmtrikot', 'Maillot manga larga hidrófugo'),
 'Windproof jacket': ('Giacca antivento', 'Windproof jacket', 'Veste coupe-vent', 'Windjacke', 'Chaqueta cortavientos'),
 'Windproof vest': ('Gilet antivento', 'Windproof gilet', 'Gilet coupe-vent', 'Windweste', 'Chaleco cortavientos'),
 'Winter jacket': ('Giacca invernale', 'Winter jacket', 'Veste hiver', 'Winterjacke', 'Chaqueta de invierno'),
 # accessori (ciclismo)
 'Summer gloves': ('Guanti estivi', 'Summer gloves', 'Gants été', 'Sommerhandschuhe', 'Guantes de verano'),
 'Full fingers summer gloves': ('Guanti estivi dita lunghe', 'Full-finger summer gloves', 'Gants été doigts longs', 'Langfinger-Sommerhandschuhe', 'Guantes de verano dedos largos'),
 'Winter gloves': ('Guanti invernali', 'Winter gloves', 'Gants hiver', 'Winterhandschuhe', 'Guantes de invierno'),
 'Winter arm warmers': ('Manicotti invernali', 'Winter arm warmers', 'Manchettes hiver', 'Winter-Armlinge', 'Manguitos de invierno'),
 'Winter fully printed arm warmers': ('Manicotti invernali stampati', 'Fully printed winter arm warmers', 'Manchettes hiver imprimées', 'Bedruckte Winter-Armlinge', 'Manguitos de invierno estampados'),
 'Winter leg warmers': ('Gambali invernali', 'Winter leg warmers', 'Jambières hiver', 'Winter-Beinlinge', 'Perneras de invierno'),
 'Winter fully printed leg warmers': ('Gambali invernali stampati', 'Fully printed winter leg warmers', 'Jambières hiver imprimées', 'Bedruckte Winter-Beinlinge', 'Perneras de invierno estampadas'),
 'Neck tube': ('Scaldacollo', 'Neck tube', 'Tour de cou', 'Halstuch', 'Braga de cuello'),
 'Air-cap': ('Cappellino Air-cap', 'Air-cap', 'Casquette Air-cap', 'Air-Cap', 'Gorra Air-cap'),
 'Summer socks (13 cm high cuff)': ('Calze estive (polsino 13 cm)', 'Summer socks (13 cm cuff)', 'Chaussettes été (tige 13 cm)', 'Sommersocken (13 cm Bund)', 'Calcetines de verano (puño 13 cm)'),
 'Summer socks (18 cm high cuff)': ('Calze estive (polsino 18 cm)', 'Summer socks (18 cm cuff)', 'Chaussettes été (tige 18 cm)', 'Sommersocken (18 cm Bund)', 'Calcetines de verano (puño 18 cm)'),
 'Aero summer socks (black feet)': ('Calze aero estive (piede nero)', 'Aero summer socks (black foot)', 'Chaussettes aéro été (pied noir)', 'Aero-Sommersocken (schwarzer Fuß)', 'Calcetines aero de verano (pie negro)'),
 'Aero summer socks (white feet)': ('Calze aero estive (piede bianco)', 'Aero summer socks (white foot)', 'Chaussettes aéro été (pied blanc)', 'Aero-Sommersocken (weißer Fuß)', 'Calcetines aero de verano (pie blanco)'),
}
L = ['it', 'en', 'fr', 'de', 'es']
MEN = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL']
WOMEN = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL']

# Listino Excel TEAM RUNNING 2027: fasce 10/30/60 -> codici catalogo
RUN_PRICES = {
 ('RUN-22', 34.2, 32.5, 31.4): ['W7100', 'W7103'], ('RUN-28', 33.8, 32.3, 31.2): ['W7114', 'W7116'],
 ('RUN-34', 27.7, 26.4, 25.6): ['W7101', 'W7104'], ('RUN-40', 50.3, 47.9, 46.3): ['W2901', 'W2930'],
 ('RUN-46', 45.3, 43.2, 41.8): ['W7106', 'W7109'], ('RUN-52', 36.6, 34.9, 33.6): ['W7107', 'W7110'],
 ('RUN-58', 28.9, 27.7, 26.8): ['W7118'], ('RUN-63', 31.1, 29.9, 29.0): ['W7119'],
 ('RUN-68', 50.5, 48.5, 47.0): ['W7108', 'W7111'], ('RUN-74', 38.5, 36.9, 35.8): ['W3701', 'W3705'],
 ('RUN-80', 34.0, 32.6, 31.6): ['W2919', 'W2915'], ('RUN-86', 42.8, 41.2, 40.0): ['W7112', 'W7113'],
 ('RUN-92', 45.6, 43.8, 42.5): ['W7102', 'W7115'], ('RUN-98', 59.5, 57.2, 55.6): ['W7015'],
 ('RUN-103', 42.0, 40.0, 38.0): ['W7105'], ('RUN-108', 43.9, 42.1, 40.9): ['W2912', 'W2913'],
 ('RUN-114', 53.0, 50.6, 49.2): ['W7901'], ('RUN-120', 31.6, 30.1, 29.0): ['W7120'], ('RUN-122', 30.3, 29.1, 28.3): ['W2948'],
}
price_of = {}
for (ref, w, x, y), codes in RUN_PRICES.items():
    for c in codes: price_of[c] = (ref, [{'min': 10, 'price': w}, {'min': 30, 'price': x}, {'min': 60, 'price': y}])

def clean(d):
    d = re.sub(r'\s*[-–]\s*(men’s|women’s|unisex|uomo|donna)\s*$', '', d, flags=re.I)
    d = re.sub(r'\s+(uomo|donna|da ragazzi|BAMBINO/RAGAZZO|BAMBINO)\s*$', '', d, flags=re.I)
    return re.sub(r'\s+', ' ', d).strip()

def category(en):
    d = en.lower()
    if re.search(r'gloves|warmers|socks|neck tube|air-cap', d): return 'accessory'
    if re.search(r'skinsuit|chronosuit|racesuit|\bsuit\b|swimsuit', d): return 'body'
    if re.search(r'jacket|gilet|\bvest\b', d): return 'outer'
    if re.search(r'\bbib\b|\bshorts\b|tights|trousers|knickers|\bpants\b', d): return 'bottom'
    return 'top'

out = []; order = {}
for p in P:
    sport, code, model, desc = p['sport'], p['code'], p['model'], p['desc']
    raw = desc
    if desc.lower() == 'unisex':  # accessori: "W6604 - Summer gloves - unisex"
        desc, model = model, ''
    kids = bool(re.search(r'ragazz|bambino|kid', raw + ' ' + (p['size_label'] or ''), re.I)) or (sport == 'cycling' and code.startswith('W22'))
    low = raw.lower()
    if kids: gender = 'unisex'
    elif re.search(r'women|donna', low) or (sport == 'triathlon' and 'DONNA' in (p['size_label'] or '')): gender = 'women'
    elif re.search(r'men’s|men\'s|\buomo\b', low) or 'UOMO' in (p['size_label'] or ''): gender = 'men'
    else: gender = 'unisex'
    d = clean(desc)
    if kids and not model and sport == 'cycling': model = 'KID'
    tr = T.get(d)
    if not tr: raise SystemExit('Traduzione mancante: ' + repr(d))
    name = {l: ((model + ' · ') if model else '') + tr[i] for i, l in enumerate(L)}
    sizes = p['sizes']
    if not sizes:
        if kids: sizes = ['104', '116', '128', '140', '152', '164'] if sport == 'cycling' else ['128', '140', '152', '164']
        elif 'sock' in d.lower(): sizes = ['XS', 'S', 'M', 'L']
        elif 'Neck tube' in d: sizes = ['TU']
        elif 'Air-cap' in d: sizes = ['S/M', 'L/XL']
        elif gender == 'women': sizes = WOMEN
        else: sizes = MEN
    order[sport] = order.get(sport, 0) + 1
    ref, tiers = price_of.get(code, (None, [])) if sport == 'running' else (None, [])
    out.append({
        'id': f'p-{sport}-{code.lower()}', 'sport_id': sport, 'sku': code, 'name': name,
        'category': category(tr[1]), 'gender': gender, 'kids': kids, 'sizes': sizes, 'tiers': tiers,
        'active': True, 'sort': order[sport], 'image': p['image'] or '',
        'notes': (f'Prezzi dal listino Excel Team Running 2027 (riga {ref.split("-")[1]}). ' if ref else '') + f'Catalogo pag. {p["page"]}.'
    })
missing = [c for c in price_of if c not in {o['sku'] for o in out if o['sport_id'] == 'running'}]
assert not missing, missing
js = '/* Generato da tools/build_catalog.py a partire dai cataloghi PDF Bicycle Line. */\nwindow.BLCatalog = ' + json.dumps(out, ensure_ascii=False, indent=0) + ';\n'
open('js/catalog-data.js', 'w').write(js)
from collections import Counter
print(len(out), Counter(o['sport_id'] for o in out), 'con prezzo:', sum(1 for o in out if o['tiers']))
