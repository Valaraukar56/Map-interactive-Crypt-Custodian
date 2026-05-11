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


def give_all_collectibles(save_path):
    """Set tous les collectibles standards a leur max :
       - pics0..35 = 1, upgrade_list0..31 = 1, ability_list0..7 = 1
       - curses_beat = 10, catghosts = 20
       - bought_slots = 50, stickers = 99, upgrade_points = 200
    """
    backup = Path(str(save_path) + '.bak')
    shutil.copy2(save_path, backup)
    print(f"Backup cree : {backup}")

    data = parse_save(save_path)
    main_off, main_len = find_main_offset(data)
    main_bytes = bytearray(bytes.fromhex(data[main_off:main_off+main_len].decode('ascii')))
    parsed = parse_main_with_offsets(bytes(main_bytes))

    targets = {}
    # Indices : tous les pics, upgrades, abilities a 1.0
    for k in parsed:
        if (k.startswith('pics') or k.startswith('upgrade_list') or k.startswith('ability_list')) \
           and any(c.isdigit() for c in k) and not k.endswith('_active'):
            targets[k] = 1.0
    # Counters
    targets.update({
        'curses_beat': 10.0,
        'catghosts': 20.0,
        'bought_slots': 50.0,
        'stickers': 99.0,
        'upgrade_points': 200.0,
        'upgrade_points_current': 50.0,
        'player_health_max': 8.0,
        'attack_strength': 10.0,
    })
    # Theatre side-content
    targets.update({
        'keys': 5.0, 'movie_key': 1.0, 'reels': 5.0
    })

    changed = 0
    for k, new_val in targets.items():
        entry = parsed.get(k)
        if not entry: continue
        val_off, current, vtype = entry
        if vtype != 'double': continue
        if current == new_val: continue
        struct.pack_into('<d', main_bytes, val_off, new_val)
        changed += 1

    print(f"Modifie {changed} valeurs dans main")

    new_main_hex = bytes(main_bytes).hex().encode('ascii')
    new_data = bytearray(data)
    new_data[main_off:main_off+main_len] = new_main_hex
    Path(save_path).write_text(bytes(new_data).hex())
    print(f"Save modifiee : {save_path}")
    print(f"Lance le jeu pour appliquer.")


if __name__ == "__main__":
    save_path = DEFAULT_SAVE
    if len(sys.argv) == 1:
        show_current_values(save_path)
        print("\nPour modifier : python edit_save.py <key> <value>")
        print("Ex : python edit_save.py garbage 99999")
        print("    : python edit_save.py give-all  (maxe tous les collectibles)")
    elif len(sys.argv) == 2 and sys.argv[1] == 'give-all':
        give_all_collectibles(save_path)
    elif len(sys.argv) == 3:
        edit_save(save_path, sys.argv[1], float(sys.argv[2]))
    else:
        print(__doc__)
