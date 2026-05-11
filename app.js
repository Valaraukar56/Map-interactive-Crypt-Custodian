/* ============================================================
   Crypt Custodian Interactive Map — main app
   ============================================================ */

/* Les constantes (MAP_WIDTH, MAP_HEIGHT, MAP_IMAGE, CATEGORIES, KNOWN_NAMES,
   INITIAL_MARKERS) sont déjà déclarées globalement par data.js — pas besoin
   de les redestructurer (sinon SyntaxError de redéclaration). */
const USE_TILES = window.CC_DATA && window.CC_DATA.USE_TILES === true;

const STORAGE_KEY = 'cc-map-state-v1';
// v2 : passage du JPG (21140x7540) au sprite officiel s_map.png (2580x880).
// Les anciennes coords ne sont plus compatibles, on reset le state au passage.
const SCHEMA_VERSION = 2;

/* ---------- State ---------- */
const state = loadState() || {
  version: SCHEMA_VERSION,
  markers: INITIAL_MARKERS.map(m => ({ ...m, found: false })),
  visibility: Object.fromEntries(Object.keys(CATEGORIES).map(k => [k, true])),
  expanded: {},
  adminMode: false,
  collectMode: false,
  mapperMode: false,
  adminCategory: 'picture',
  roomMappings: {},       // { roomName: { x, y, w, h } } en coords s_map (Leaflet)
  zoneColors: {}          // { zonePrefix: { r, g, b } } appris au fil des placements
};
if (state.collectMode === undefined) state.collectMode = false;
if (state.mapperMode === undefined) state.mapperMode = false;
if (state.roomMappings === undefined) state.roomMappings = {};
if (state.zoneColors === undefined) state.zoneColors = {};

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
  const mapperBtn = document.getElementById('mapper-toggle');
  const adminPanel = document.getElementById('admin-panel');
  const mapperPanel = document.getElementById('mapper-panel');
  const hint = document.getElementById('admin-hint');

  adminBtn.classList.toggle('active', state.adminMode);
  collectBtn.classList.toggle('active', state.collectMode);
  mapperBtn.classList.toggle('active', state.mapperMode);

  adminPanel.classList.toggle('hidden', !(state.adminMode || state.collectMode));
  mapperPanel.classList.toggle('hidden', !state.mapperMode);

  const anyActive = state.adminMode || state.collectMode || state.mapperMode;
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
  if (state.mapperMode) updateMapperHint();
  renderMarkers();
}

document.getElementById('admin-toggle').addEventListener('click', () => {
  state.adminMode = !state.adminMode;
  if (state.adminMode) { state.collectMode = false; state.mapperMode = false; }
  saveState();
  refreshModeUI();
  toast(state.adminMode ? 'Mode édition activé' : 'Mode édition désactivé');
});

document.getElementById('collect-toggle').addEventListener('click', () => {
  state.collectMode = !state.collectMode;
  if (state.collectMode) { state.adminMode = false; state.mapperMode = false; }
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
  if (state.mapperMode) {
    handleMapperClick(e.latlng);
    return;
  }
  if (state.collectMode) {
    addMarkerAt(e.latlng, { found: true, silent: true });
  } else if (state.adminMode) {
    addMarkerAt(e.latlng, { found: false, silent: false });
  }
});

refreshModeUI();

/* ====================================================================
   ROOM MAPPER — place les rooms du data.win sur la s_map en bulk
   ==================================================================== */

let datamine = null;          // rooms by name { name, width, height, instances }
const mapperUI = {
  selectedRoom: null,         // nom de la room en cours de placement (mode 2-clic)
  firstClick: null,           // {lat, lng} du 1er coin (mode 2-clic)
  rectLayer: L.layerGroup().addTo(map),   // overlay des rectangles
  search: '',
  pendingDetection: null,     // { rect, color } quand un picker est ouvert
  pendingRect: null,          // Leaflet rectangle temporaire pour visualiser
  pickerPopup: null,          // L.popup ouvert
  useAutoDetect: true         // toggle "1 clic + auto" vs 2-clic manuel
};

/* ---------- Lecture des pixels de s_map.png ----------
   On charge l'image dans un canvas off-screen pour pouvoir flood-fill
   et identifier les rooms automatiquement quand l'utilisateur clique. */
let mapPixelData = null;
(function loadMapPixels() {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    try {
      mapPixelData = ctx.getImageData(0, 0, c.width, c.height);
      console.log(`%c[s_map] pixel data prêt (${c.width}×${c.height})`, 'color:#22d3ee');
    } catch (e) {
      console.warn('[s_map] lecture des pixels échouée :', e.message);
    }
  };
  img.onerror = () => console.warn('[s_map] image introuvable');
  img.src = MAP_IMAGE;
})();

/* ---------- Algorithme flood-fill ----------
   Retourne { x, y, w, h, color } (coords pixel s_map, y vers le bas)
   À partir d'un point cliqué, étend tant que la couleur reste proche
   de celle d'origine, en s'arrêtant aux bordures blanches et au
   fond sombre/gris (background entre les zones). */
function floodFillBounds(pd, sx, sy) {
  if (!pd) return null;
  const { data, width, height } = pd;
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) return null;

  const sIdx = (sy * width + sx) * 4;
  const r0 = data[sIdx], g0 = data[sIdx + 1], b0 = data[sIdx + 2];
  if (isBorder(r0, g0, b0) || isBackground(r0, g0, b0)) return null;

  const visited = new Uint8Array(width * height);
  const stack = [sx, sy];
  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  const MAX_DIST = 70;
  const MAX_PIXELS = 30000;  // safety

  while (stack.length > 0 && n < MAX_PIXELS) {
    const y = stack.pop();
    const x = stack.pop();
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const i = y * width + x;
    if (visited[i]) continue;
    visited[i] = 1;
    const pi = i * 4;
    const r = data[pi], g = data[pi + 1], b = data[pi + 2];
    if (isBorder(r, g, b) || isBackground(r, g, b)) continue;
    if (colorDist(r, g, b, r0, g0, b0) > MAX_DIST) continue;

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    sumR += r; sumG += g; sumB += b; n++;

    stack.push(x + 1, y);
    stack.push(x - 1, y);
    stack.push(x, y + 1);
    stack.push(x, y - 1);
  }

  if (n < 8) return null;
  return {
    x: minX, y: minY,
    w: maxX - minX + 1, h: maxY - minY + 1,
    color: { r: Math.round(sumR / n), g: Math.round(sumG / n), b: Math.round(sumB / n) },
    pixelCount: n
  };
}

function isBorder(r, g, b) {
  // Bordures blanches entre les rooms (et le tour de chaque room)
  return r > 200 && g > 200 && b > 200;
}
function isBackground(r, g, b) {
  // Background gris-très-sombre entre les zones colorées
  if (r < 60 && g < 60 && b < 60) return true;
  // Gris uniforme (R≈G≈B avec saturation faible)
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 120 && (max - min) < 15) return true;
  return false;
}
function colorDist(r1, g1, b1, r2, g2, b2) {
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

/* Conversion latlng Leaflet ↔ pixel de l'image s_map.
   Leaflet : lat=0 en bas, lat=H en haut, lng=0 à gauche, lng=W à droite.
   Image   : pixelY=0 en haut.                                          */
function latlngToPixel(latlng) {
  return { x: Math.round(latlng.lng), y: Math.round(MAP_HEIGHT - latlng.lat) };
}
function pixelToLatlng(px, py) {
  return L.latLng(MAP_HEIGHT - py, px);
}
function pixelRectToLeafletRect(pr) {
  // pr en coords pixel image (y vers le bas) -> rect en coords Leaflet (y vers le haut)
  return {
    x: pr.x,
    y: MAP_HEIGHT - (pr.y + pr.h),
    w: pr.w,
    h: pr.h
  };
}

/* Helpers zones */
function getZonePrefix(roomName) {
  if (roomName.startsWith('APalace')) return 'APalace';
  if (roomName.startsWith('ATheatre')) return 'ATheatre';
  const m = /^([A-Z]\d?|A1)_/.exec(roomName);
  return m ? m[1] : null;
}

function rankRoomsForColor(detectedColor) {
  if (!datamine) return [];
  const all = Object.values(datamine).filter(r => window.CC_DATAMINE.countInteresting(r) > 0);

  // Pour chaque zone, on a peut-être une couleur apprise
  return all.map(r => {
    const prefix = getZonePrefix(r.name);
    const learned = prefix ? state.zoneColors[prefix] : null;
    const score = learned
      ? colorDist(learned.r, learned.g, learned.b, detectedColor.r, detectedColor.g, detectedColor.b)
      : 500;  // pas appris → score moyen, mais affiché en fallback
    return {
      ...r,
      prefix,
      score,
      summary: window.CC_DATAMINE.summarizeRoom(r),
      count: window.CC_DATAMINE.countInteresting(r),
      mapped: !!state.roomMappings[r.name],
      learnedColor: learned
    };
  }).sort((a, b) => {
    if (a.mapped !== b.mapped) return a.mapped ? 1 : -1;
    return a.score - b.score;
  });
}

function learnZoneColor(roomName, color) {
  const prefix = getZonePrefix(roomName);
  if (!prefix) return;
  // Moyenne progressive : si on a déjà une couleur apprise pour cette zone,
  // on fait la moyenne avec la nouvelle (pour lisser).
  const prev = state.zoneColors[prefix];
  if (prev) {
    state.zoneColors[prefix] = {
      r: Math.round((prev.r + color.r) / 2),
      g: Math.round((prev.g + color.g) / 2),
      b: Math.round((prev.b + color.b) / 2)
    };
  } else {
    state.zoneColors[prefix] = { ...color };
  }
}

async function initDatamine() {
  if (!window.CC_DATAMINE) return;
  datamine = await window.CC_DATAMINE.load();
  if (datamine) {
    console.log(`%c[datamine] ${Object.keys(datamine).length} rooms chargees`, 'color:#22d3ee');
    renderRoomRects();
    if (state.mapperMode) renderMapperList();
  }
}

function renderRoomRects() {
  mapperUI.rectLayer.clearLayers();
  for (const [roomName, m] of Object.entries(state.roomMappings)) {
    const rect = L.rectangle(
      [[m.y, m.x], [m.y + m.h, m.x + m.w]],
      { color: '#a855f7', weight: 2, fillOpacity: 0.10, interactive: false }
    );
    rect.addTo(mapperUI.rectLayer);
    // label
    const label = L.divIcon({
      className: '',
      html: `<div style="font-family:monospace;font-size:10px;font-weight:700;color:#a855f7;text-shadow:0 0 3px #000,0 0 3px #000;background:rgba(0,0,0,0.6);padding:1px 4px;border-radius:3px;white-space:nowrap;">${roomName}</div>`,
      iconSize: [80, 14],
      iconAnchor: [0, 14]
    });
    L.marker([m.y + m.h, m.x], { icon: label, interactive: false }).addTo(mapperUI.rectLayer);
  }
}

function renderMapperList() {
  const status = document.getElementById('mapper-status');
  const list = document.getElementById('mapper-room-list');
  if (!datamine) {
    status.textContent = 'Chargement du datamine…';
    list.innerHTML = '';
    return;
  }

  const rooms = Object.values(datamine)
    .filter(r => window.CC_DATAMINE.countInteresting(r) > 0)
    .map(r => ({
      ...r,
      summary: window.CC_DATAMINE.summarizeRoom(r),
      count: window.CC_DATAMINE.countInteresting(r),
      mapped: !!state.roomMappings[r.name]
    }))
    .sort((a, b) => {
      if (a.mapped !== b.mapped) return a.mapped ? 1 : -1;  // unmapped first
      return b.count - a.count;
    });

  const q = mapperUI.search.toLowerCase();
  const filtered = q
    ? rooms.filter(r => r.name.toLowerCase().includes(q) || r.summary.toLowerCase().includes(q))
    : rooms;

  const totalMapped = rooms.filter(r => r.mapped).length;
  status.textContent = `${totalMapped} / ${rooms.length} rooms mappées (${rooms.length - totalMapped} restantes)`;

  list.innerHTML = filtered.map(r => `
    <li data-room="${r.name}" class="${r.mapped ? 'mapped' : ''} ${mapperUI.selectedRoom === r.name ? 'selected' : ''}">
      <span class="mapper-room-name">${r.name}</span>
      <span class="mapper-room-content">${escapeHtml(r.summary)} · ${r.width}×${r.height}px</span>
    </li>
  `).join('');

  for (const li of list.querySelectorAll('li')) {
    li.addEventListener('click', () => {
      const name = li.dataset.room;
      if (mapperUI.selectedRoom === name) {
        // re-clic = annuler
        mapperUI.selectedRoom = null;
        mapperUI.firstClick = null;
      } else {
        mapperUI.selectedRoom = name;
        mapperUI.firstClick = null;
        if (state.roomMappings[name]) {
          // déjà placée : centrer dessus
          const m = state.roomMappings[name];
          map.flyTo([m.y + m.h / 2, m.x + m.w / 2], Math.max(map.getZoom(), 2), { duration: 0.6 });
        }
      }
      renderMapperList();
      updateMapperHint();
    });
  }
}

function updateMapperHint() {
  const hint = document.getElementById('mapper-hint');
  if (!hint) return;
  if (!state.mapperMode) return;

  if (mapperUI.useAutoDetect) {
    if (mapperUI.selectedRoom) {
      hint.innerHTML = `<strong>📍 ${mapperUI.selectedRoom}</strong> sélectionnée.<br />
        Clique <strong>une fois</strong> à l'intérieur de la room sur la map → les bornes seront détectées auto. <em>Esc pour annuler.</em>`;
    } else {
      const learned = Object.keys(state.zoneColors).length;
      hint.innerHTML = `<strong>🗺️ Mapper (auto).</strong><br />
        Clique <strong>une fois à l'intérieur</strong> d'une room sur la s_map → un popup te propose les rooms candidates filtrées par couleur de zone.<br />
        ${learned > 0 ? `${learned} zone(s) apprises — filtre actif.` : 'Place 1-2 rooms pour calibrer le filtre couleur.'}`;
    }
  } else {
    if (!mapperUI.selectedRoom) {
      hint.innerHTML = `<strong>🗺️ Mode 2-clic.</strong><br />Sélectionne une room dans la liste, puis clique <strong>2 fois sur la map</strong> (TL puis BR).`;
    } else if (!mapperUI.firstClick) {
      hint.innerHTML = `<strong>📍 ${mapperUI.selectedRoom}</strong> — clique le <strong>coin haut-gauche</strong>. <em>Esc pour annuler.</em>`;
    } else {
      hint.innerHTML = `<strong>📍 ${mapperUI.selectedRoom}</strong> — clique maintenant le <strong>coin bas-droit</strong>. <em>Esc pour annuler.</em>`;
    }
  }
}

function handleMapperClick(latlng) {
  // Mode auto-détection (par défaut) : 1 clic dans une room → détection auto
  if (mapperUI.useAutoDetect) {
    if (mapperUI.selectedRoom) {
      // Si une room est pré-sélectionnée depuis la liste, on l'utilise direct
      autoDetectAndMap(latlng, mapperUI.selectedRoom);
    } else {
      autoDetectAndMap(latlng, null);
    }
    return;
  }

  // Mode 2-clic manuel (fallback)
  if (!mapperUI.selectedRoom) {
    toast('Sélectionne d\'abord une room dans la liste à gauche');
    return;
  }
  if (!mapperUI.firstClick) {
    mapperUI.firstClick = latlng;
    updateMapperHint();
    toast('Coin 1/2 enregistré — clique le coin bas-droit');
    return;
  }
  const tlX = Math.min(mapperUI.firstClick.lng, latlng.lng);
  const tlY = Math.min(mapperUI.firstClick.lat, latlng.lat);
  const brX = Math.max(mapperUI.firstClick.lng, latlng.lng);
  const brY = Math.max(mapperUI.firstClick.lat, latlng.lat);
  const w = brX - tlX, h = brY - tlY;
  if (w < 3 || h < 3) {
    toast('Rectangle trop petit, recommence');
    mapperUI.firstClick = null;
    updateMapperHint();
    return;
  }
  finalizeRoomMapping(mapperUI.selectedRoom, { x: tlX, y: tlY, w, h });
  mapperUI.firstClick = null;
  mapperUI.selectedRoom = null;
  updateMapperHint();
}

function autoDetectAndMap(latlng, preselectedRoom) {
  const px = latlngToPixel(latlng);
  const detected = floodFillBounds(mapPixelData, px.x, px.y);
  if (!detected) {
    toast('Clic en dehors d\'une room. Vise l\'intérieur d\'un rectangle coloré.');
    return;
  }

  const rect = pixelRectToLeafletRect(detected);

  // Si une room est déjà pré-sélectionnée → on map direct
  if (preselectedRoom) {
    finalizeRoomMapping(preselectedRoom, rect, detected.color);
    mapperUI.selectedRoom = null;
    updateMapperHint();
    return;
  }

  // Sinon → on ouvre le picker à côté du clic
  showRoomPicker(latlng, rect, detected.color);
}

function showRoomPicker(clickLatlng, rect, color) {
  closePickerPopup();

  // Visualiser le rectangle détecté
  mapperUI.pendingRect = L.rectangle(
    [[rect.y, rect.x], [rect.y + rect.h, rect.x + rect.w]],
    { color: '#22c55e', weight: 2, fillOpacity: 0.18, dashArray: '4 4', interactive: false }
  ).addTo(map);

  mapperUI.pendingDetection = { rect, color };

  const candidates = rankRoomsForColor(color).slice(0, 30);
  const colorHex = `rgb(${color.r},${color.g},${color.b})`;
  const learnedZones = Object.entries(state.zoneColors).length;

  const html = `
    <div class="room-picker">
      <div class="rp-head">
        <span class="rp-swatch" style="background:${colorHex}"></span>
        <span class="rp-title">Quelle room ?</span>
      </div>
      <input class="rp-search" placeholder="Filtrer par nom (ex: AE_)…" />
      <div class="rp-list">
        ${candidates.map(c => renderCandidate(c)).join('')}
      </div>
      <div class="rp-hint">
        ${learnedZones > 0
          ? `${learnedZones} zone(s) déjà apprise(s) — tri par proximité de couleur`
          : 'Aucune zone apprise — placez 1-2 rooms manuellement pour calibrer le filtre'}
      </div>
    </div>`;

  const popup = L.popup({
    maxWidth: 360, minWidth: 280, autoClose: false, closeOnClick: false,
    className: 'room-picker-popup'
  })
    .setLatLng(clickLatlng)
    .setContent(html)
    .openOn(map);

  mapperUI.pickerPopup = popup;

  setTimeout(() => bindPickerHandlers(), 0);
}

function renderCandidate(c) {
  const colorTag = c.learnedColor
    ? `<span class="rp-color-tag" style="background:rgb(${c.learnedColor.r},${c.learnedColor.g},${c.learnedColor.b})"></span>`
    : '<span class="rp-color-tag" style="background:#444"></span>';
  return `<div class="rp-item ${c.mapped ? 'mapped' : ''}" data-room="${c.name}">
    ${colorTag}
    <span class="rp-name">${c.name}</span>
    <span class="rp-meta">${escapeHtml(c.summary)}</span>
    ${c.mapped ? '<span class="rp-tag">déjà ✓</span>' : ''}
  </div>`;
}

function bindPickerHandlers() {
  const root = document.querySelector('.room-picker');
  if (!root) return;

  const search = root.querySelector('.rp-search');
  search.focus();
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    root.querySelectorAll('.rp-item').forEach(el => {
      const name = el.dataset.room.toLowerCase();
      const meta = el.textContent.toLowerCase();
      el.style.display = (name.includes(q) || meta.includes(q)) ? '' : 'none';
    });
  });

  root.querySelectorAll('.rp-item').forEach(el => {
    el.addEventListener('click', () => {
      const roomName = el.dataset.room;
      const det = mapperUI.pendingDetection;
      if (!det) return;
      finalizeRoomMapping(roomName, det.rect, det.color);
      closePickerPopup();
    });
  });
}

function closePickerPopup() {
  if (mapperUI.pendingRect) {
    map.removeLayer(mapperUI.pendingRect);
    mapperUI.pendingRect = null;
  }
  if (mapperUI.pickerPopup) {
    map.closePopup(mapperUI.pickerPopup);
    mapperUI.pickerPopup = null;
  }
  mapperUI.pendingDetection = null;
}

function finalizeRoomMapping(roomName, rect, detectedColor) {
  state.roomMappings[roomName] = rect;
  if (detectedColor) learnZoneColor(roomName, detectedColor);
  state.markers = state.markers.filter(m => !(m.id && m.id.startsWith(`dm_${roomName}_`)));
  const room = datamine[roomName];
  if (room) spawnMarkersFromRoom(roomName, room, rect);
  saveState();
  renderMarkers();
  renderSidebar();
  renderRoomRects();
  renderMapperList();
  const n = state.markers.filter(m => m.id && m.id.startsWith(`dm_${roomName}_`)).length;
  toast(`${roomName} mappée — ${n} item(s) placé(s)`);
}

function spawnMarkersFromRoom(roomName, room, rect) {
  // Les coords y de Leaflet vont du bas vers le haut, mais la s_map (comme
  // toute image) a y=0 en haut. L'imageOverlay avec bounds [[0,0],[H,W]]
  // place l'image avec y=H en haut et y=0 en bas. Donc lat (Leaflet y)
  // correspond à (H - imagePixelY). Ici on travaille en coords "image"
  // pour le rect (TL = haut gauche de l'image), mais on stocke en coords
  // Leaflet pour rester cohérent avec les autres markers.
  // → quand on convertit la position d'un item DANS sa room (x, y image)
  //   on doit aussi inverser le y.
  for (let i = 0; i < room.instances.length; i++) {
    const inst = room.instances[i];
    const meta = window.CC_DATAMINE.categorize(inst.obj);
    if (!meta) continue;
    const relX = inst.x / room.width;
    const relY = inst.y / room.height;
    const mapX = rect.x + relX * rect.w;
    const mapY_image = rect.y + (1 - relY) * rect.h;  // inverse Y dans le rect
    // mais rect.y est déjà en coords Leaflet (du clic), donc... laisse moi reflechir
    // Les clics sur la map donnent des latlng en coords Leaflet (y up).
    // Pour 2 clics TL+BR sur une room, rect.y = min(lat1, lat2) = "bas" en Leaflet
    // rect.h = brY - tlY > 0
    // Donc rect.y est le BAS de la room en Leaflet (= en bas de l'image visuellement).
    // Hmm, c'est contre-intuitif. L'utilisateur a cliqué "TL puis BR" sur l'image,
    // mais en Leaflet le TL de l'image a un Y plus GRAND que le BR.
    // → firstClick (TL visuel) a un lat plus grand, latlng final (BR) a un lat plus petit
    // → min(...) donne lat du BR visuel → rect.y = bas visuel
    // → rect.y + rect.h = haut visuel
    // Pour un item à relY=0 (haut dans la room), il faut lat = rect.y + rect.h
    // Pour relY=1 (bas dans la room), il faut lat = rect.y
    // Donc lat = rect.y + (1 - relY) * rect.h ✓
    state.markers.push({
      id: `dm_${roomName}_${i}`,
      category: meta.cat,
      name: meta.label,
      x: mapX,
      y: mapY_image,
      notes: `Room ${roomName} · ${inst.obj}`,
      found: false
    });
  }
}

/* Toggle mode mapper */
document.getElementById('mapper-toggle').addEventListener('click', () => {
  state.mapperMode = !state.mapperMode;
  if (state.mapperMode) {
    state.adminMode = false;
    state.collectMode = false;
  }
  mapperUI.selectedRoom = null;
  mapperUI.firstClick = null;
  saveState();
  refreshModeUI();
  if (state.mapperMode) renderMapperList();
  toast(state.mapperMode ? 'Mode Mapper activé' : 'Mode Mapper désactivé');
});

document.getElementById('mapper-search').addEventListener('input', (e) => {
  mapperUI.search = e.target.value;
  renderMapperList();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.mapperMode) {
    closePickerPopup();
    mapperUI.selectedRoom = null;
    mapperUI.firstClick = null;
    updateMapperHint();
    renderMapperList();
  }
});

/* Démarre le chargement du datamine */
initDatamine();

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
