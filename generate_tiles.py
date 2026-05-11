"""
Optionnel : génère des tuiles Leaflet pour la map à partir du JPG complet.

Pourquoi ? L'image originale fait 21140x7540 px. Charger l'image entière dans
le navigateur fonctionne mais c'est lourd (~14 MB téléchargé d'un coup, décodage
GPU coûteux, certains navigateurs limitent les très grosses images).

Avec des tuiles : le navigateur ne charge que les morceaux visibles selon le zoom.
Beaucoup plus fluide.

Usage :
    pip install pillow
    python generate_tiles.py

Les tuiles seront générées dans ./tiles/{z}/{x}/{y}.png
Ensuite dans data.js mets USE_TILES = true.
"""

from PIL import Image
from pathlib import Path
import math

Image.MAX_IMAGE_PIXELS = None  # désactive le warning pour notre grande image

SOURCE = Path(__file__).parent / "map.jpg"
TILES_DIR = Path(__file__).parent / "tiles"
TILE_SIZE = 256
MIN_ZOOM = 0   # plus dézoomé (image minuscule)
MAX_ZOOM = 5   # plus zoomé (image quasi-native)


def generate():
    if not SOURCE.exists():
        print(f"ERREUR : fichier introuvable : {SOURCE}")
        return

    print(f"Chargement de {SOURCE.name}...")
    src = Image.open(SOURCE).convert("RGB")
    w, h = src.size
    print(f"Image source : {w} x {h}")

    TILES_DIR.mkdir(exist_ok=True)

    # à chaque niveau de zoom, l'image est scalée à 2^(z - MAX_ZOOM) du natif
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        scale = 2 ** (z - MAX_ZOOM)
        zw = max(1, int(w * scale))
        zh = max(1, int(h * scale))
        print(f"Zoom {z}: {zw} x {zh} ({scale:.4f}x)")

        img = src.resize((zw, zh), Image.LANCZOS)

        cols = math.ceil(zw / TILE_SIZE)
        rows = math.ceil(zh / TILE_SIZE)

        for x in range(cols):
            for y in range(rows):
                left = x * TILE_SIZE
                top = y * TILE_SIZE
                right = min(left + TILE_SIZE, zw)
                bottom = min(top + TILE_SIZE, zh)
                tile = Image.new("RGB", (TILE_SIZE, TILE_SIZE), (0, 0, 0))
                tile.paste(img.crop((left, top, right, bottom)), (0, 0))

                out_dir = TILES_DIR / str(z) / str(x)
                out_dir.mkdir(parents=True, exist_ok=True)
                tile.save(out_dir / f"{y}.png", "PNG", optimize=True)

        img.close()
        print(f"  -> {cols * rows} tuiles")

    src.close()
    print("\nTerminé.")
    print(f"Tuiles dans : {TILES_DIR}")
    print('Dans data.js, ajoute : const USE_TILES = true;')


if __name__ == "__main__":
    generate()
