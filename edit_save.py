"""
Editeur basique de save Crypt Custodian.
Modifie des compteurs (garbage, upgrade_points, etc.) directement dans le .sav.

Usage :
    python edit_save.py                       # affiche les valeurs actuelles
    python edit_save.py garbage 99999         # mettre garbage à 99999
    python edit_save.py upgrade_points 100    # mettre upgrade_points à 100
    python edit_save.py stickers 10           # etc.

Backup automatique : <save>.bak avant modification.

ATTENTION :
- Le jeu doit etre FERMÉ (sinon il écrase tes changements à la prochaine sauvegarde)
- Ne modifie que les keys numériques connues, pas n'importe quoi
"""
import struct
import sys
import shutil
from pathlib import Path

DEFAULT_SAVE = Path("C:/Users/Mathi/AppData/Local/CryptCustodian/CRYPTCUSTODIAN/CryptCustodian1.sav")

# Keys numériques sûres à modifier (toutes type double dans main)
EDITABLE_KEYS = {
    'garbage':         'Trash currency',
    'upgrade_points':  'Upgrade points (compteur cumulé)',
    'upgrade_points_current': 'Upgrade points à dépenser maintenant',
    'bought_slots':    'Slots upgrade achetés (compteur cumulé)',
    'stickers':        'Stickers',
    'player_health_max': 'Health max',
    'attack_strength': 'Attack strength',
    'specials_used':   'Specials utilisés (compteur)',
    'enemies_killed':  'Enemies killed',
    'keys':            'Keys',
    'movie_key':       'Movie key (theatre)',
    'reels':           'Reels (theatre)',
    'curses_beat':     'Curses cassées',
    'catghosts':       'Trapped spirits',
}


def u32(buf, off):
    return struct.unpack_from('<I', buf, off)[0]


def parse_save(path):
    raw = Path(path).read_text().strip()
    if len(raw) % 2 != 0: raw = raw[:-1]
    return bytes.fromhex(raw)


def find_main_offset(data):
    """Retourne (start, length) du blob hex de la section 'main' dans data."""
    off = 8
    for _ in range(8):
        t1 = u32(data, off); off += 4
        klen = u32(data, off); off += 4
        key = data[off:off+klen].decode('ascii'); off += klen
        t2 = u32(data, off); off += 4
        vlen = u32(data, off); off += 4
        if key == 'main':
            return (off, vlen)
        off += vlen
    raise RuntimeError("section 'main' introuvable")


def parse_main_with_offsets(main_bytes):
    """Retourne dict { key: (offset_in_value, current_value, type) }."""
    out = {}
    o = 8
    count = u32(main_bytes, 4)
    for _ in range(count):
        if o + 8 > len(main_bytes): break
        t1 = u32(main_bytes, o); o += 4
        klen = u32(main_bytes, o); o += 4
        key = main_bytes[o:o+klen].decode('latin-1'); o += klen
        vtype = u32(main_bytes, o); o += 4
        if vtype == 0:
            value_offset = o
            value = struct.unpack_from('<d', main_bytes, o)[0]
            o += 8
            out[key] = (value_offset, value, 'double')
        elif vtype == 1:
            slen = u32(main_bytes, o); o += 4
            value = main_bytes[o:o+slen].decode('ascii', errors='replace')
            out[key] = (o, value, 'string')
            o += slen
        else:
            break
    return out


def show_current_values(save_path):
    data = parse_save(save_path)
    main_off, main_len = find_main_offset(data)
    main_hex = data[main_off:main_off+main_len].decode('ascii')
    main_bytes = bytes.fromhex(main_hex)
    parsed = parse_main_with_offsets(main_bytes)
    print(f"\nValeurs actuelles dans {save_path.name} :\n")
    print(f"  {'key':25s} {'value':>15s}  {'description'}")
    print(f"  {'-'*25} {'-'*15}  {'-'*40}")
    for k, desc in EDITABLE_KEYS.items():
        entry = parsed.get(k)
        if entry:
            _, v, _ = entry
            print(f"  {k:25s} {v:15g}  {desc}")
        else:
            print(f"  {k:25s} {'(absent)':>15s}  {desc}")
    print(f"\n  percent (lecture seule)     = {parsed.get('percent', (0, '?', ''))[1]}")


def edit_save(save_path, key, new_value):
    if key not in EDITABLE_KEYS:
        print(f"Erreur : key '{key}' non éditable. Liste : {', '.join(EDITABLE_KEYS)}")
        return

    # Backup
    backup = Path(str(save_path) + '.bak')
    shutil.copy2(save_path, backup)
    print(f"Backup créé : {backup}")

    data = parse_save(save_path)
    main_off, main_len = find_main_offset(data)
    main_hex_start = main_off
    main_hex_len = main_len
    main_bytes = bytes.fromhex(data[main_off:main_off+main_len].decode('ascii'))

    parsed = parse_main_with_offsets(main_bytes)
    entry = parsed.get(key)
    if not entry:
        print(f"Erreur : key '{key}' absent du fichier")
        return
    val_off, current, vtype = entry
    if vtype != 'double':
        print(f"Erreur : '{key}' n'est pas un nombre")
        return

    print(f"Modifie {key} : {current} -> {new_value}")
    new_main = bytearray(main_bytes)
    struct.pack_into('<d', new_main, val_off, float(new_value))

    # Re-encode main en hex et insère dans data
    new_main_hex = bytes(new_main).hex().encode('ascii')
    if len(new_main_hex) != main_hex_len:
        print(f"Erreur : taille main changée ({len(new_main_hex)} vs {main_hex_len})")
        return
    new_data = bytearray(data)
    new_data[main_hex_start:main_hex_start+main_hex_len] = new_main_hex

    # Re-encode entier en hex
    final_hex = bytes(new_data).hex()
    Path(save_path).write_text(final_hex)
    print(f"Save modifiée : {save_path}")
    print(f"Lance le jeu avec cette save pour appliquer.")


if __name__ == "__main__":
    save_path = DEFAULT_SAVE
    if len(sys.argv) == 1:
        show_current_values(save_path)
        print("\nPour modifier : python edit_save.py <key> <value>")
        print("Ex : python edit_save.py garbage 99999")
    elif len(sys.argv) == 3:
        edit_save(save_path, sys.argv[1], float(sys.argv[2]))
    else:
        print(__doc__)
