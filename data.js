/* ============================================================
   Crypt Custodian — données de la map interactive
   ============================================================
   Base map : s_map.png (sprite officiel extrait du data.win, 2580x880).
   Catégories : config (icône, couleur, total attendu pour 100%)
   Markers : positions en coords s_map (pixels natifs).
   ============================================================ */

const MAP_WIDTH = 2580;
const MAP_HEIGHT = 880;
const MAP_IMAGE = 's_map.png';

const CATEGORIES = {
  picture:       { name: 'Pictures (photos)',      icon: '📷', color: '#fbbf24', total: 33 },
  disc:          { name: 'Jukebox Discs',          icon: '💿', color: '#a855f7', total: 20 },
  spirit:        { name: 'Trapped Spirits',        icon: '👻', color: '#22d3ee', total: 20 },
  curse:         { name: 'Curses (skulls)',        icon: '💀', color: '#ef4444', total: 10 },
  upgradePoint:  { name: 'Upgrade Points',         icon: '✨', color: '#84cc16', total: 64 },
  upgrade:       { name: 'Upgrades',               icon: '⚡', color: '#f97316', total: 32 },
  special:       { name: 'Special Attacks',        icon: '⭐', color: '#ec4899', total: 8  },
  ability:       { name: 'Abilities (movement)',   icon: '🦘', color: '#3b82f6', total: 8  },
  boss:          { name: 'Bosses',                 icon: '💢', color: '#dc2626', total: 0  },
  npc:           { name: 'NPCs / Shops',           icon: '🏠', color: '#f8fafc', total: 0  },
  area:          { name: 'Zone Labels',            icon: '🗺️', color: '#94a3b8', total: 0  },
  secret:        { name: 'Secrets / Notes',        icon: '❓', color: '#fde047', total: 0  }
};

/* ------------------------------------------------------------
   Noms connus (auto-suggestion lors du placement).
   Sources : wiki Crypt Custodian + guides Steam.
   À compléter / corriger au fur et à mesure du 100%.
   ------------------------------------------------------------ */
const KNOWN_NAMES = {
  upgrade: [
    'Heart Capsule', "Spirit's Buffer", 'All Seeing Eye', 'Ditch Effort',
    'Item Tracker', 'Slime Scraper', 'Better Broom', 'Hopping Hazard',
    'Quick Draw', 'Heavy Hitter', 'Bite Back', 'Feet First',
    'Spiky Demise', 'Fresh Start', 'Better Broomerang', 'Whirling Reaper',
    'Quick Foot', 'Dash Blaster', 'Power Surge', 'Haunted Helper',
    'Trash Basher', 'Sharp Sweep', 'Desperate Swing', 'Flawless Bounty',
    'Bigger Buffer', "Hoarder's Reward", 'Quick Block', 'Bigger Broom-erang',
    'Wide Reach', 'Final Flurry', 'Steady Flurry', 'Super Slam'
  ],
  special: [
    'Super Sweep', 'Land Mines', 'Fireball', 'Constellation',
    "Spirit's Shield", 'Aimless Archer', 'Locked On', 'Mystery Shot'
  ],
  ability: [
    'Double Jump', 'Dash', 'Wall Climb', 'Broomerang',
    'Ground Pound', 'Glide', 'Hook', 'Bounce'
  ],
  boss: [
    'Pot Full of Spiders', 'Stone Golem', 'Kendra', 'The Ice Witch',
    'Skully', 'Pearl', 'Final Boss'
  ],
  npc: [
    'Mira', 'Grizz', 'Roy', 'Pebble', 'Wailer', 'Marla'
  ],
  area: [
    'The Palace', 'Weeping Wastes', "Pearl's Shrine", "Sculptor's Peak",
    'The Tower', "Mira's Basement", 'Neon Crest', "Kendra's Crying Chamber",
    'Frosty Ridge', 'The Edge', 'Secret Shrines', "Sinner's Inn"
  ]
};

/* ------------------------------------------------------------
   Marqueurs initiaux.
   On commence avec quelques labels de zones approximatifs.
   L'utilisateur ajoutera le reste via le mode édition.
   Positions [y, x] où y=0 est en bas, y=MAP_HEIGHT en haut.
   ------------------------------------------------------------ */
/* Pas de markers initiaux : on les placera via le pipeline data.win
   (Room Mapper Tool → import auto depuis crypt_custodian_export.json). */
const INITIAL_MARKERS = [];

/* helpers exposés */
window.CC_DATA = { MAP_WIDTH, MAP_HEIGHT, MAP_IMAGE, CATEGORIES, KNOWN_NAMES, INITIAL_MARKERS };
