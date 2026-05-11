/* ============================================================
   Crypt Custodian Interactive Map — main app
   ============================================================ */

/* Les constantes (MAP_WIDTH, MAP_HEIGHT, MAP_IMAGE, CATEGORIES, KNOWN_NAMES,
   INITIAL_MARKERS) sont déjà déclarées globalement par data.js — pas besoin
   de les redestructurer (sinon SyntaxError de redéclaration). */
const USE_TILES = window.CC_DATA && window.CC_DATA.USE_TILES === true;

const STORAGE_KEY = 'cc-map-state-v1';
// v3 : retrait du Room Mapper (datamine pas exploitable car NPCs partagent
//      les memes noms entre rooms). Reset des markers auto-places (dm_*).
const SCHEMA_VERSION = 3;

/* ---------- State ---------- */
const state = loadState() || {
  version: SCHEMA_VERSION,
  markers: INITIAL_MARKERS.map(m => ({ ...m, found: false })),
  visibility: Object.fromEntries(Object.keys(CATEGORIES).map(k => [k, true])),
  expanded: {},
  adminMode: false,
  collectMode: false,
  adminCategory: 'picture'
};
if (state.collectMode === undefined) state.collectMode = false;

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.warn('localStorage save failed', e); }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== SCHEMA_VERSION) return null;
    return parsed;
  } catch { return null; }
}

function newId() {
  return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function toast(msg, ms = 1800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

/* ---------- Leaflet map ---------- */
const bounds = [[0, 0], [MAP_HEIGHT, MAP_WIDTH]];
const map = L.map('map', {
  crs: L.CRS.Simple,
  minZoom: -2,
  maxZoom: 5,
  zoomSnap: 0.25,
  zoomDelta: 0.5,
  wheelPxPerZoomLevel: 120,
  attributionControl: false,
  zoomControl: true,
  preferCanvas: true
});

if (USE_TILES) {
  // Tuiles générées par generate_tiles.py. Le système de tuiles Leaflet
  // utilise un repère y vers le bas, on doit donc le flipper pour matcher CRS.Simple.
  const MAX_ZOOM_TILES = 5;
  L.tileLayer('tiles/{z}/{x}/{y}.png', {
    tileSize: 256,
    minZoom: 0,
    maxZoom: MAX_ZOOM_TILES,
    minNativeZoom: 0,
    maxNativeZoom: MAX_ZOOM_TILES,
    bounds: bounds,
    noWrap: true,
    tms: false
  }).addTo(map);
} else {
  L.imageOverlay(MAP_IMAGE, bounds).addTo(map);
}
map.fitBounds(bounds);
map.setMaxBounds([[-500, -500], [MAP_HEIGHT + 500, MAP_WIDTH + 500]]);

/* ---------- Markers ---------- */
const markerLayer = L.layerGroup().addTo(map);
const leafletMarkers = new Map(); // id → L.marker

function buildIcon(marker) {
  const cat = CATEGORIES[marker.category];
  const color = cat ? cat.color : '#999';
  const icon = cat ? cat.icon : '?';
  const cls = 'cc-marker' + (marker.found ? ' found' : '');
  return L.divIcon({
    html: `<div class="${cls}" style="background:${color}; color:${isLight(color) ? '#000' : '#fff'}; position:relative;">${icon}</div>`,
    className: 'cc-marker-wrapper',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14]
  });
}

function isLight(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16),
        g = parseInt(c.slice(2, 4), 16),
        b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170;
}

function renderMarkers() {
  markerLayer.clearLayers();
  leafletMarkers.clear();
  const q = (document.getElementById('search').value || '').trim().toLowerCase();

  for (const m of state.markers) {
    if (!state.visibility[m.category]) continue;
    if (q && !(m.name || '').toLowerCase().includes(q) && !(m.notes || '').toLowerCase().includes(q)) continue;

    const marker = L.marker([m.y, m.x], {
      icon: buildIcon(m),
      draggable: state.adminMode
    });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      const ev = e.originalEvent;
      if ((state.adminMode || state.collectMode) && ev && ev.shiftKey) {
        deleteMarker(m.id);
        return;
      }
      if (state.collectMode) {
        // En mode collecte : clic = toggle found, pas de popup
        toggleFound(m.id);
        return;
      }
      openPopup(m, marker);
    });
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      m.y = pos.lat;
      m.x = pos.lng;
      saveState();
      toast(`${m.name || 'Marqueur'} déplacé`);
    });
    marker.addTo(markerLayer);
    leafletMarkers.set(m.id, marker);
  }
}

function openPopup(m, marker) {
  const cat = CATEGORIES[m.category];
  const isEdit = state.adminMode;

  let html;
  if (isEdit) {
    const catOpts = Object.entries(CATEGORIES)
      .map(([k, v]) => `<option value="${k}" ${k === m.category ? 'selected' : ''}>${v.icon} ${v.name}</option>`).join('');
    const sugList = (KNOWN_NAMES[m.category] || []).map(n => `<option value="${escapeAttr(n)}">`).join('');
    html = `
      <div class="popup-edit">
        <div class="popup-title">${cat ? cat.icon : '?'} Édition</div>
        <input id="pp-name" list="pp-names-${m.id}" placeholder="Nom" value="${escapeAttr(m.name || '')}" />
        <datalist id="pp-names-${m.id}">${sugList}</datalist>
        <select id="pp-cat">${catOpts}</select>
        <textarea id="pp-notes" placeholder="Notes (optionnel)">${escapeHtml(m.notes || '')}</textarea>
        <div class="popup-actions">
          <button class="primary" id="pp-save">💾 Sauver</button>
          <button class="${m.found ? 'primary found-btn' : ''}" id="pp-found">${m.found ? '✓ Trouvé' : 'Marquer trouvé'}</button>
          <button class="danger" id="pp-del">🗑</button>
        </div>
      </div>`;
  } else {
    html = `
      <div class="popup-title">${cat ? cat.icon : '?'} ${escapeHtml(m.name || '(sans nom)')}</div>
      <div class="popup-category">${cat ? cat.name : m.category}</div>
      ${m.notes ? `<div class="popup-notes">${escapeHtml(m.notes)}</div>` : ''}
      <div class="popup-actions">
        <button class="primary ${m.found ? 'found-btn' : ''}" id="pp-found">${m.found ? '✓ Trouvé' : 'Marquer trouvé'}</button>
      </div>`;
  }

  marker.bindPopup(html, { maxWidth: 320 }).openPopup();

  setTimeout(() => {
    const $ = id => document.getElementById(id);
    if (isEdit) {
      $('pp-save')?.addEventListener('click', () => {
        m.name = $('pp-name').value.trim();
        m.category = $('pp-cat').value;
        m.notes = $('pp-notes').value.trim();
        saveState(); renderMarkers(); renderSidebar();
        marker.closePopup();
        toast('Marqueur sauvegardé');
      });
      $('pp-del')?.addEventListener('click', () => {
        if (confirm('Supprimer ce marqueur ?')) deleteMarker(m.id);
      });
    }
    $('pp-found')?.addEventListener('click', () => {
      toggleFound(m.id);
      marker.closePopup();
    });
  }, 0);
}

function deleteMarker(id) {
  state.markers = state.markers.filter(x => x.id !== id);
  saveState(); renderMarkers(); renderSidebar();
  toast('Marqueur supprimé');
}

function toggleFound(id) {
  const m = state.markers.find(x => x.id === id);
  if (!m) return;
  m.found = !m.found;
  saveState(); renderMarkers(); renderSidebar();
}

function addMarkerAt(latlng, opts = {}) {
  const { found = false, silent = false } = opts;
  const m = {
    id: newId(),
    category: state.adminCategory,
    name: '',
    y: latlng.lat,
    x: latlng.lng,
    notes: '',
    found
  };
  state.markers.push(m);
  saveState();
  renderMarkers();
  renderSidebar();
  if (silent) {
    const cat = CATEGORIES[m.category];
    const items = state.markers.filter(x => x.category === m.category);
    const foundCount = items.filter(x => x.found).length;
    const total = cat.total > 0 ? cat.total : items.length;
    toast(`${cat.icon} ${cat.name} : ${foundCount}/${total}`);
    return;
  }
  const marker = leafletMarkers.get(m.id);
  if (marker) openPopup(m, marker);
}

/* ---------- Sidebar render ---------- */
function renderSidebar() {
  const list = document.getElementById('categories');
  list.innerHTML = '';

  let totalFound = 0, totalExpected = 0;

  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const items = state.markers.filter(m => m.category === key);
    const found = items.filter(m => m.found).length;
    const expected = cat.total > 0 ? cat.total : items.length;
    totalFound += found;
    totalExpected += expected;

    const visible = state.visibility[key];
    const expanded = state.expanded[key];

    const li = document.createElement('li');
    li.innerHTML = `
      <div class="cat-row ${expanded ? 'expanded' : ''}" data-key="${key}">
        <span class="cat-expand">▶</span>
        <span class="cat-icon" style="background:${cat.color}; color:${isLight(cat.color) ? '#000' : '#fff'}">${cat.icon}</span>
        <span class="cat-name">${cat.name}</span>
        <span class="cat-count">${found}/${expected || items.length || 0}</span>
        <span class="cat-toggle ${visible ? 'on' : ''}" data-toggle="${key}"></span>
      </div>
      <div class="cat-progress-bar"><div class="cat-progress-fill" style="width:${pct(found, expected)}%; background:${cat.color}"></div></div>
      <div class="cat-items">
        ${items.length === 0 ? `<div style="font-size:11px;color:var(--text-dim);padding:4px;">Aucun marqueur. ${cat.total > 0 ? 'Active le mode édition pour en placer.' : ''}</div>` : items.map(m => `
          <div class="cat-item-row ${m.found ? 'found' : ''}" data-id="${m.id}">
            <span class="cat-item-check"></span>
            <span>${escapeHtml(m.name || '(sans nom)')}</span>
          </div>`).join('')}
        <div class="cat-bulk">
          <button data-bulk-check="${key}">Tout cocher</button>
          <button data-bulk-uncheck="${key}">Tout décocher</button>
        </div>
      </div>
    `;
    list.appendChild(li);
  }

  // global progress
  document.getElementById('global-count').textContent = `${totalFound} / ${totalExpected}`;
  document.getElementById('global-percent').textContent = pct(totalFound, totalExpected) + '%';
  document.getElementById('global-bar').style.width = pct(totalFound, totalExpected) + '%';

  bindSidebarHandlers();
}

function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

function bindSidebarHandlers() {
  document.querySelectorAll('.cat-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.dataset.toggle) {
        const key = e.target.dataset.toggle;
        state.visibility[key] = !state.visibility[key];
        saveState(); renderMarkers(); renderSidebar();
        return;
      }
      const key = row.dataset.key;
      state.expanded[key] = !state.expanded[key];
      saveState(); renderSidebar();
    });
  });

  document.querySelectorAll('.cat-item-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      toggleFound(id);
      const m = state.markers.find(x => x.id === id);
      if (m) {
        map.flyTo([m.y, m.x], Math.max(map.getZoom(), 0), { duration: 0.6 });
      }
    });
  });

  document.querySelectorAll('[data-bulk-check]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.bulkCheck;
      state.markers.filter(m => m.category === key).forEach(m => m.found = true);
      saveState(); renderMarkers(); renderSidebar();
      toast(`Tous les ${CATEGORIES[key].name} cochés`);
    });
  });

  document.querySelectorAll('[data-bulk-uncheck]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.bulkUncheck;
      state.markers.filter(m => m.category === key).forEach(m => m.found = false);
      saveState(); renderMarkers(); renderSidebar();
      toast(`Tous les ${CATEGORIES[key].name} décochés`);
    });
  });
}

/* ---------- Toolbar ---------- */
document.getElementById('toggle-all-on').addEventListener('click', () => {
  Object.keys(state.visibility).forEach(k => state.visibility[k] = true);
  saveState(); renderMarkers(); renderSidebar();
});

document.getElementById('toggle-all-off').addEventListener('click', () => {
  Object.keys(state.visibility).forEach(k => state.visibility[k] = false);
  saveState(); renderMarkers(); renderSidebar();
});

function refreshModeUI() {
  const adminBtn = document.getElementById('admin-toggle');
  const collectBtn = document.getElementById('collect-toggle');
  const adminPanel = document.getElementById('admin-panel');
  const hint = document.getElementById('admin-hint');

  adminBtn.classList.toggle('active', state.adminMode);
  collectBtn.classList.toggle('active', state.collectMode);

  adminPanel.classList.toggle('hidden', !(state.adminMode || state.collectMode));

  const anyActive = state.adminMode || state.collectMode;
  document.body.style.cursor = anyActive ? 'crosshair' : '';

  if (state.collectMode) {
    hint.innerHTML = `<strong>🟢 Mode collecte.</strong><br />
      Choisis une catégorie ci-dessous, puis clique sur la map à l'endroit de l'objet trouvé.
      Une pastille verte ✓ recouvre l'item et le compteur monte automatiquement.<br />
      Astuce : <kbd>Shift</kbd> + clic sur une pastille pour la retirer.`;
  } else if (state.adminMode) {
    hint.innerHTML = `<strong>✏️ Mode édition.</strong><br />
      • Clic sur la map → ajoute un marqueur nommable dans la catégorie<br />
      • Clic sur un marqueur → éditer<br />
      • Drag = déplacer · <kbd>Shift</kbd> + clic = supprimer`;
  }
  renderMarkers();
}

document.getElementById('admin-toggle').addEventListener('click', () => {
  state.adminMode = !state.adminMode;
  if (state.adminMode) state.collectMode = false;
  saveState();
  refreshModeUI();
  toast(state.adminMode ? 'Mode édition activé' : 'Mode édition désactivé');
});

document.getElementById('collect-toggle').addEventListener('click', () => {
  state.collectMode = !state.collectMode;
  if (state.collectMode) state.adminMode = false;
  saveState();
  refreshModeUI();
  toast(state.collectMode ? 'Mode collecte activé' : 'Mode collecte désactivé');
});

document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('Effacer toute la progression et tous les marqueurs ajoutés ? (irréversible — pense à exporter avant)')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

document.getElementById('export-btn').addEventListener('click', () => {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `crypt-custodian-map-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Export téléchargé');
});

document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.markers || !Array.isArray(data.markers)) throw new Error('Format invalide');
    Object.assign(state, data);
    saveState(); renderMarkers(); renderSidebar();
    toast('Import réussi');
  } catch (err) {
    alert('Import échoué : ' + err.message);
  }
  e.target.value = '';
});

document.getElementById('search').addEventListener('input', () => renderMarkers());

/* ====================================================================
   IMPORT SAVE — charge un .sav Crypt Custodian, parse et affiche
   un rapport de progression 100% dans le panneau dédié.
   ==================================================================== */
const SAVE_REPORT_KEY = 'cc-save-report-v1';

// Charge le datamine en arrière-plan pour permettre le cross-référencement
(function loadDatamine() {
  fetch('Export/crypt_custodian_export.json')
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data) {
        window.CC_DATAMINE_DATA = data;
        console.log(`%c[datamine] ${data.rooms.length} rooms chargees`, 'color:#22d3ee');
      }
    })
    .catch(() => {});
})();

// Charge la table d'anchors de référence (extraite d'une save couverte).
// Permet de placer des items même pour des saves "fraîches" sans téléporteurs.
(function loadAnchors() {
  fetch('Export/anchors_reference.json')
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data) {
        window.CC_ANCHORS_REFERENCE = data;
        const count = Object.values(data).reduce((s, a) => s + a.length, 0);
        console.log(`%c[anchors] ${Object.keys(data).length} rooms / ${count} anchors de référence chargés`, 'color:#22d3ee');
      }
    })
    .catch(() => {});
})();

// Conversion coords save (_xpos/_ypos in-game units) -> pixels s_map.
// Calibration rigoureuse, dérivée de :
//   1. L'analyse statistique de 46 points (téléporteurs + hidden markers) :
//      xpos ∈ [9, 101], ypos ∈ [2, 53.5]
//   2. Le sprite s_map.png a un content area aux marges (51, 19) → (2540, 875)
//   3. Un point utilisateur-vérifié : AS_8 à (xpos=46.6, ypos=43.9) → s_map pixel (1064, 671)
//
// Fit X : 2 contraintes — xpos=9 mappé à x=51 (bord gauche content) ET le
// point user AS_8. Erreur résiduelle <1 px sur AS_8, ~8 px à xpos=101 (le
// bord droit estimé 2532 vs réel 2540).
//
// Fit Y : 2 contraintes — ypos=2 mappé à y=19 (bord haut content) ET le
// point user AS_8. Erreur <1 px sur AS_8. À ypos=53.5 ça donne y=820, ce
// qui implique un padding de 55px en bas (cohérent : la plus grande ypos
// observée n'est pas forcément le bord du monde).
//
// Ces constantes sont des propriétés FIXES du rendu de la pause-map du jeu,
// donc valables pour toutes les saves d'utilisateurs.
function saveCoordToSmapPixel(xpos, ypos) {
  return {
    x: xpos * 26.94 - 191,
    y: ypos * 15.56 -  12
  };
}

document.getElementById('save-import-btn').addEventListener('click', () => {
  document.getElementById('save-file-input').click();
});

/* Modal Tuto .sav */
const tutoModal = document.getElementById('save-tuto-modal');
document.getElementById('save-tuto-btn').addEventListener('click', () => {
  tutoModal.classList.remove('hidden');
});
document.getElementById('save-tuto-close').addEventListener('click', () => {
  tutoModal.classList.add('hidden');
});
tutoModal.addEventListener('click', (e) => {
  if (e.target === tutoModal) tutoModal.classList.add('hidden');
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !tutoModal.classList.contains('hidden')) {
    tutoModal.classList.add('hidden');
  }
});
tutoModal.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '✓';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '📋'; btn.classList.remove('copied'); }, 1500);
    } catch {
      toast('Copie échouée — sélectionne et copie manuellement');
    }
  });
});

document.getElementById('save-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const report = await window.CC_SAVE.parseSaveFile(buf);
    localStorage.setItem(SAVE_REPORT_KEY, JSON.stringify(report));
    renderSaveReport(report);
    toast(`Save chargée — ${file.name}`);
  } catch (err) {
    alert('Erreur de parsing du .sav : ' + err.message);
    console.error(err);
  }
  e.target.value = '';
});

function renderSaveReport(report) {
  const panel = document.getElementById('save-progress-panel');
  if (!report) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const cats = report.categories;
  const trackable = ['pictures', 'upgrades', 'abilities', 'curses', 'spirits', 'jukebox'];
  let found = 0, total = 0;
  for (const c of trackable) { found += cats[c].found; total += cats[c].total; }
  // Préfère le % stocké dans la save (= ce que le jeu affiche en pause)
  const pctGlobal = report.stats.percent > 0
    ? Math.round(report.stats.percent * 10) / 10
    : (total > 0 ? Math.round((found / total) * 100) : 0);

  const catEntries = [
    { key: 'pictures',  icon: '📷', name: 'Pictures',         color: '#fbbf24' },
    { key: 'upgrades',  icon: '⚡', name: 'Upgrades',         color: '#f97316' },
    { key: 'abilities', icon: '🦘', name: 'Abilities',        color: '#3b82f6' },
    { key: 'curses',    icon: '💀', name: 'Curses beaten',    color: '#ef4444' },
    { key: 'spirits',   icon: '👻', name: 'Trapped Spirits',  color: '#22d3ee' },
    { key: 'jukebox',   icon: '💿', name: 'Jukebox songs',    color: '#a855f7' }
  ];

  panel.innerHTML = `
    <div class="sr-head">
      <div class="sr-title">📥 Save loaded</div>
      <button class="sr-clear" title="Effacer le rapport">×</button>
    </div>
    <div class="sr-global">
      <div class="sr-global-bar"><div class="sr-global-fill" style="width:${pctGlobal}%"></div></div>
      <div class="sr-global-pct">${pctGlobal}%</div>
      <div class="sr-global-detail">${found} / ${total} (sur les catégories trackables)</div>
    </div>

    <ul class="sr-cats">
      ${catEntries.map(ce => {
        const c = cats[ce.key];
        const pct = c.total > 0 ? Math.round(c.found / c.total * 100) : 0;
        const remaining = c.total - c.found;
        const done = remaining <= 0;
        // Pour curses, on peut potentiellement nommer les manquants
        const hasMissingList = ce.key === 'curses' && c.missing && c.missing.length > 0;
        return `
          <li class="sr-cat ${done ? 'done' : 'pending'}">
            <div class="sr-cat-row">
              <span class="sr-cat-icon" style="background:${ce.color}">${ce.icon}</span>
              <span class="sr-cat-name">${ce.name}</span>
              <span class="sr-cat-count">${c.found}/${c.total}</span>
              <span class="sr-cat-status">${done ? '✓' : `manque ${remaining}`}</span>
            </div>
            <div class="sr-cat-bar"><div class="sr-cat-fill" style="width:${pct}%; background:${ce.color}"></div></div>
            ${hasMissingList ? `
              <div class="sr-cat-missing">
                ${c.missing.map(m => `
                  <div class="sr-missing-item" data-room="${m.room}" data-x="${m.x}" data-y="${m.y}"
                       data-smap-x="${m.smap_xpos || ''}" data-smap-y="${m.smap_ypos || ''}">
                    <span>📍 <strong>${m.room}</strong> · pos (${m.x}, ${m.y})</span>
                    ${m.smap_xpos != null ? `<button class="sr-show-btn" title="Place un marker sur la map">→ Voir sur la map</button>` : ''}
                  </div>
                `).join('')}
              </div>` : ''}
          </li>
        `;
      }).join('')}
    </ul>

    <details class="sr-details" open>
      <summary>🎯 Compteurs additionnels (pour 100%)</summary>
      <table class="sr-stats">
        <tr><td>✨ Upgrade points</td><td>${report.stats.upgrade_points}${report.stats.upgrade_points >= 80 ? ' ✓' : ' (wiki dit ≥68)'}</td></tr>
        <tr><td>🪙 Upgrade points current</td><td>${report.stats.upgrade_points_current} (à dépenser)</td></tr>
        <tr><td>🪑 Slots upgrade achetés</td><td>${report.stats.bought_slots} / 20 ${report.stats.bought_slots >= 20 ? '✓' : ''}</td></tr>
        <tr><td>🏷️ Stickers</td><td>${report.stats.stickers}</td></tr>
        <tr><td>🔑 Keys</td><td>${report.stats.keys}</td></tr>
        <tr><td>🎬 Movie key</td><td>${report.stats.movie_key}</td></tr>
        <tr><td>🎞️ Reels</td><td>${report.stats.reels}</td></tr>
      </table>
    </details>

    <details class="sr-details">
      <summary>🎵 Musiques débloquées (${cats.jukebox.songs.length})</summary>
      <ul class="sr-songs">${cats.jukebox.songs.map(s => `<li>${s}</li>`).join('')}</ul>
    </details>

    <details class="sr-details">
      <summary>📊 Stats de ton run</summary>
      <table class="sr-stats">
        <tr><td>Ennemis tués</td><td>${report.stats.enemies_killed.toLocaleString()}</td></tr>
        <tr><td>Coups portés</td><td>${report.stats.attacks_swung.toLocaleString()}</td></tr>
        <tr><td>Morts</td><td>${report.stats.times_died}</td></tr>
        <tr><td>Specials utilisés</td><td>${report.stats.specials_used}</td></tr>
        <tr><td>Attack strength</td><td>${report.stats.attack_strength}</td></tr>
        <tr><td>Health max</td><td>${report.stats.player_health_max}</td></tr>
        <tr><td>Slots upgrade achetés</td><td>${report.stats.bought_slots}</td></tr>
        <tr><td>Garbage (currency)</td><td>${report.stats.garbage.toLocaleString()}</td></tr>
        <tr><td>Stickers posés</td><td>${report.stats.stickers}</td></tr>
        <tr><td>Temps de jeu</td><td>${formatGametime(report.stats.gametime)}</td></tr>
        <tr><td>Room actuelle</td><td><code>${report.stats.current_room}</code></td></tr>
        <tr><td>Difficulté</td><td>${report.stats.difficulty}</td></tr>
      </table>
    </details>

    ${report.teleporters.length > 0 ? `
    <details class="sr-details">
      <summary>🚪 Téléporteurs débloqués (${report.teleporters.length})</summary>
      <ul class="sr-tele">${report.teleporters
        .sort((a, b) => (a._room || '').localeCompare(b._room || ''))
        .map(t => `<li><code>${t._room}</code> · map(${t._xpos}, ${t._ypos})</li>`).join('')}</ul>
    </details>` : ''}

    ${report.allItems && report.allItems.length > 0 ? `
    <div class="sr-actions">
      <button id="sr-map-all" title="Place tous les items connus avec position s_map estimée">
        📍 Mapper tous les items (${report.allItems.length})
      </button>
      <button id="sr-map-missing" title="Place uniquement les manquants">
        🚨 Mapper les manquants (${report.allItems.filter(i => !i.found).length})
      </button>
      <button id="sr-clear-imported" title="Retire les markers placés depuis la save">
        🗑 Retirer les markers save
      </button>
    </div>` : ''}
  `;

  panel.querySelector('.sr-clear').addEventListener('click', () => {
    if (!confirm('Effacer le rapport de save ?')) return;
    localStorage.removeItem(SAVE_REPORT_KEY);
    panel.classList.add('hidden');
    panel.innerHTML = '';
  });

  // Boutons d'actions massives
  panel.querySelector('#sr-map-all')?.addEventListener('click', () => placeItemsFromReport(report, 'all'));
  panel.querySelector('#sr-map-missing')?.addEventListener('click', () => placeItemsFromReport(report, 'missing'));
  panel.querySelector('#sr-clear-imported')?.addEventListener('click', () => {
    const before = state.markers.length;
    state.markers = state.markers.filter(m => !(m.id && m.id.startsWith('save_')));
    saveState(); renderMarkers(); renderSidebar();
    toast(`${before - state.markers.length} markers save retirés`);
  });

  // Bouton "voir sur la map" pour chaque item manquant
  panel.querySelectorAll('.sr-show-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.sr-missing-item');
      const sx = parseFloat(item.dataset.smapX);
      const sy = parseFloat(item.dataset.smapY);
      const room = item.dataset.room;
      const gx = item.dataset.x, gy = item.dataset.y;
      if (!sx || !sy) { toast('Position s_map inconnue'); return; }
      const px = saveCoordToSmapPixel(sx, sy);
      placeMissingMarker(px.x, px.y, room, `${room} - curse (${gx},${gy})`);
    });
  });
}

// Place une batch d'items depuis le rapport save sur la map
function placeItemsFromReport(report, mode = 'all') {
  if (!report.allItems || report.allItems.length === 0) {
    toast('Pas de données data.win — recharge la page pour qu\'elle se charge');
    return;
  }
  // Retire les anciens markers save pour éviter les doublons
  state.markers = state.markers.filter(m => !(m.id && m.id.startsWith('save_')));

  let placed = 0, skipped = 0;
  // Zone "contenu" de la s_map (en dehors c'est du gris = padding inutile)
  // marges sprite : Left=51, Right=2540, Top=19, Bottom=875
  const CONTENT_MIN_X = 30, CONTENT_MAX_X = 2560;
  const CONTENT_MIN_Y = 10, CONTENT_MAX_Y = 850;
  for (const item of report.allItems) {
    if (mode === 'missing' && item.found) continue;
    const px = saveCoordToSmapPixel(item.smapX, item.smapY);
    // Skip si hors zone de contenu de la s_map (= dans le padding = invisible)
    if (px.x < CONTENT_MIN_X || px.x > CONTENT_MAX_X ||
        px.y < CONTENT_MIN_Y || px.y > CONTENT_MAX_Y) {
      skipped++;
      continue;
    }
    const lat = MAP_HEIGHT - px.y;
    const lng = px.x;
    const id = `save_${item.category}_${item.room}_${item.gameX}_${item.gameY}`;
    state.markers.push({
      id,
      category: item.category,
      name: item.label + (item.found ? ' ✓' : ' (manquant)') + (item.exact ? ' 📍' : ''),
      x: lng, y: lat,
      notes: `Room ${item.room} · ${item.obj} · ${item.gameX},${item.gameY}${item.exact ? '\nPosition EXACTE (hidden marker)' : '\nPosition approximative (cluster de la room)'}`,
      found: item.found
    });
    placed++;
  }
  saveState();
  renderMarkers();
  renderSidebar();
  const msg = skipped > 0
    ? `${placed} items placés, ${skipped} skipped (hors map)`
    : `${placed} items placés sur la map`;
  toast(msg);
}

// Place un marker rouge "MANQUANT" sur la map et zoom dessus
function placeMissingMarker(smapPxX, smapPxY, roomName, notes) {
  // En Leaflet : lat = MAP_HEIGHT - imagePixelY (image y top->down vs leaflet y bottom->up)
  const lat = MAP_HEIGHT - smapPxY;
  const lng = smapPxX;
  const id = `missing_${roomName}_${Date.now()}`;
  state.markers.push({
    id, category: 'curse', name: `🚨 MANQUE : ${roomName}`,
    x: lng, y: lat, notes, found: false
  });
  saveState();
  renderMarkers();
  renderSidebar();
  map.flyTo([lat, lng], 3, { duration: 0.8 });
  toast(`Marker placé pour ${roomName} — voir la map`);
}

// Format gametime (game ticks → human-readable)
function formatGametime(ticks) {
  // Hypothese : 60 ticks/sec
  const secs = Math.floor(ticks / 60);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

// Restaure le rapport sauvegardé au chargement
(function restoreReport() {
  try {
    const raw = localStorage.getItem(SAVE_REPORT_KEY);
    if (raw) renderSaveReport(JSON.parse(raw));
  } catch (e) { /* ignore */ }
})();

/* ---------- Admin panel ---------- */
const adminSelect = document.getElementById('admin-category');
adminSelect.innerHTML = Object.entries(CATEGORIES)
  .map(([k, v]) => `<option value="${k}">${v.icon} ${v.name}</option>`).join('');
adminSelect.value = state.adminCategory;
adminSelect.addEventListener('change', () => {
  state.adminCategory = adminSelect.value;
  saveState();
});

map.on('click', (e) => {
  if (state.collectMode) {
    addMarkerAt(e.latlng, { found: true, silent: true });
  } else if (state.adminMode) {
    addMarkerAt(e.latlng, { found: false, silent: false });
  }
});

refreshModeUI();

/* ---------- Coordinate display ---------- */
const coordDisplay = L.control({ position: 'bottomleft' });
coordDisplay.onAdd = function() {
  const div = L.DomUtil.create('div', 'coord-display');
  div.style.cssText = 'background:rgba(0,0,0,0.7);color:#aaa;padding:4px 8px;border-radius:4px;font-size:11px;font-family:monospace;';
  div.innerHTML = '—';
  return div;
};
coordDisplay.addTo(map);
map.on('mousemove', (e) => {
  const el = document.querySelector('.coord-display');
  if (el) el.textContent = `x: ${Math.round(e.latlng.lng)}  y: ${Math.round(e.latlng.lat)}`;
});

/* ---------- Marker scaling with zoom ----------
   Quand on zoom dans la map, les items du JPG grossissent. On veut que les
   pastilles grossissent avec, pour qu'elles couvrent toujours l'item dessous.
   Quand on dézoom, on garde la pastille à taille écran normale (sinon elles
   deviennent invisibles).
   Zoom 0 = taille native du JPG (1 px image = 1 px écran). À cette résolution,
   les items du JPG font ~10-20 px, donc la pastille de 26 px les couvre bien.
   Au-dessus de 0 on grandit en proportion. */
function updateMarkerScale() {
  const z = map.getZoom();
  // En-dessous de zoom 0 on rétrécit légèrement (jusqu'à 60% au max dézoomé)
  // pour ne pas écraser la map quand on a une vue d'ensemble.
  const scale = Math.max(0.6, Math.pow(2, z));
  document.documentElement.style.setProperty('--marker-scale', scale.toFixed(3));
}
map.on('zoom zoomend', updateMarkerScale);
updateMarkerScale();

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

/* ---------- Boot ---------- */
renderMarkers();
renderSidebar();

console.log('%cCrypt Custodian Map ready', 'color:#a855f7;font-weight:bold');
console.log(`${state.markers.length} markers loaded.`);
