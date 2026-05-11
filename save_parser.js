/* ============================================================
   save_parser.js — Parse les .sav de Crypt Custodian côté browser
   ============================================================
   Format:
   - Fichier = ASCII text, chaque pair de chars = 1 byte hex
   - Top-level: u32 version + u32 count + entries
     each entry: u32 type1, u32 keylen, key, u32 type2, u32 vlen, value_bytes
   - "main" sub-format: u32 version + u32 count + entries
     each entry: u32 type1, u32 keylen, key, u32 vtype, value
       vtype=0: 8 bytes double
       vtype=1: u32 strlen + string
   ============================================================ */

(function () {
  const ASCII = new TextDecoder('ascii');
  const LATIN1 = new TextDecoder('latin1');

  function u32(buf, off) {
    return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
  }

  function f64(buf, off) {
    const dv = new DataView(buf.buffer, buf.byteOffset + off, 8);
    return dv.getFloat64(0, true);
  }

  function hexDecode(text) {
    if (!text) return null;
    if (text.length % 2 !== 0) text = text.slice(0, -1);
    if (!/^[0-9a-fA-F]*$/.test(text)) return null;
    const out = new Uint8Array(text.length / 2);
    for (let i = 0; i < text.length; i += 2) {
      out[i / 2] = parseInt(text.substr(i, 2), 16);
    }
    return out;
  }

  // Parse le top-level (chaque value est length-prefixed)
  function parseTop(data) {
    const count = u32(data, 4);
    const out = {};
    let off = 8;
    for (let i = 0; i < count && off + 8 <= data.length; i++) {
      const type1 = u32(data, off); off += 4;
      const klen = u32(data, off); off += 4;
      if (off + klen > data.length) break;
      const key = ASCII.decode(data.subarray(off, off + klen)); off += klen;
      if (off + 8 > data.length) break;
      const type2 = u32(data, off); off += 4;
      const vlen = u32(data, off); off += 4;
      if (off + vlen > data.length) break;
      out[key] = data.subarray(off, off + vlen);
      off += vlen;
    }
    return out;
  }

  // Parse une section interne (main, _juke_wrapper) : valeurs typées
  // Retourne { key: value } où value est un number (double) ou une string.
  function parseTyped(data) {
    if (!data || data.length < 8) return {};
    const count = u32(data, 4);
    const out = {};
    let off = 8;
    for (let i = 0; i < count && off + 8 <= data.length; i++) {
      const type1 = u32(data, off); off += 4;
      const klen = u32(data, off); off += 4;
      if (off + klen > data.length) break;
      const key = LATIN1.decode(data.subarray(off, off + klen)); off += klen;
      if (off + 4 > data.length) break;
      const vtype = u32(data, off); off += 4;
      if (vtype === 0) {
        if (off + 8 > data.length) break;
        out[key] = f64(data, off); off += 8;
      } else if (vtype === 1) {
        if (off + 4 > data.length) break;
        const slen = u32(data, off); off += 4;
        if (off + slen > data.length) break;
        out[key] = ASCII.decode(data.subarray(off, off + slen));
        off += slen;
      } else {
        // Type inconnu : on s'arrête.
        break;
      }
    }
    return out;
  }

  // Parse _persistent_vars : format JSON-value (value is a single byte/number = 1)
  // The values are stored as JSON-encoded "1" essentially. We treat all as collected.
  function parsePersistent(data) {
    return parseTyped(data);
  }

  // API principale — prend un ArrayBuffer du fichier .sav et retourne un rapport.
  async function parseSaveFile(arrayBuffer) {
    const text = ASCII.decode(new Uint8Array(arrayBuffer)).trim();
    const data = hexDecode(text);
    if (!data) throw new Error('Le fichier ne semble pas être un .sav Crypt Custodian (pas du hex valide)');

    const top = parseTop(data);

    // Décode les sous-maps importantes
    const mainData = top['main'] ? hexDecode(ASCII.decode(top['main'])) : null;
    const jukeData = top['_juke_wrapper'] ? hexDecode(ASCII.decode(top['_juke_wrapper'])) : null;
    const persData = top['_persistent_vars'] ? hexDecode(ASCII.decode(top['_persistent_vars'])) : null;
    const teleData = top['_teleporter_wrapper'] ? hexDecode(ASCII.decode(top['_teleporter_wrapper'])) : null;

    const main = mainData ? parseTyped(mainData) : {};
    const juke = jukeData ? parseTyped(jukeData) : {};
    const persistent = persData ? parsePersistent(persData) : {};
    const teleporters = teleData ? parseTyped(teleData) : {};

    // Hidden map markers (peuvent contenir des indices sur curses non-cassées)
    const hiddenData = top['_map_mark_hidden_wrapper'] ? hexDecode(ASCII.decode(top['_map_mark_hidden_wrapper'])) : null;
    const hidden = hiddenData ? parseTyped(hiddenData) : {};

    return buildReport(main, juke, persistent, teleporters, hidden);
  }

  // Compte les indices N tels que prefix+N == valueRequired
  function countIndices(map, prefix, valueRequired = 1) {
    const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
    const out = [];
    for (const k of Object.keys(map)) {
      const m = re.exec(k);
      if (m && map[k] === valueRequired) out.push(parseInt(m[1], 10));
    }
    return out.sort((a, b) => a - b);
  }

  function buildReport(main, juke, persistent, teleporters, hidden) {
    const pics = countIndices(main, 'pics');
    const upgrades = countIndices(main, 'upgrade_list');
    const upgradesActive = countIndices(main, 'upgrade_list_active');
    const abilities = countIndices(main, 'ability_list');

    // Croise avec data.win si disponible pour identifier les manquants précis
    const datamine = window.CC_DATAMINE_DATA;
    const missingByCat = datamine ? identifyMissing(datamine, persistent, hidden) : null;

    // Construit l'index des anchors room -> s_map
    const anchors = buildRoomAnchors(teleporters, hidden, null);
    const allItems = datamine ? listAllItems(datamine, persistent, juke, main, anchors) : [];

    return {
      categories: {
        pictures:  { found: pics.length,      total: 36, indices: pics },
        upgrades:  { found: upgrades.length,  total: 32, indices: upgrades, equipped: upgradesActive.length },
        abilities: { found: abilities.length, total: 8,  indices: abilities },
        curses:    { found: Math.round(main.curses_beat || 0), total: 10, missing: missingByCat?.curses || [] },
        spirits:   { found: Math.round(main.catghosts || 0),   total: 20 },
        jukebox:   { found: Object.keys(juke).length,          total: 20, songs: Object.keys(juke).sort() }
      },
      stats: {
        percent:           main.percent || 0,
        enemies_killed:    Math.round(main.enemies_killed || 0),
        attacks_swung:     Math.round(main.attacks_swung || 0),
        specials_used:     Math.round(main.specials_used || 0),
        attack_strength:   main.attack_strength || 0,
        player_health_max: main.player_health_max || 0,
        bought_slots:      Math.round(main.bought_slots || 0),
        times_died:        Math.round(main.times_died || 0),
        gametime:          Math.round(main.gametime || 0),
        garbage:           Math.round(main.garbage || 0),
        stickers:          Math.round(main.stickers || 0),
        current_room:      main.current_room || '?',
        difficulty:        Math.round(main.difficulty || 0)
      },
      teleporters: Object.values(teleporters)
        .map(v => { try { return JSON.parse(v); } catch { return null; } })
        .filter(Boolean),
      hiddenMarkers: Object.values(hidden)
        .map(v => { try { return JSON.parse(v); } catch { return null; } })
        .filter(Boolean),
      persistent_keys_count: Object.keys(persistent).length,
      allItems,          // tous les data.win items avec status + smap position estimée
      roomAnchors: anchors
    };
  }

  // Cross-référence data.win avec persistent_vars pour identifier les
  // collectibles manquants par catégorie.
  function identifyMissing(datamine, persistent, hidden) {
    const out = { curses: [] };
    const pvKeys = new Set(Object.keys(persistent));
    const hiddenByRoom = {};
    for (const v of Object.values(hidden)) {
      try {
        const h = JSON.parse(v);
        if (h._room) {
          (hiddenByRoom[h._room] = hiddenByRoom[h._room] || []).push(h);
        }
      } catch {}
    }

    for (const room of datamine.rooms) {
      for (const inst of room.instances) {
        if (inst.obj === 'o_curse') {
          const key = `${room.name}-${inst.x}-${inst.y}`;
          if (!pvKeys.has(key)) {
            const hints = hiddenByRoom[room.name] || [];
            const matchHidden = hints.find(h => h._key && h._key.includes(`${inst.x},${inst.y}`));
            out.curses.push({
              room: room.name,
              x: inst.x,
              y: inst.y,
              key,
              smap_xpos: matchHidden?._xpos,
              smap_ypos: matchHidden?._ypos
            });
          }
        }
      }
    }
    return out;
  }

  // Construit un index room → anchor pour estimer la position s_map d'items
  // dans cette room. Sources prioritaires : teleporters + hidden markers de
  // LA save courante (les plus précis). Fallback : anchors_reference.json
  // (extrait d'une save couverte, propriétés fixes du jeu = valides pour toutes les saves).
  function buildRoomAnchors(teleporters, hidden, visible) {
    const anchors = {};
    function addAnchor(jsonStr) {
      try {
        const j = JSON.parse(jsonStr);
        if (!j._room) return;
        const sprite = (j._sprite_zoom || '').toLowerCase();
        if (sprite.includes('star')) return;
        (anchors[j._room] = anchors[j._room] || []).push({
          smap_xpos: j._xpos,
          smap_ypos: j._ypos,
          gameInfo: parseGameInfoFromKey(j._key, j._room)
        });
      } catch {}
    }
    for (const v of Object.values(teleporters || {})) addAnchor(v);
    for (const v of Object.values(hidden || {})) addAnchor(v);
    for (const v of Object.values(visible || {})) addAnchor(v);

    // Fallback : anchors statiques de référence
    const ref = window.CC_ANCHORS_REFERENCE;
    if (ref) {
      for (const [room, refEntries] of Object.entries(ref)) {
        if (anchors[room]) continue;
        for (const e of refEntries) {
          (anchors[room] = anchors[room] || []).push({
            smap_xpos: e.smap_xpos,
            smap_ypos: e.smap_ypos,
            gameInfo: (e.game_x != null) ? { x: e.game_x, y: e.game_y } : null,
            isFallback: true
          });
        }
      }
    }
    return anchors;
  }

  // Fallback zone-level : pour les rooms sans anchor direct, on utilise la
  // moyenne des anchors d'autres rooms ayant le même préfixe de zone (AS_*,
  // AT_*, AE_*, etc.). Approximatif mais dans la bonne zone géographique.
  function buildZoneFallback(anchors) {
    const zoneStats = {};  // prefix -> { sum_x, sum_y, count }
    for (const [room, entries] of Object.entries(anchors)) {
      const prefix = getRoomZonePrefix(room);
      if (!prefix) continue;
      const zone = zoneStats[prefix] = zoneStats[prefix] || { sum_x: 0, sum_y: 0, sum_x2: 0, sum_y2: 0, count: 0 };
      for (const e of entries) {
        zone.sum_x += e.smap_xpos;
        zone.sum_y += e.smap_ypos;
        zone.sum_x2 += e.smap_xpos * e.smap_xpos;
        zone.sum_y2 += e.smap_ypos * e.smap_ypos;
        zone.count++;
      }
    }
    // Calcule mean et variance pour chaque zone
    const out = {};
    for (const [prefix, z] of Object.entries(zoneStats)) {
      const meanX = z.sum_x / z.count;
      const meanY = z.sum_y / z.count;
      const varX = z.sum_x2 / z.count - meanX * meanX;
      const varY = z.sum_y2 / z.count - meanY * meanY;
      out[prefix] = {
        smap_xpos: meanX,
        smap_ypos: meanY,
        // Spread = stddev / 2, utilisé pour cluster les items dans la zone
        spread_x: Math.sqrt(Math.max(0, varX)) / 2,
        spread_y: Math.sqrt(Math.max(0, varY)) / 2,
        count: z.count
      };
    }
    return out;
  }

  function getRoomZonePrefix(roomName) {
    if (roomName.startsWith('APalace')) return 'APalace';
    if (roomName.startsWith('ATheatre')) return 'ATheatre';
    const m = /^(A[A-Z]?[0-9]?)_/.exec(roomName);
    if (m) return m[1];
    return null;
  }

  function parseGameInfoFromKey(key, room) {
    // Hidden markers: key = "Room+x,y" → on extrait (x, y) en game pixels
    if (!key || !key.startsWith(room)) return null;
    const rest = key.slice(room.length);
    const m = /^(\d+),(\d+)$/.exec(rest);
    if (!m) return null;
    return { x: parseInt(m[1], 10), y: parseInt(m[2], 10) };
  }

  /* Liste TOUS les items connus (data.win) avec status + position s_map estimée.
     Stratégie de placement (du plus précis au moins précis) :
       1. Match exact : un anchor existe avec game_x/game_y == position de l'item
          (cas des hidden markers pour CET item précis) → position exacte
       2. Anchor même room : placer à la position smap de l'anchor de la room
          (cluster mais zone correcte). Les items multiples dans une room
          reçoivent un petit offset radial pour ne pas se superposer.
       3. Pas d'anchor : item skipé (pas plaçable)
     Returns: [{ category, room, gameX, gameY, smapX, smapY, found, label, exact }] */
  function listAllItems(datamine, persistent, jukeMap, main, anchors) {
    const pvKeys = new Set(Object.keys(persistent));
    const items = [];

    const objToCat = {
      'o_cd':            { cat: 'disc',    label: 'Jukebox Disc' },
      'o_curse':         { cat: 'curse',   label: 'Curse Skull' },
      'o_crouton':       { cat: 'picture', label: 'Crouton' },
      'o_constellation': { cat: 'special', label: 'Special Attack' },
      'o_special':       { cat: 'special', label: 'Special Attack' },
      'o_ability':       { cat: 'ability', label: 'Ability' },
      'o_ability_newareas': { cat: 'ability', label: 'Ability' },
      'o_saveshrine':    { cat: 'secret',  label: 'Save Shrine' }
    };

    // Bornes valides en coords save (basées sur observations)
    function inBounds(x, y) {
      return x >= 0 && x <= 105 && y >= 0 && y <= 60;
    }

    // Pré-calcule le fallback zone-level
    const zoneFallback = buildZoneFallback(anchors);

    for (const room of datamine.rooms) {
      let roomAnchors = anchors[room.name] || [];
      let isZoneFallback = false;
      if (roomAnchors.length === 0) {
        // Pas d'anchor direct → fallback zone
        const prefix = getRoomZonePrefix(room.name);
        const zone = prefix && zoneFallback[prefix];
        if (!zone) continue;  // ni anchor direct ni zone → skip
        roomAnchors = [{ smap_xpos: zone.smap_xpos, smap_ypos: zone.smap_ypos,
                         gameInfo: null, spread_x: zone.spread_x, spread_y: zone.spread_y }];
        isZoneFallback = true;
      }

      // Pour chaque item, on cherche un match exact d'abord (anchor pour CET item),
      // sinon on utilise un anchor de la room avec un petit décalage radial.
      const itemsInRoom = [];
      for (const inst of room.instances) {
        const meta = objToCat[inst.obj];
        if (!meta) continue;
        itemsInRoom.push({ inst, meta });
      }
      if (itemsInRoom.length === 0) continue;

      // Calcule l'anchor "centre de la room" (moyenne des anchors)
      const centerSmapX = roomAnchors.reduce((s, a) => s + a.smap_xpos, 0) / roomAnchors.length;
      const centerSmapY = roomAnchors.reduce((s, a) => s + a.smap_ypos, 0) / roomAnchors.length;

      for (let i = 0; i < itemsInRoom.length; i++) {
        const { inst, meta } = itemsInRoom[i];
        const key = `${room.name}-${inst.x}-${inst.y}`;
        const found = pvKeys.has(key);

        // Cherche un match EXACT : anchor dont gameInfo == position de cet item
        const exactMatch = roomAnchors.find(a =>
          a.gameInfo && a.gameInfo.x === inst.x && a.gameInfo.y === inst.y);

        let smapX, smapY, exact;
        if (exactMatch) {
          smapX = exactMatch.smap_xpos;
          smapY = exactMatch.smap_ypos;
          exact = true;
        } else {
          smapX = centerSmapX;
          smapY = centerSmapY;
          // Si on est en mode fallback zone, on s'étale plus largement pour
          // couvrir la zone (pas la room individuelle qu'on ne connait pas)
          const sx = isZoneFallback ? (roomAnchors[0].spread_x || 2) : 0.15;
          const sy = isZoneFallback ? (roomAnchors[0].spread_y || 1) : 0.10;
          // Hash deterministe basé sur la room+index pour répartir
          const hash = (room.name.charCodeAt(0) * 31 + room.name.charCodeAt(room.name.length - 1) * 7 + i) % 360;
          const angle = (hash / 360) * Math.PI * 2;
          smapX += Math.cos(angle) * sx;
          smapY += Math.sin(angle) * sy;
          exact = false;
        }

        // Clamp aux bornes pour éviter les placements hors-map
        if (!inBounds(smapX, smapY)) {
          // Soit on skip, soit on clamp. On clamp.
          smapX = Math.max(0, Math.min(105, smapX));
          smapY = Math.max(0, Math.min(60, smapY));
        }

        items.push({
          category: meta.cat,
          label: meta.label,
          room: room.name,
          obj: inst.obj,
          gameX: inst.x,
          gameY: inst.y,
          smapX,
          smapY,
          found,
          exact
        });
      }
    }
    return items;
  }

  window.CC_SAVE = { parseSaveFile };
})();
