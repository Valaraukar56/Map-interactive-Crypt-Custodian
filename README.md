# Crypt Custodian — Interactive Map

App web pour tracker la complétion 100% du jeu **Crypt Custodian** sur la map officielle.

![Crypt Custodian Map](map.jpg)

## Lancement rapide

L'app a besoin d'un serveur HTTP local.

**Avec VS Code Live Server (recommandé) :**
1. Installe l'extension *Live Server* (Ritwick Dey)
2. Clic droit sur `index.html` → **Open with Live Server**

**Avec Python :**
```bash
python -m http.server 8000
# puis http://localhost:8000
```

**Avec Node :**
```bash
npx serve .
```

## Features

- 🗺️ Pan/zoom Leaflet sur la map officielle (21140×7540 px)
- 🏷️ **12 catégories** suivies (Pictures, Jukebox Discs, Trapped Spirits, Curses, Upgrade Points, Upgrades, Special Attacks, Abilities, Bosses, NPCs, Zones, Secrets) avec totaux pour le 100%
- ✓ **Mode Collecte** : 1 clic = pose une pastille verte qui couvre l'item du JPG et incrémente le compteur
- ✏️ **Mode Édition** : ajouter / nommer / déplacer / supprimer des marqueurs
- 🔍 Recherche live + filtres par catégorie (toggle œil)
- 📊 Barres de progression par catégorie + globale
- 🔧 Bulk check/uncheck, drag des marqueurs, raccourci Shift+clic = supprimer
- 💾 Sauvegarde auto dans le `localStorage`
- ⬇⬆ Export / Import JSON pour backup ou partage

## Détails techniques

Voir [`CLAUDE.md`](CLAUDE.md) pour la doc complète : workflow, catégories, perf, système de coordonnées, etc.

## Stack

HTML / CSS / JS vanilla + [Leaflet.js](https://leafletjs.com/) en `CRS.Simple` pour superposer une image custom comme fond de carte (pas de tuiles géo). Aucun build, aucun framework.

## Crédits

Map officielle : *Crypt Custodian* (Kyle Thompson / Top Hat Studios, 2024).
Données collectibles compilées depuis le [Crypt Custodian Wiki](https://crypt-custodian.fandom.com) et les guides Steam.

UX inspirée des maps interactives Hollow Knight ([hallownest.net](https://www.hallownest.net/)) et Silksong ([thesilksongmap.com](https://www.thesilksongmap.com/)).
