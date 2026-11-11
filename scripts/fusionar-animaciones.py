"""
Junta en un solo .glb un personaje con esqueleto y las animaciones de otros
.glb que usan el mismo esqueleto (las que entrega Meshy, una por archivo).

Además deja las animaciones «en el sitio»: quita el desplazamiento horizontal
de la cadera, porque al personaje lo mueve la simulación, no la animación.

Uso:
  python3 scripts/fusionar-animaciones.py PERSONAJE.glb SALIDA.glb nombre=anim.glb [nombre=anim.glb ...]

Herramienta de producción de assets: el juego no la usa al ejecutarse.
"""
import json
import struct
import sys

ROOT_BONE = 'Hips'
COMPONENTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    data = open(path, 'rb').read()
    off, doc, binary = 12, None, b''
    while off < len(data):
        length, kind = struct.unpack('<I4s', data[off:off + 8])
        chunk = data[off + 8:off + 8 + length]
        if kind == b'JSON':
            doc = json.loads(chunk)
        elif kind == b'BIN\x00':
            binary = chunk
        off += 8 + length
    return doc, bytearray(binary)


def write_glb(path, doc, binary):
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    binary = bytes(binary) + b'\x00' * ((4 - len(binary) % 4) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(binary)))
        f.write(struct.pack('<I4s', len(js), b'JSON') + js)
        f.write(struct.pack('<I4s', len(binary), b'BIN\x00') + binary)


def accessor_bytes(doc, binary, idx):
    acc = doc['accessors'][idx]
    view = doc['bufferViews'][acc['bufferView']]
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    size = acc['count'] * COMPONENTS[acc['type']] * 4  # las animaciones usan float32
    stride = view.get('byteStride')
    if stride and stride != COMPONENTS[acc['type']] * 4:
        raise SystemExit('Accesor intercalado: no soportado')
    return acc, bytes(binary[start:start + size])


def append_accessor(doc, binary, acc, raw):
    while len(binary) % 4:
        binary.append(0)
    doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(raw)})
    binary.extend(raw)
    new = {k: v for k, v in acc.items() if k not in ('bufferView', 'byteOffset')}
    new['bufferView'] = len(doc['bufferViews']) - 1
    doc['accessors'].append(new)
    return len(doc['accessors']) - 1


def in_place(raw, count):
    """Fija x y z de la traslación de la cadera al valor del primer fotograma."""
    vals = list(struct.unpack(f'<{count * 3}f', raw))
    x0, z0 = vals[0], vals[2]
    for i in range(count):
        vals[i * 3] = x0
        vals[i * 3 + 2] = z0
    return struct.pack(f'<{count * 3}f', *vals)


def main():
    base_path, out_path, pairs = sys.argv[1], sys.argv[2], sys.argv[3:]
    doc, binary = read_glb(base_path)
    doc['animations'] = []
    names = {n.get('name'): i for i, n in enumerate(doc['nodes'])}
    for pair in pairs:
        clip, path = pair.split('=', 1)
        src, sbin = read_glb(path)
        anim = src['animations'][0]
        samplers, channels = [], []
        for ch in anim['channels']:
            node_name = src['nodes'][ch['target']['node']].get('name')
            if node_name not in names:
                continue
            sm = anim['samplers'][ch['sampler']]
            in_acc, in_raw = accessor_bytes(src, sbin, sm['input'])
            out_acc, out_raw = accessor_bytes(src, sbin, sm['output'])
            if node_name == ROOT_BONE and ch['target']['path'] == 'translation':
                out_raw = in_place(out_raw, out_acc['count'])
            samplers.append({
                'input': append_accessor(doc, binary, in_acc, in_raw),
                'output': append_accessor(doc, binary, out_acc, out_raw),
                'interpolation': sm.get('interpolation', 'LINEAR'),
            })
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': names[node_name], 'path': ch['target']['path']}})
        doc['animations'].append({'name': clip, 'samplers': samplers, 'channels': channels})
        print(f'{clip}: {len(channels)} pistas')
    doc['buffers'] = [{'byteLength': len(binary)}]
    write_glb(out_path, doc, binary)


if __name__ == '__main__':
    main()
