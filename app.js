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
