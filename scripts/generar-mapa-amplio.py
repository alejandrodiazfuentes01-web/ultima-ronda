"""
Genera el mapa de prueba «amplio» a partir del mapa normal: el mismo trazado
con más espacio libre en planta (x y z), y la misma altura.

No escala a lo bruto: alrededor de cada línea de muro (y del bloque central)
deja una franja sin estirar, para que lo que está pegado a la pared (estaciones,
panel, taquillas, puntos de uso) siga pegado. El espacio entre franjas se estira.

Uso:  python3 scripts/generar-mapa-amplio.py [factor=1.5]
Lee shared/data/maps/prototipo.json y escribe shared/data/maps/amplio.json.
"""
import json
import sys

FACTOR = float(sys.argv[1]) if len(sys.argv) > 1 else 1.5
BAND = 1.2  # metros sin estirar a cada lado de una línea de muro
SRC = 'shared/data/maps/prototipo.json'
DST = 'shared/data/maps/amplio.json'


def make_warp(lines):
    """Función por tramos: cada línea se mueve a línea*FACTOR; cerca de ella solo se traslada."""
    lines = sorted(set(lines))
    new = {l: l * FACTOR for l in lines}

    def f(v):
        # Antes de la primera o después de la última línea: solo traslación.
        if v <= lines[0]:
            return new[lines[0]] + (v - lines[0])
        if v >= lines[-1]:
            return new[lines[-1]] + (v - lines[-1])
        for a, b in zip(lines, lines[1:]):
            if a <= v <= b:
                if v - a <= BAND:
                    return new[a] + (v - a)
                if b - v <= BAND:
                    return new[b] - (b - v)
                # Tramo libre: se estira para llenar el hueco nuevo.
                t = (v - (a + BAND)) / ((b - BAND) - (a + BAND))
                return (new[a] + BAND) + t * ((new[b] - BAND) - (new[a] + BAND))
        raise ValueError(v)

    return f


def main():
    m = json.load(open(SRC))
    # Líneas de muro: centros de los muros finos y bordes del bloque central.
    xs, zs = set(), set()
    for x0, _, z0, x1, _, z1 in m['walls']:
        if x1 - x0 <= 0.6:
            xs.add(round((x0 + x1) / 2, 3))
        if z1 - z0 <= 0.6:
            zs.add(round((z0 + z1) / 2, 3))
        if x1 - x0 > 0.6 and z1 - z0 > 0.6:  # bloque macizo: sus cuatro bordes
            xs.update([x0, x1])
            zs.update([z0, z1])
    fx, fz = make_warp(xs), make_warp(zs)

    def box(b):
        return [round(fx(b[0]), 3), b[1], round(fz(b[2]), 3), round(fx(b[3]), 3), b[4], round(fz(b[5]), 3)]

    def rect(r):
        return [round(fx(r[0]), 3), round(fz(r[1]), 3), round(fx(r[2]), 3), round(fz(r[3]), 3)]

    def pt(p):
        return [round(fx(p[0]), 3), round(fz(p[1]), 3)]

    out = dict(m)
    out['name'] = m['name'] + '-amplio'
    out['floor'] = box(m['floor'])
    out['walls'] = [box(b) for b in m['walls']]
    out['windows'] = [dict(w, opening=rect(w['opening']), inside=pt(w['inside']), outside=pt(w['outside']), spawn=pt(w['spawn'])) for w in m['windows']]
    out['doors'] = [dict(d, box=box(d['box']), anchors=[pt(a) for a in d['anchors']]) for d in m['doors']]
    out['wallBuys'] = [dict(b, anchor=pt(b['anchor'])) for b in m['wallBuys']]
    sx, sy, sz = m['playerStart']['position']
    out['playerStart'] = dict(m['playerStart'], position=[round(fx(sx), 3), sy, round(fz(sz), 3)])
    out['navFloors'] = [rect(r) for r in m['navFloors']]
    out['labArea'] = rect(m['labArea'])
    fix = lambda f: dict(f, anchor=pt(f['anchor']), box=box(f['box']))
    out['powerSwitch'] = fix(m['powerSwitch'])
    out['perkStations'] = [fix(s) for s in m['perkStations']]
    out['forja'] = fix(m['forja'])
    out['contenedorSpots'] = [fix(s) for s in m['contenedorSpots']]
    out['decor'] = [dict(d, box=box(d['box'])) for d in m['decor']]
    with open(DST, 'w') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print('líneas x:', sorted(xs), '\nlíneas z:', sorted(zs))


if __name__ == '__main__':
    main()
