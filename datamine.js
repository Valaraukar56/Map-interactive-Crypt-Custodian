/* ============================================================
   datamine.js — charge le dump du data.win et expose des helpers
   ============================================================ */

(function () {
  // Mapping nom d'objet GM -> catégorie de l'app + label de base.
  // Les noms en commentaire indiquent l'origine in-game (wiki / data.win).
  const OBJECT_CATEGORIES = {
    // === COLLECTIBLES SÛRS (matchs exacts avec les totaux du wiki) ===
    'o_cd':              { cat: 'disc',    label: 'Jukebox Disc' },           // 20 instances = 20 disques wiki
    'o_curse':           { cat: 'curse',   label: 'Curse Skull' },            // 10 = 10 curses wiki
    'o_crouton':         { cat: 'picture', label: 'Crouton' },                // photo NPC
    'o_constellation':   { cat: 'special', label: 'Special Attack' },         // 1 des 8 specials
    'o_special':         { cat: 'special', label: 'Special Attack' },         // autres specials
    'o_ability':         { cat: 'ability', label: 'Ability' },                // capacité movement
    'o_ability_newareas':{ cat: 'ability', label: 'Ability (new areas)' },

    // === NPCs (potentiellement photographiables = pictures du 100%) ===
    'o_mira':            { cat: 'npc', label: 'Mira' },
    'o_mira_follow':     { cat: 'npc', label: 'Mira (follow)' },
    'o_grizznpc':        { cat: 'npc', label: 'Grizz' },
    'o_grizz_follow':    { cat: 'npc', label: 'Grizz (follow)' },
    'o_grizz_inhole':    { cat: 'npc', label: 'Grizz (in hole)' },
    'o_grizz_cutscene':  { cat: 'npc', label: 'Grizz (cutscene)' },
    'o_grizz_headbang':  { cat: 'npc', label: 'Grizz (headbang)' },
    'o_pebble_follow':   { cat: 'npc', label: 'Pebble' },
    'o_pebbles_broom':   { cat: 'npc', label: 'Pebble (broom)' },
    'o_marla_npc':       { cat: 'npc', label: 'Marla' },
    'o_kendra_npc':      { cat: 'npc', label: 'Kendra (NPC)' },
    'o_kendra_at_bar':   { cat: 'npc', label: 'Kendra (au bar)' },
    'o_roy_npc':         { cat: 'npc', label: 'Roy' },
    'o_skully_npc':      { cat: 'npc', label: 'Skully' },
    'o_skully_follow':   { cat: 'npc', label: 'Skully (follow)' },
    'o_wailer':          { cat: 'npc', label: 'Wailer' },
    'o_wailer_follow':   { cat: 'npc', label: 'Wailer (follow)' },
    'o_frognpc':         { cat: 'npc', label: 'Frog NPC' },
    'o_NPC':             { cat: 'npc', label: 'NPC' },
    'o_guidenpc':        { cat: 'npc', label: 'Guide NPC' },
    'o_imposter_npc':    { cat: 'npc', label: 'Imposter NPC' },
    'o_bartender':       { cat: 'npc', label: 'Bartender' },
    'o_jukebox':         { cat: 'npc', label: 'Jukebox (Sinner\'s Inn)' },
    'o_crouton_follow':  { cat: 'npc', label: 'Crouton (follow)' },
    'o_croutontrigger':  { cat: 'npc', label: 'Crouton (trigger)' },
    'o_croutontrigger2': { cat: 'npc', label: 'Crouton (trigger 2)' },
    'o_crouton_ice':     { cat: 'npc', label: 'Crouton (ice)' },
    'o_crouton_trigger': { cat: 'npc', label: 'Crouton (trigger)' },

    // === BOSSES ===
    'o_pot_boss':            { cat: 'boss', label: 'Pot Full of Spiders' },
    'o_kendra_boss':         { cat: 'boss', label: 'Kendra (Boss)' },
    'o_kendra_boss_control': { cat: 'boss', label: 'Kendra (Boss control)' },
    'o_kendra_boss_trigger': { cat: 'boss', label: 'Kendra (Boss trigger)' },
    'o_4boss_control':       { cat: 'boss', label: 'AT Boss' },
    'o_ap_boss':             { cat: 'boss', label: 'AP Boss' },
    'o_theatre_boss':        { cat: 'boss', label: 'Theatre Boss' },
    'o_neonboss_control':    { cat: 'boss', label: 'Neon Boss' },
    'o_neonboss_trigger':    { cat: 'boss', label: 'Neon Boss (trigger)' },
    'o_griefboss':           { cat: 'boss', label: 'Grief Boss' },
    'o_moon_man_boss':       { cat: 'boss', label: 'Moon Man Boss' },
    'o_sculptor_boss':       { cat: 'boss', label: 'Sculptor Boss' },
    'o_sculptor_boss_top':   { cat: 'boss', label: 'Sculptor Boss (top)' },
    'o_player_sculpt_boss':  { cat: 'boss', label: 'Sculptor Boss (player)' },
    'o_slimeboss':           { cat: 'boss', label: 'Slime Boss' },
    'o_slimebosstrigger':    { cat: 'boss', label: 'Slime Boss (trigger)' },
    'o_imposterboss_trigger':{ cat: 'boss', label: 'Imposter Boss (trigger)' },
    'o_boss_trigger_bug':    { cat: 'boss', label: 'Bug Boss (trigger)' },
    'o_boss1_trigger_new':   { cat: 'boss', label: 'Boss 1 (trigger)' },
    'o_piece_boss2':         { cat: 'boss', label: 'Piece Boss 2' },
    'o_piece_boss3':         { cat: 'boss', label: 'Piece Boss 3' },
    'o_piece_boss4':         { cat: 'boss', label: 'Piece Boss 4' },

    // === SAVES / SHRINES (utile pour se repérer) ===
    'o_saveshrine':   { cat: 'secret', label: 'Save Shrine' },
    'o_health_shrine':{ cat: 'secret', label: 'Health Shrine' }
  };

  // Objets à ignorer absolument (background, décor, particules).
  const IGNORE_OBJECTS = new Set([
    'o_edge_vase_1', 'o_edge_vase_2',     // décoration (300+ instances)
    'o_vase1_a1', 'o_vase2_a1', 'o_vase3_a1', 'o_vase4_a1',
    'o_tower_vase1', 'o_tower_vase2',
    'o_bushmira', 'o_bushmira2', 'o_bushmira3', 'o_bushmira4',
    'o_beam_mira', 'o_bg_spirit_mush', 'o_constellation_neon',
    'o_bar_seat', 'o_bar_table', 'o_fg_treemira', 'o_school_mira',
    'o_mouse_pebble', 'o_mouse_bygrizz',
    'o_candle_miradepth', 'o_statue_4boss4', 's_candle_behindmira',
    'o_statue_4boss2', 'o_statue_4boss1', 'o_statue_4boss3',
    'o_stone_mira1', 'o_elevator_bar',
    'o_beetle_bar_vert', 'o_top_bar_beetle', 'o_bottom_bar_beetle',
    'o_plat_apboss', 'o_plat_to_boss',
    's_tablevase', 'o_miratable', 'o_miratablecloth', 'o_dinner_cutscene',
    'o_shop_table', 'o_miniboss_back', 'o_miniboss_tower', 'o_miniboss_tower2',
    'o_miniboss_water', 'o_miniboss_draw', 'o_nocurse_enemies',
    'o_trigger_bar2', 'o_bar_end_cs', 'o_bar_cs', 'o_bar_character_manager',
    'o_hole_grizz', 'o_bossrush_info'
  ]);

  // Catégorise un objet — retourne null si à ignorer.
  function categorize(objName) {
    if (IGNORE_OBJECTS.has(objName)) return null;
    return OBJECT_CATEGORIES[objName] || null;
  }

  // Pour chaque room, retourne un résumé "human-readable" du contenu
  // (utile pour que l'utilisateur reconnaisse la room sur la map).
  function summarizeRoom(room) {
    const counts = {};
    for (const inst of room.instances) {
      const c = categorize(inst.obj);
      if (!c) continue;
      const key = c.label;
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([k, v]) => v > 1 ? `${v}× ${k}` : k)
      .join(', ');
  }

  // Compte total d'items catégorisables dans une room.
  function countInteresting(room) {
    let n = 0;
    for (const inst of room.instances) {
      if (categorize(inst.obj)) n++;
    }
    return n;
  }

  // Chargement asynchrone du dump.
  async function load() {
    try {
      const res = await fetch('Export/crypt_custodian_export.json');
      if (!res.ok) throw new Error('Fichier datamine introuvable (' + res.status + ')');
      const data = await res.json();
      const roomsByName = {};
      for (const r of data.rooms) roomsByName[r.name] = r;
      return roomsByName;
    } catch (err) {
      console.warn('[datamine] échec chargement :', err.message);
      return null;
    }
  }

  window.CC_DATAMINE = { load, categorize, summarizeRoom, countInteresting, OBJECT_CATEGORIES };
})();
