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

    // Fallback : anchors statiques de référence (rooms non-couvertes par la save courante)
    const ref = window.CC_ANCHORS_REFERENCE;
    if (ref) {
      for (const [room, refEntries] of Object.entries(ref)) {
        if (anchors[room]) continue;  // déjà couvert par la save courante
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

  function parseGameInfoFromKey(key, room) {
    // Hidden markers: key = "Room+x,y" → on extrait (x, y) en game pixels
    if (!key || !key.startsWith(room)) return null;
    const rest = key.slice(room.length);
    const m = /^(\d+),(\d+)$/.exec(rest);
    if (!m) return null;
    return { x: parseInt(m[1], 10), y: parseInt(m[2], 10) };
  }

  /* Liste TOUS les items connus (data.win) avec status + position s_map estimée.
     Utilise les anchors pour convertir (room_pixel) -> (s_map unit).
     Returns: [{ category, room, gameX, gameY, smapX, smapY, found, label }] */
  function listAllItems(datamine, persistent, jukeMap, main, anchors) {
    const pvKeys = new Set(Object.keys(persistent));
    const items = [];
    // Ratio empirique : 1 game-pixel ≈ 0.0013 s_map units
    const SCALE = 0.0013;

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

    for (const room of datamine.rooms) {
      const roomAnchors = anchors[room.name] || [];
      if (roomAnchors.length === 0) continue;  // skip rooms sans anchor

      // Choisit le meilleur anchor : si y'en a un avec gameInfo, on s'en sert
      // (positionnement précis). Sinon on prend le 1er disponible.
      const anchorWithGame = roomAnchors.find(a => a.gameInfo) || roomAnchors[0];

      for (const inst of room.instances) {
        const meta = objToCat[inst.obj];
        if (!meta) continue;
        const key = `${room.name}-${inst.x}-${inst.y}`;
        const found = pvKeys.has(key);

        // Estime position s_map
        let smapX = anchorWithGame.smap_xpos;
        let smapY = anchorWithGame.smap_ypos;
        if (anchorWithGame.gameInfo) {
          smapX += (inst.x - anchorWithGame.gameInfo.x) * SCALE;
          smapY += (inst.y - anchorWithGame.gameInfo.y) * SCALE;
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
          found
        });
      }
    }
    return items;
  }

  window.CC_SAVE = { parseSaveFile };
})();
