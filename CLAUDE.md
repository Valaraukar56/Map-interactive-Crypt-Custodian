# Crypt Custodian — Interactive Map

App web pour tracker la complétion 100% du jeu **Crypt Custodian** sur la map officielle.

## Fichiers du projet

| Fichier | Rôle |
|---|---|
| `index.html` | Page principale (Leaflet via CDN) |
| `styles.css` | Thème sombre, sidebar, popups, markers |
| `data.js` | Config catégories, noms d'objets connus, marqueurs initiaux |
| `app.js` | Logique Leaflet, filtres, persistence, mode édition |
| `map.jpg` | Copie propre du JPG (renommé sans espaces) |
| `JPG50_ (v2) - Crypt Custodian 100_ Map.jpg` | Original |
| `generate_tiles.py` | (Optionnel) Découpe le JPG en tuiles pour les perfs |

## Lancement

L'app a besoin d'être servie par un serveur HTTP local (les `fetch` et `localStorage` marchent mais `file://` peut bloquer certains trucs selon le navigateur).

```powershell
# Python 3 (déjà installé en général sur Win11)
python -m http.server 8000
# puis ouvre http://localhost:8000
```

Ou avec Node :
```powershell
npx serve .
```

## Catégories suivies

Les totaux viennent des guides Steam / wiki Fandom :

| Catégorie | Total 100% | Icône |
|---|---:|:---:|
| Pictures (photos) | 33 | 📷 |
| Jukebox Discs | 20 | 💿 |
| Trapped Spirits (vases) | 20 | 👻 |
| Curses (skulls) | 10 | 💀 |
| Upgrade Points | 64 | ✨ |
| Upgrades | 32 | ⚡ |
| Special Attacks | 8 | ⭐ |
| Abilities (movement) | 8 | 🦘 |
| Bosses | — | 💢 |
| NPCs / Shops | — | 🏠 |
| Zone Labels | — | 🗺️ |
| Secrets / Notes | — | ❓ |

Les noms d'objets connus (32 upgrades, 8 specials, etc.) sont pré-remplis dans `data.js > KNOWN_NAMES` et apparaissent en auto-complétion quand on nomme un marqueur.

## Comment utiliser l'app

### Mode normal (lecture)
- **Pan** : clic-glisse sur la map
- **Zoom** : molette / boutons +/-
- **Filtrer** : clic sur la case à droite du nom de catégorie (œil = visible)
- **Tout afficher / cacher** : boutons en haut de la sidebar
- **Recherche** : tape un mot, ne montre que les marqueurs qui matchent
- **Cocher un objet** : clic sur le marqueur → "Marquer trouvé", ou clic dans la liste de la sidebar (déplie une catégorie)
- **Bulk** : "Tout cocher / décocher" en bas de chaque catégorie dépliée

### Mode collecte (rapide, pendant le run)
1. Clic sur **✓ Collecte**
2. Choisis la catégorie courante (ex: Upgrades)
3. **Clic sur l'objet sur la map** → pose une grosse pastille verte ✓ qui couvre l'item dans le JPG, le compteur de la catégorie monte
4. Tu peux changer de catégorie autant que tu veux entre deux clics
5. **Shift + clic sur une pastille** → la retirer
6. **Re-clic sur une pastille** → toggle trouvé/non trouvé

### Mode édition (placer des marqueurs nommés)
1. Clic sur **✏️ Édition**
2. Choisis la catégorie
3. **Clic sur la map** → ajoute un marqueur, popup d'édition s'ouvre (nom + notes)
4. **Clic sur un marqueur existant** → éditer (nom, catégorie, notes)
5. **Drag d'un marqueur** → repositionnement
6. **Shift + clic sur un marqueur** → supprimer rapide

Les deux modes sont **mutuellement exclusifs** : activer l'un désactive l'autre.

Les coordonnées (x, y) s'affichent en bas à gauche pour repérer.

### Sauvegarde
- **Auto** : tout est sauvé dans `localStorage` du navigateur en continu
- **Export** : bouton ⬇ Export → télécharge un JSON daté
- **Import** : bouton ⬆ Import → recharge un JSON
- **Reset** : ⚠️ efface tout. À utiliser avec l'export juste avant pour pas tout perdre

## Perf : option tuiles

Le JPG fait 21140×7540 (14 MB). Ça charge mais c'est lourd. Si trop lent :

```powershell
pip install pillow
python generate_tiles.py
```

Puis dans `data.js`, ajoute en fin de fichier :
```js
window.CC_DATA.USE_TILES = true;
```

L'app basculera automatiquement sur `L.tileLayer` (le navigateur ne charge que les tuiles visibles).

⚠️ Le mode tuiles est **expérimental** — l'alignement Leaflet `CRS.Simple` vs tuiles standard peut nécessiter un ajustement. Si ça déconne, repasse à `USE_TILES = false`.

## Système de coordonnées

Leaflet utilise `CRS.Simple` avec bounds `[[0,0], [HEIGHT, WIDTH]]`.
- `lat` = y (de **0 en bas** à 7540 en haut)
- `lng` = x (de 0 à gauche à 21140 à droite)

Quand tu vois `x: 12000 y: 3500` en bas de la map en bougeant la souris, c'est ces valeurs là qui sont stockées dans les marqueurs.

## Recherches sources

Infos compilées depuis :
- [Crypt Custodian Wiki (Fandom)](https://crypt-custodian.fandom.com/wiki/Crypt_Custodian_Wiki)
- [DotEsports - All upgrades and special attacks](https://dotesports.com/indies/news/all-upgrades-and-special-attacks-in-crypt-custodian)
- [Steam guide 100% walkthrough](https://steamcommunity.com/sharedfiles/filedetails/?id=3386264181)
- [Steam guide - 40 upgrades](https://steamcommunity.com/sharedfiles/filedetails/?id=3314813268)
- [Steam guide - 20 jukebox discs](https://steamcommunity.com/sharedfiles/filedetails/?id=3314812448)
- UX inspiré de [hallownest.net](https://www.hallownest.net/) et [thesilksongmap.com](https://www.thesilksongmap.com/)

## TODO / idées suivantes

- [ ] Catégorie "à explorer" pour marquer les zones suspectes pendant le run
- [ ] Liens entre marqueurs (ex: "boulet derrière door X")
- [ ] Mode sombre/clair (déjà sombre, mais un thème clair serait sympa)
- [ ] Import auto des positions canon depuis une source publique si dispo
