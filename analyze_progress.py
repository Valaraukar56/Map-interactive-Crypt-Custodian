"""
Croise la save Crypt Custodian avec l'export data.win pour produire
un état de complétion 100% précis :

- Pour chaque collectible (o_cd, o_curse, o_crouton, etc.) avec sa position
  exacte (Room, X, Y) du data.win,
- on vérifie si "Room-X-Y" apparaît dans _persistent_vars de la save
- si oui → collecté, si non → manquant

Sortie : rapport détaillé en console + JSON.
"""
import json
import sys
import re
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent
SAVE = ROOT / "save_parsed.json"
DATAMINE = ROOT / "Export" / "crypt_custodian_export.json"


def load_save():
    return json.loads(SAVE.read_text(encoding="utf-8"))


def load_datamine():
    return json.loads(DATAMINE.read_text(encoding="utf-8"))


def categorize(obj):
    """Mapping nom d'objet GM -> catégorie human-readable."""
    if obj == 'o_cd': return 'Jukebox Disc'
    if obj == 'o_curse': return 'Curse Skull'
    if obj == 'o_crouton': return 'Crouton (NPC)'
    if obj == 'o_constellation': return 'Special Attack'
    if obj == 'o_special': return 'Special Attack'
    if obj == 'o_ability': return 'Ability'
    if obj == 'o_ability_newareas': return 'Ability'
    if obj == 'o_saveshrine': return 'Save Shrine'
    if obj == 'o_health_shrine': return 'Health Shrine'
    if 'boss' in obj: return 'Boss'
    if any(npc in obj for npc in ['mira', 'grizz', 'pebble', 'kendra', 'roy', 'skully', 'wailer', 'marla', 'frognpc', 'NPC', 'guide']):
        return 'NPC'
    return None  # à ignorer


def main():
    save = load_save()
    dm = load_datamine()

    # Set des clés persistent_vars (format Room-X-Y ou autre)
    persistent = save.get('_persistent_vars', {})
    if isinstance(persistent, dict):
        pv_keys = set(persistent.keys())
    else:
        pv_keys = set()
    print(f"\n=== Save loaded ===")
    print(f"  _persistent_vars   : {len(pv_keys)} entrées")
    juke = save.get('_juke_wrapper', {})
    if isinstance(juke, dict):
        print(f"  Jukebox songs      : {len(juke)} débloqués")
        for song in sorted(juke.keys()):
            print(f"    ♪ {song}")
    print()

    # Pour chaque collectible dans data.win, on vérifie s'il est dans persistent_vars
    by_cat = defaultdict(lambda: {'found': [], 'missing': []})
    matched_pv = set()

    for room in dm['rooms']:
        room_name = room['name']
        for inst in room['instances']:
            cat = categorize(inst['obj'])
            if not cat: continue
            key_exact = f"{room_name}-{inst['x']}-{inst['y']}"
            entry = {
                'room': room_name,
                'obj': inst['obj'],
                'x': inst['x'],
                'y': inst['y'],
                'key': key_exact
            }
            if key_exact in pv_keys:
                by_cat[cat]['found'].append(entry)
                matched_pv.add(key_exact)
            else:
                by_cat[cat]['missing'].append(entry)

    print("=== Comparaison data.win <-> save (matching exact Room-X-Y) ===\n")
    for cat, status in sorted(by_cat.items()):
        f = len(status['found'])
        m = len(status['missing'])
        t = f + m
        print(f"  {cat:25s} : {f:3d}/{t:3d}  ({m} manquants)")

    print(f"\n  Total clés persistent_vars qui matchent un collectible : {len(matched_pv)}")
    print(f"  Reste {len(pv_keys) - len(matched_pv)} entrees non-collectibles (portes/leviers/pots cassés/etc.)")

    # Analyse plus poussée : afficher les manquants par catégorie
    print("\n=== Détail des manquants par catégorie ===")
    for cat, status in sorted(by_cat.items()):
        if not status['missing']: continue
        print(f"\n--- {cat} ({len(status['missing'])} manquants) ---")
        # Groupé par room
        by_room = defaultdict(list)
        for m in status['missing']:
            by_room[m['room']].append(m)
        for room, items in sorted(by_room.items()):
            for it in items:
                print(f"  Room {room:15s}  pos=({it['x']:5d}, {it['y']:5d})  obj={it['obj']}")

    # Sauve résultat JSON pour réutilisation par l'app
    out = {
        'by_category': {cat: {'found_count': len(s['found']), 'missing_count': len(s['missing']),
                              'found': s['found'], 'missing': s['missing']}
                        for cat, s in by_cat.items()},
        'jukebox_unlocked': list(juke.keys()) if isinstance(juke, dict) else [],
        'persistent_keys_total': len(pv_keys),
        'persistent_keys_matched': len(matched_pv),
    }
    out_path = ROOT / "progress_report.json"
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"\nRapport JSON : {out_path}")


if __name__ == "__main__":
    main()
