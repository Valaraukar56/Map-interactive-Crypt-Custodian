"""
Parser pour les saves de Crypt Custodian (.sav).

Format observé :
- Fichier = chaîne ASCII de chars hex (chaque paire de chars = 1 byte)
- Une fois hex-décodé : structure binaire de ds_map sérialisé
- Header : u32 (version?) + u32 (nb entrées)
- Chaque entrée : u32 type1, u32 key_len, key_bytes,
                  u32 type2, u32 value_len, value_bytes
- Beaucoup de values sont elles-mêmes des chaînes hex (sous-maps imbriquées)

Usage :
    python parse_save.py [path/to/.sav]
"""
import struct
import json
import re
import sys
from pathlib import Path

SAVE_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "save_sample.sav"


def load_save(path):
    with open(path, 'r') as f:
        raw = f.read().strip()
    if len(raw) % 2 != 0:
        raw = raw[:-1]
    return bytes.fromhex(raw)


def u32(data, off):
    return struct.unpack_from('<I', data, off)[0]


def parse_map(data):
    """Parse une ds_map sérialisée. Retourne dict { key: (type, value) }."""
    out = {}
    if len(data) < 8:
        return out
    # Header : on a vu 0x193 (peut être un version tag) + count
    # On scanne en supposant : u32 type1, u32 keylen, key, u32 type2, u32 vlen, value
    count = u32(data, 4)
    off = 8
    for _ in range(count):
        if off + 8 > len(data): break
        type1 = u32(data, off); off += 4
        klen = u32(data, off); off += 4
        if off + klen > len(data): break
        key = data[off:off+klen].decode('utf-8', errors='replace'); off += klen
        if off + 8 > len(data): break
        type2 = u32(data, off); off += 4
        vlen = u32(data, off); off += 4
        if off + vlen > len(data): break
        value_bytes = data[off:off+vlen]; off += vlen
        out[key] = (type2, value_bytes)
    return out


def try_decode_nested(value_bytes):
    """Si la value est une chaîne hex, retourne les bytes décodés. Sinon None."""
    try:
        s = value_bytes.decode('ascii')
        if not s or len(s) % 2 != 0:
            return None
        if not all(c in '0123456789abcdefABCDEF' for c in s):
            return None
        return bytes.fromhex(s)
    except (UnicodeDecodeError, ValueError):
        return None


def try_decode_string(value_bytes):
    """Essaie de décoder comme string UTF-8 simple."""
    try:
        s = value_bytes.decode('utf-8')
        if all(c.isprintable() or c in '\n\r\t' for c in s):
            return s
    except UnicodeDecodeError:
        pass
    return None


def parse_value(type_tag, value_bytes):
    """Décode une value selon son type tag."""
    # On regarde d'abord si c'est du hex (sous-map)
    nested = try_decode_nested(value_bytes)
    if nested is not None and len(nested) >= 8:
        sub = parse_map(nested)
        if sub:
            return ('map', sub)
    # Essai chaîne UTF-8
    s = try_decode_string(value_bytes)
    if s is not None:
        # Essai JSON (les teleporters, map markers, etc.)
        try:
            j = json.loads(s)
            return ('json', j)
        except json.JSONDecodeError:
            pass
        return ('str', s)
    # Essai u32 simple
    if len(value_bytes) == 4:
        return ('u32', u32(value_bytes, 0))
    # Essai double (8 bytes)
    if len(value_bytes) == 8:
        try:
            d = struct.unpack('<d', value_bytes)[0]
            return ('f64', d)
        except struct.error:
            pass
    return ('raw', value_bytes)


def deep_parse(data, depth=0):
    """Parse récursif d'une ds_map sérialisée."""
    m = parse_map(data)
    out = {}
    for key, (type_tag, val_bytes) in m.items():
        kind, value = parse_value(type_tag, val_bytes)
        if kind == 'map':
            value = {k: deep_value(v) for k, v in value.items()}
        out[key] = (kind, value)
    return out


def deep_value(entry):
    type_tag, val_bytes = entry
    kind, value = parse_value(type_tag, val_bytes)
    if kind == 'map':
        return {k: deep_value(v) for k, v in value.items()}
    return (kind, value)


def dump_summary(top):
    print(f"\n{'='*70}")
    print(f"  Save : {len(top)} clés top-level")
    print('='*70)
    for key, (kind, value) in top.items():
        if kind == 'map':
            print(f"\n[{key}] -> map de {len(value)} entrées")
            preview = list(value.items())[:10]
            for k, v in preview:
                v_str = format_value(v)
                print(f"    {k!r:40s} = {v_str}")
            if len(value) > 10:
                print(f"    ... et {len(value) - 10} autres")
        elif kind == 'json':
            print(f"\n[{key}] -> JSON : {json.dumps(value)[:200]}")
        elif kind == 'str':
            print(f"\n[{key}] -> string ({len(value)} chars) : {value[:150]!r}")
        elif kind == 'u32':
            print(f"\n[{key}] -> u32 = {value}")
        elif kind == 'f64':
            print(f"\n[{key}] -> f64 = {value}")
        else:
            print(f"\n[{key}] -> raw {len(value)} bytes : {value[:32].hex()}...")


def format_value(v):
    if isinstance(v, tuple):
        kind, val = v
        if kind == 'str': return repr(val[:80])
        if kind == 'u32': return f"u32:{val}"
        if kind == 'f64': return f"f64:{val:.3f}"
        if kind == 'json': return f"json:{json.dumps(val)[:80]}"
        if kind == 'raw': return f"raw:{val[:8].hex()}..."
        return repr(val)[:80]
    if isinstance(v, dict): return f"<dict {len(v)} keys>"
    return repr(v)[:80]


def main():
    print(f"Chargement de : {SAVE_PATH}")
    data = load_save(SAVE_PATH)
    print(f"  {len(data)} bytes décodés")
    top = deep_parse(data)
    dump_summary(top)

    # Sauvegarde dans un JSON lisible
    serializable = {}
    for k, (kind, v) in top.items():
        if kind == 'map':
            serializable[k] = {kk: serialize_v(vv) for kk, vv in v.items()}
        else:
            serializable[k] = serialize_v((kind, v))
    out_path = Path(__file__).parent / "save_parsed.json"
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(serializable, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nJSON complet écrit : {out_path}")


def serialize_v(v):
    if isinstance(v, tuple):
        kind, val = v
        if kind == 'raw':
            return f"raw:{val.hex()[:64]}..."
        if isinstance(val, bytes):
            return val.hex()
        return val
    if isinstance(v, dict):
        return {k: serialize_v(vv) for k, vv in v.items()}
    return v


if __name__ == "__main__":
    main()
