"""
Prepara un modelo .glb generado (Meshy) para el juego: reduce sus texturas a
un tamaño máximo y las vuelve a comprimir en JPEG. La geometría no se toca.

Uso:  python3 scripts/optimizar-modelo.py ENTRADA.glb SALIDA.glb [lado_max=512] [calidad=80]

Necesita Python 3 y Pillow. Es una herramienta de producción de assets: el
juego no la usa al ejecutarse.
"""
import io
import json
import struct
import sys

from PIL import Image


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, _ = struct.unpack('<4sII', data[:12])
    if magic != b'glTF' or version != 2:
        raise SystemExit(f'{path}: no es un glTF binario 2.0')
    off = 12
    doc, binary = None, b''
    while off < len(data):
        length, kind = struct.unpack('<I4s', data[off:off + 8])
        chunk = data[off + 8:off + 8 + length]
        if kind == b'JSON':
            doc = json.loads(chunk)
        elif kind == b'BIN\x00':
            binary = chunk
        off += 8 + length
    return doc, binary


def write_glb(path, doc, binary):
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    binary += b'\x00' * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON') + js)
        f.write(struct.pack('<I4s', len(binary), b'BIN\x00') + binary)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    max_side = int(sys.argv[3]) if len(sys.argv) > 3 else 512
    quality = int(sys.argv[4]) if len(sys.argv) > 4 else 80
    doc, binary = read_glb(src)

    # Recodifica cada imagen.
    new_bytes = {}
    for img in doc.get('images', []):
        bv = img['bufferView']
        view = doc['bufferViews'][bv]
        start = view.get('byteOffset', 0)
        raw = binary[start:start + view['byteLength']]
        im = Image.open(io.BytesIO(raw)).convert('RGB')
        im.thumbnail((max_side, max_side), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, 'JPEG', quality=quality, optimize=True)
        new_bytes[bv] = out.getvalue()
        img['mimeType'] = 'image/jpeg'

    # Reconstruye el búfer binario con las vistas en orden.
    out = bytearray()
    for i, view in enumerate(doc['bufferViews']):
        if i in new_bytes:
            chunk = new_bytes[i]
        else:
            start = view.get('byteOffset', 0)
            chunk = binary[start:start + view['byteLength']]
        out += b'\x00' * ((4 - len(out) % 4) % 4)
        view['byteOffset'] = len(out)
        view['byteLength'] = len(chunk)
        view['buffer'] = 0
        out += chunk
    doc['buffers'] = [{'byteLength': len(out)}]
    write_glb(dst, doc, bytes(out))


if __name__ == '__main__':
    main()
