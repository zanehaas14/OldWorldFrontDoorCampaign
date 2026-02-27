import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { loadAllData, clearCache } from "./lib/dataService";
import {
  getGoogleDriveConfig,
  setGoogleDriveConfig,
  clearGoogleDriveCache,
} from "./lib/googleDriveLoader";
import { getNewRecruitWikiUrl } from "./lib/unitVerification";
import {
  writeSnapshot, readSnapshot,
  downloadBackup, parseBackupFile,
  saveToDrive, loadFromDrive,
  getDriveToken, clearDriveToken,
  getDriveClientId, setDriveClientId,
  formatAge,
} from "./lib/driveBackup";
import { isBsdataEnabled, setBsdataEnabled, clearBsdataCache } from "./lib/bsdataLoader";
import { isDatasetEnabled, setDatasetEnabled, clearDatasetCache } from "./lib/datasetLoader";
import GameView from "./GameView";
import MapView from "./MapView";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS & HELPERS (data loaded from dataService)
// ═══════════════════════════════════════════════════════════════

const FALLBACK_FACTIONS = {
  eonir: {
    name: "Eonir – Sarathel's Raiders",
    color: "#2d5a27",
    accent: "#8fbc8f",
    icon: "🌿",
  },
  tombKings: {
    name: "Tomb Kings",
    color: "#c9a227",
    accent: "#f5deb3",
    icon: "💀",
  },
  lizardmen: {
    name: "Lizardmen",
    color: "#1a6b5a",
    accent: "#7fffd4",
    icon: "🦎",
  },
  borderPrinces: {
    name: "Border Princes",
    color: "#4a2882",
    accent: "#d8b4fe",
    icon: "⚔️",
  },
};

const UNIT_CATEGORIES = [
  "Named Characters",
  "Characters",
  "Lords",
  "Heroes",
  "Core",
  "Special",
  "Rare",
  "Mercenaries",
  "Allies",
  "Custom",
];


const STORAGE_KEY = "tow-campaign-army-lists";
const CUSTOM_UNITS_KEY = "tow-campaign-custom-units";
const OVERRIDES_KEY = "tow-campaign-unit-overrides";
const CUSTOM_RULES_KEY = "tow-campaign-house-rules-custom";

// ═══════════════════════════════════════════════════════════════
// UNIT OVERRIDE SYSTEM
// ═══════════════════════════════════════════════════════════════
// Overrides let you patch any base unit without replacing it.
// Format: { [unitId]: { addSpecialRules, removeSpecialRules, addEquipment, removeEquipment,
//           statOverrides, ptsOverride, minSizeOverride, maxSizeOverride, addUpgrades, removeUpgrades, houseRuleNote } }

function applyOverride(unit, override) {
  if (!override) return unit;
  const u = JSON.parse(JSON.stringify(unit)); // deep clone
  u._hasOverride = true;
  u._overrideChanges = []; // track what changed for UI display
  u._overriddenStats = {}; // { profileIdx: { stat: newVal } } for highlighting
  u._addedRules = new Set(); // rule names added by override
  u._removedRules = new Set(); // rule names removed by override

  // Points
  if (override.ptsOverride != null && override.ptsOverride !== "") {
    const newPts = Number(override.ptsOverride);
    if (u.isCharacter) {
      if (u.ptsCost !== newPts) {
        u._overrideChanges.push(`Points: ${u.ptsCost} → ${newPts}`);
        u.ptsCost = newPts;
      }
    } else {
      if (u.ptsPerModel !== newPts) {
        u._overrideChanges.push(`Pts/model: ${u.ptsPerModel} → ${newPts}`);
        u.ptsPerModel = newPts;
      }
    }
  }

  // Size limits
  if (override.minSizeOverride != null && override.minSizeOverride !== "") {
    const v = Number(override.minSizeOverride);
    if (u.minSize !== v) { u._overrideChanges.push(`Min size: ${u.minSize} → ${v}`); u.minSize = v; }
  }
  if (override.maxSizeOverride != null && override.maxSizeOverride !== "") {
    const v = Number(override.maxSizeOverride);
    if (u.maxSize !== v) { u._overrideChanges.push(`Max size: ${u.maxSize} → ${v}`); u.maxSize = v; }
  }

  // Stat overrides (by profile index)
  if (override.statOverrides && u.profiles) {
    for (const [idxStr, stats] of Object.entries(override.statOverrides)) {
      const idx = Number(idxStr);
      if (u.profiles[idx]) {
        if (!u._overriddenStats[idx]) u._overriddenStats[idx] = {};
        for (const [stat, val] of Object.entries(stats)) {
          if (val !== "" && val != null && String(u.profiles[idx][stat]) !== String(val)) {
            u._overrideChanges.push(`${u.profiles[idx].name || "Profile"} ${stat}: ${u.profiles[idx][stat]} → ${val}`);
            u._overriddenStats[idx][stat] = { from: u.profiles[idx][stat], to: val };
            u.profiles[idx][stat] = val;
          }
        }
      }
    }
  }

  // Special rules: remove then add
  if (override.removeSpecialRules?.length && u.specialRules) {
    const lowerRemove = new Set(override.removeSpecialRules.map(r => r.toLowerCase().trim()));
    const before = u.specialRules.length;
    const removed = [];
    u.specialRules = u.specialRules.filter(r => {
      const isRemoved = lowerRemove.has(r.toLowerCase().trim()) || lowerRemove.has(r.split(":")[0].toLowerCase().trim());
      if (isRemoved) removed.push(r);
      return !isRemoved;
    });
    removed.forEach(r => u._removedRules.add(r));
    if (u.specialRules.length < before) u._overrideChanges.push(`Removed ${before - u.specialRules.length} special rule(s)`);
  }
  if (override.addSpecialRules?.length) {
    if (!u.specialRules) u.specialRules = [];
    const existingLower = new Set(u.specialRules.map(r => r.toLowerCase().trim()));
    const toAdd = override.addSpecialRules.filter(r => r.trim() && !existingLower.has(r.toLowerCase().trim()));
    if (toAdd.length) {
      u.specialRules.push(...toAdd);
      toAdd.forEach(r => u._addedRules.add(r));
      u._overrideChanges.push(`Added ${toAdd.length} special rule(s)`);
    }
  }

  // Equipment: remove then add
  if (override.removeEquipment?.length && u.equipment) {
    const lowerRemove = new Set(override.removeEquipment.map(e => e.toLowerCase().trim()));
    const before = u.equipment.length;
    u.equipment = u.equipment.filter(e => !lowerRemove.has(e.toLowerCase().trim()));
    if (u.equipment.length < before) u._overrideChanges.push(`Removed ${before - u.equipment.length} equipment`);
  }
  if (override.addEquipment?.length) {
    if (!u.equipment) u.equipment = [];
    const existingLower = new Set(u.equipment.map(e => e.toLowerCase().trim()));
    const toAdd = override.addEquipment.filter(e => e.trim() && !existingLower.has(e.toLowerCase().trim()));
    if (toAdd.length) {
      u.equipment.push(...toAdd);
      u._overrideChanges.push(`Added ${toAdd.length} equipment`);
    }
  }

  // Upgrades: remove then add
  if (override.removeUpgrades?.length && u.upgrades) {
    const removeSet = new Set(override.removeUpgrades);
    const before = u.upgrades.length;
    u.upgrades = u.upgrades.filter(up => !removeSet.has(up.id));
    if (u.upgrades.length < before) u._overrideChanges.push(`Removed ${before - u.upgrades.length} upgrade(s)`);
  }
  if (override.addUpgrades?.length) {
    if (!u.upgrades) u.upgrades = [];
    u.upgrades.push(...override.addUpgrades);
    u._overrideChanges.push(`Added ${override.addUpgrades.length} upgrade(s)`);
  }

  // House rule note
  if (override.houseRuleNote) {
    u._houseRuleNote = override.houseRuleNote;
  }

  // Convert sets to arrays for JSON serialization
  u._addedRules = [...u._addedRules];
  u._removedRules = [...u._removedRules];

  return u;
}

/** Apply all overrides to a unit array, returning patched copies. */
function applyAllOverrides(units, overrides) {
  if (!overrides || Object.keys(overrides).length === 0) return units;
  return units.map(u => {
    const ov = overrides[u.id];
    return ov ? applyOverride(u, ov) : u;
  });
}

const MAGIC_ITEM_SLOTS = ["weapons", "armour", "talismans", "enchanted", "arcane", "banners"];
const MAGIC_SLOT_LABELS = { weapons: "⚔️ Weapon", armour: "🛡 Armour", talismans: "✦ Talisman", enchanted: "✨ Enchanted", arcane: "🔮 Arcane", banners: "🚩 Banner" };

const ENCHANTED_ARROWS = [
  { name: "Moonfire Shot", ptsPerModel: 1, ptsFlat: 3 },
  { name: "Trueflight Arrows", ptsPerModel: 1, ptsFlat: 3 },
  { name: "Arcane Bodkins", ptsPerModel: 2, ptsFlat: 6 },
  { name: "Hagbane Tips", ptsPerModel: 2, ptsFlat: 6 },
  { name: "Swiftshiver Shards", ptsPerModel: 2, ptsFlat: 6 },
];

// Units that use the cheap per-model pricing (Glade Riders + infantry units)
const ARROWS_PER_MODEL_UNITS = ["we_glade_riders", "we_glade_guard", "we_deepwood_scouts", "we_waywatchers"];

// Check if a unit/character can take enchanted arrows
function canTakeEnchantedArrows(unitDef) {
  if (!unitDef) return false;
  const equip = (unitDef.equipment || []).join(" ").toLowerCase();
  const notes = (unitDef.notes || "").toLowerCase();
  return equip.includes("asrai longbow") || equip.includes("asrai bow") || notes.includes("enchanted arrows");
}

// Check if a unit from a dataset already has arrow-type exclusive options in its upgrades
// (prevents the hardcoded EnchantedArrowsPanel from showing alongside dataset arrow options)
const ARROW_OPTION_NAMES = new Set(["arcane bodkins", "hagbane tips", "moonfire shot", "swiftshiver shards", "trueflight arrows"]);
function unitHasDatasetArrowOptions(unitDef) {
  if (!unitDef?.fromDataset || !unitDef.upgrades) return false;
  return unitDef.upgrades.some(u => u.exclusive && ARROW_OPTION_NAMES.has(u.name.toLowerCase()));
}

// ── Named character magic item budgets ──────────────────────────
// Add new named characters here; budget 0 = relic only.
const NAMED_CHAR_BUDGETS = {
  "gareth":      100, // Glade Lord → Lord tier
  "daedilae":    100, // High Priestess of Kul Anar → Lord tier
  "caerwynne":   100, // High Priestess (Shadow Dancer) → Lord tier
  "rephal":       50, // Khainite Assassin → Hero tier
  "dûgalathir":    0, // Watcher of the Void — relic only
  "dugalathir":    0, // ASCII fallback
  "elenornath":    0, // Watcher of the Stars — relic only
};

function getNamedCharBudget(unitDef) {
  const nameLower = (unitDef.name || "").toLowerCase();
  for (const [key, budget] of Object.entries(NAMED_CHAR_BUDGETS)) {
    if (nameLower.startsWith(key)) return budget;
  }
  return null; // unknown — fall through to generic logic
}

// Determine which magic item slots a character can access
function getAllowedSlots(unitDef) {
  if (!unitDef?.isCharacter) return [];
  if (unitDef.allowedSlots) return unitDef.allowedSlots;
  // Named characters with 0 budget → no slots (relic only)
  if (unitDef.category === "Named Characters" || unitDef.troopType?.includes("named")) {
    const budget = getNamedCharBudget(unitDef);
    if (budget === 0) return [];
    // budget > 0: fall through to auto-detect
  }
  const slots = [];
  const notes = (unitDef.notes || "").toLowerCase();
  const rules = (unitDef.specialRules || []).join(" ").toLowerCase();
  const isWizard = rules.includes("wizard") || notes.includes("wizard") || notes.includes("lore");
  const isTreeSpirit = rules.includes("tree spirit");
  const isBSBCapable = notes.includes("bsb") || notes.includes("battle standard");
  slots.push("weapons", "talismans", "enchanted");
  if (!isWizard && !isTreeSpirit) slots.push("armour");
  if (isWizard) slots.push("arcane");
  if (isBSBCapable) slots.push("banners");
  return slots;
}

// Magic item point limits
function getMagicItemBudget(unitDef) {
  if (!unitDef?.isCharacter) return 0;
  if (unitDef.magicItemBudget != null) return unitDef.magicItemBudget;
  const match = unitDef.notes?.match(/Magic Items?\s*\((\d+)\s*pts?\)/i);
  if (match) return parseInt(match[1]);
  if (unitDef.category === "Named Characters" || unitDef.troopType?.includes("named")) {
    const budget = getNamedCharBudget(unitDef);
    return budget !== null ? budget : 50; // unknown named char → hero tier default
  }
  if (unitDef.category === "Lords") return 100;
  if (unitDef.category === "Heroes") return 50;
  return 0;
}

// Map a relic's type string to its magic item slot
function getRelicSlot(relic) {
  if (!relic || relic.name === "TBD") return null;
  if (relic.slot) return relic.slot;
  const type = (relic.type || "").toLowerCase();
  if (/weapon|sword|axe|blade|lance|spear|dagger|bow/.test(type)) return "weapons";
  if (/armou?r|armor|shield|plate|helm/.test(type)) return "armour";
  if (/talisman|pendant|locket|charm|amulet/.test(type)) return "talismans";
  if (/enchanted/.test(type)) return "enchanted";
  if (/arcane|scroll|wand|staff|rod|orb/.test(type)) return "arcane";
  if (/banner|standard/.test(type)) return "banners";
  return "enchanted";
}

function calcMagicItemsCost(magicItems) {
  if (!magicItems) return 0;
  return Object.values(magicItems).reduce((sum, item) => sum + (item?.pts || 0), 0);
}

// ═══════════════════════════════════════════════════════════════
// SPECIAL RULES REFERENCE
// ═══════════════════════════════════════════════════════════════

const SPECIAL_RULES_DESC = {
  "Evasive": "Once per Turn, when a unit in which the majority of models have this special rule is declared the target during the enemy Shooting phase, it may choose to Fall Back in Good Order, fleeing directly away from the enemy unit shooting at it. Once this unit has completed its move, the enemy unit may continue with its shooting as declared.",
  "Furious Charge": 'During a Turn in which it made a charge move of 3" or more, a model with this special rule gains a +1 modifier to its Attacks characteristic.',
  "Move Through Cover": "Models with this special rule do not suffer any modifiers to their Movement characteristic for moving through difficult or Dangerous Terrain. In addition, a model with this special rule may re-roll any rolls of 1 when making Dangerous Terrain tests.",
  "Immune to Psychology": "If the majority of the models in a unit are Immune to Psychology, the unit automatically passes any Fear, Panic or Terror tests it is required to make. However, if the majority of the models in a unit have this special rule, the unit cannot choose to Flee as a charge reaction.",
  "Loner": "A character with this special rule cannot be your General and cannot join a unit without this special rule. A unit with this special rule cannot be joined by a character without this special rule.",
  "Strike First": "During The Combat Phase, a model with this special rule that is engaged in combat improves its Initiative characteristic to 10 (before any other modifiers are applied). If a model has both this rule and Strike Last, the two rules cancel one another out.",
  "Talismanic Tattoos (6+ Ward)": "Talismanic Tattoos give their wearer a 6+ Ward save against any wounds suffered.",
  "Troubadour of Loec": "A Shadowdancer that joins a unit of Wardancers is considered to have the Dances of Loec special rule for as long as they remain with the unit.",
  "Elven Reflexes": "During the first round of any combat, a model with this special rule gains a +1 modifier to its Initiative characteristic.",
  "Woodland Ambush": "A unit with this special rule may use the Ambushers deployment method.",
  "Fear": "A unit that causes Fear is Immune to Fear itself. Enemy units in base contact must pass a Leadership test at the start of each round of combat or be reduced to WS 1.",
  "Terror": "A unit that causes Terror also causes Fear. An enemy unit charged by a Terror-causing unit must take a Panic test. Terror-causing units are Immune to both Fear and Terror.",
  "Stubborn": "A Stubborn unit ignores any negative Leadership modifiers when making a Break test after losing a combat.",
  "Hatred": "During the first round of combat, a model with Hatred may re-roll any failed To Hit rolls.",
  "Frenzy": "Frenzied models gain +1 Attack and are Immune to Psychology. They must always pursue and overrun when able, and must declare charges when possible.",
  "Killing Blow": "When rolling To Wound, a natural roll of 6 causes an automatic wound with no armour save allowed (Ward saves may still be taken).",
  "Flammable": "A model with this rule cannot make Regeneration saves against Flaming Attacks, and must re-roll successful Ward saves against Flaming Attacks.",
  "Regeneration": "After failing an armour save, a model with Regeneration may make a Regeneration save. Regeneration saves cannot be taken against Flaming Attacks.",
  "Fly": "A model with Fly may make a flying move instead of a ground move. A flying move ignores terrain and models, and is double the M value shown in parentheses.",
  "Swiftstride": "When this model makes a Pursuit, Overrun, or Flee roll, it rolls 3D6 and discards the lowest result.",
  "Close Order": "Models in this unit fight in a ranked formation and can fight in extra ranks.",
  "Skirmishers": "Skirmish units have a 360° line of sight and arc of fire. They gain +1 to hit with ranged weapons at short range and -1 to be hit with ranged attacks.",
  "Scouts": "A unit with this rule may deploy after all other non-Scout units have been deployed, either in their own deployment zone or anywhere on the table more than 12\" from enemy.",
  "Sniper": "When making a ranged attack, a model with Sniper may choose to allocate its hits against a specific model in the target unit, including characters.",
  "Fast Cavalry": "Fast Cavalry can reform at any point during their move. They have the Vanguard and Feigned Flight special rules.",
  "Devastating Charge": "During a turn in which it charged, a model with this special rule improves the Strength of its close combat attacks by 1.",
  "Vanguard": "After deployment but before the first turn, this unit may make a free move of up to its Movement value. It may not move within 12\" of the enemy.",
  "Large Target": "A model with this rule can always be seen (and see over) models without Large Target. It can always be targeted by shooting attacks regardless of other models in the way.",
  "Multiple Shots": "This model can fire additional shots with a -1 To Hit penalty.",
  "Magical Attacks": "All close combat attacks made by this model are considered magical.",
  "Tree Spirit": "This model has Regeneration (5+), is Flammable, has Immune to Psychology, Magical Attacks, and Move Through Cover.",
  "Tree Whack": "Instead of its normal attacks, a Treeman can make a single special 'Tree Whack' attack at S10 with Multiple Wounds (D6).",
  "Martial Prowess": "Models with this rule may fight in one additional rank than normal in close combat.",
  "Parry": "Models with this rule gain a 6+ Ward save in close combat when using a hand weapon and shield.",
  "Shrouded in Mist": "Natural 6s To Hit against this unit must be re-rolled.",
  "Predatory Hatred": "This unit has Hatred against Characters and Monsters.",
  "Anath Raema's Red Blessing": "If this unit causes any unsaved wounds in close combat, ALL models in the unit gain +1A for the remainder of the combat.",
  "Grim Choreography": "Daedilae may choose a dance stance at the start of each close combat phase.",
  "Bramble-Barbs": "Behemoth, Monster, or Monstrous models that suffer wounds from this weapon get -1M permanently (min 1).",
  "Dances of Loec": "At the start of each round of close combat, this unit may choose one of the Shadow Dances to apply for that round.",
  "Beguiling Aura": "Enemy models in base contact must pass a Leadership test or suffer -1 To Hit in close combat.",
  "Guardians of the Wildwood": "When fighting models that cause Fear or Terror, this model gains +1 Attack and Multiple Wounds (2).",
  "Daughters of Eternity": "This model has a 4+ Ward save.",
};

// Parse equipment strings into structured weapon data
function parseWeapons(equipment) {
  if (!equipment || equipment.length === 0) return [];
  const weapons = [];
  const nonWeapons = [];
  for (const item of equipment) {
    // Try to detect weapons by common keywords
    const isWeapon = /weapon|sword|bow|spear|lance|axe|blade|dagger|javelin|falchion|greatbow|fist|claw|root|shot|crossbow|halberd|mace|flail|whip/i.test(item);
    const isArmour = /armour|armor|shield|ward|save|bark|scales|plate/i.test(item);
    if (isWeapon && !isArmour) {
      // Parse weapon details from string
      const rangeMatch = item.match(/[Rr](\d+)[\"″]|(\d+)[\"″]/);
      const range = rangeMatch ? (rangeMatch[1] || rangeMatch[2]) + '"' : "Combat";
      const sMatch = item.match(/S[\+:]?\s*(\d+|User|[A-Z])/i) || item.match(/\(S(\+?\d+)/);
      const strength = sMatch ? "S" + (sMatch[1] || "") : "S";
      const apMatch = item.match(/AP[\s-]*(\d+|-)/i);
      const ap = apMatch ? "-" + apMatch[1].replace("-", "") : "-";
      // Get special rules (everything in parentheses that isn't S/AP/R)
      const parenContent = item.match(/\(([^)]+)\)/);
      let specRules = "-";
      if (parenContent) {
        const parts = parenContent[1].split(",").map(s => s.trim())
          .filter(s => !/^[RS]\+?\d|^AP/i.test(s) && !/^\d+[\"″]/.test(s));
        if (parts.length > 0) specRules = parts.join(", ");
      }
      const name = item.split("(")[0].trim();
      weapons.push({ name, range, strength, ap, specRules });
    } else {
      nonWeapons.push(item);
    }
  }
  // If nothing parsed as a weapon, check for "Hand Weapon" exactly
  if (weapons.length === 0) {
    const hwIdx = equipment.findIndex(e => /^hand weapon$/i.test(e.trim()));
    if (hwIdx !== -1) {
      weapons.push({ name: "Hand Weapon", range: "Combat", strength: "S", ap: "-", specRules: "-" });
      nonWeapons.splice(nonWeapons.indexOf(equipment[hwIdx]), 1);
    }
  }
  return { weapons, nonWeapons };
}

function ArmyBuilder({ data, onRefreshData }) {
  const { factions, units: baseUnits, items: magicItems, rules: houseRules } = data;
  const [activeFaction, setActiveFaction] = useState("eonir");
  // Faction-specific magic item lists (embedded static data – no extra fetch needed)
  const armyItems = {"woodElves": {"weapons": [{"name": "Spear of Twilight", "pts": 65, "type": "Magic Weapon", "description": "S, AP -2. When the wielder makes a roll To Wound, a roll of 3+ is always a success, regardless of the target's Toughness."}, {"name": "Vaul's Wrath", "pts": 55, "type": "Magic Weapon", "description": "Range 32\", S+1, AP -2. Once per game, unless the wielder moved during the previous Movement phase, Vaul's Wrath can be shot like a bolt thrower using the Through & Through special rule."}, {"name": "Blades of Loec", "pts": 45, "type": "Magic Weapon", "description": "S, AP -. The wielder may re-roll any failed rolls To Wound."}, {"name": "Bow of Loren", "pts": 40, "type": "Magic Weapon", "description": "Counts as an Asrai longbow. Range 32\", S. The wielder may make a number of shooting attacks equal to their Attacks characteristic rather than the usual one, with no modifier for multiple shots."}, {"name": "Daith's Reaper", "pts": 40, "type": "Magic Weapon", "description": "S+1, AP -1. Enemy models must re-roll any successful Armour Save rolls against wounds caused by this weapon."}, {"name": "Hunt Master's Pride", "pts": 35, "type": "Magic Weapon", "description": "Orion's Wild Hunt armies only. S, AP -2. The Multiple Wounds (2) special rule applies only against monstrous infantry, monstrous cavalry, monstrous creatures, or behemoths."}, {"name": "Blades of Endless Flame", "pts": 25, "type": "Magic Weapon", "description": "S, AP -1. All attacks made with this weapon have the Flaming Attacks special rule."}, {"name": "Asyendi's Bane", "pts": 10, "type": "Magic Weapon", "description": "Counts as an Asrai longbow. Range 32\", S. The wielder may re-roll a single failed roll To Hit during the Shooting phase. However if the re-roll also fails, the wielder suffers a single Strength 3 hit with AP -."}], "armour": [{"name": "Helm of the Hunt", "pts": 50, "type": "Magic Armour", "description": "May be worn with other armour. Improves armour value by 1 (max 2+). The wearer has a +1 modifier to both their Weapon Skill and Attacks characteristics during a turn in which they charge."}, {"name": "Mantle of Rebirth", "pts": 40, "type": "Magic Armour", "description": "Light armour. The wearer has the Regeneration (5+) special rule."}, {"name": "Railarian's Mantle", "pts": 35, "type": "Magic Armour", "description": "Light armour. Whilst the wearer is within 6\" of a woodland terrain feature, they have a 4+ Ward save against any wounds suffered."}, {"name": "Cloak of Tumbling Leaves", "pts": 30, "type": "Magic Armour", "description": "Regular or heavy infantry only. Light armour. The wearer gains the Fly (10) and Swiftstride special rules. However, the wearer cannot join a unit."}], "talismans": [{"name": "Merciw's Locus", "pts": 35, "type": "Talisman", "description": "The Strength characteristic of the bearer cannot be modified by any weapon. However, the Strength characteristic of any model that directs its attacks against the bearer during the Combat phase cannot be modified by any weapon either."}, {"name": "Ariel's Favour", "pts": 30, "type": "Talisman", "description": "The bearer has the Magic Resistance (-2) special rule."}, {"name": "Glamourweave", "pts": 30, "type": "Talisman", "description": "Enemy models must make a Leadership test before making any rolls To Hit against the wearer during the Combat phase. If the test is failed, only rolls of a natural 6 will hit."}, {"name": "Orion's Favour", "pts": 25, "type": "Talisman", "description": "Single use. The bearer may re-roll any failed rolls To Hit and/or To Wound made during the Combat phase."}], "enchanted": [{"name": "Wraithstone", "pts": 50, "type": "Enchanted Item", "description": "Unless the bearer is fleeing, enemy units suffer a -1 modifier to their Leadership characteristic (minimum 2) whilst within 6\" of the bearer."}, {"name": "Crown of Antlers", "pts": 35, "type": "Enchanted Item", "description": "The wearer gains the Armour Bane (1) and Impact Hits (D3) special rules. These Impact Hits have an AP of -2."}, {"name": "Hail of Doom Arrow", "pts": 35, "type": "Enchanted Item", "description": "Single use. Asrai longbow models only. If the roll To Hit is successful, place a small (3\") blast template over the centre of the target unit. Any model under the template suffers a single S 4 hit with AP -1 and the Magical Attacks special rule."}, {"name": "Moonstone of the Hidden Ways", "pts": 30, "type": "Enchanted Item", "description": "Single use. The wearer may cast the Forest Walker spell from the Lore of Athel Loren as a Bound spell with Power Level 3."}, {"name": "Wailing Arrow", "pts": 20, "type": "Enchanted Item", "description": "Single use. Asrai longbow models only. Any unit that suffers an unsaved wound from this shot must make a Panic test as if it had taken heavy casualties."}, {"name": "Blight-Tipped Arrows", "pts": 15, "type": "Enchanted Item", "description": "Single use. Asrai longbow models only. If an enemy model suffers an unsaved wound, at the beginning of each subsequent Start of Turn sub-phase that model must make a Toughness test. If failed, the model immediately suffers a wound with no armour or Regeneration saves permitted."}], "arcane": [{"name": "Deepwood Sphere", "pts": 45, "type": "Arcane Item", "description": "When an enemy Wizard within 6\" of a woodland terrain feature successfully casts a spell, the bearer may use this (no dispel attempt can be made). Once the spell resolves, the enemy Wizard immediately suffers D3 Strength 4 hits with AP -1."}, {"name": "Oaken Stave", "pts": 40, "type": "Arcane Item", "description": "Whilst within 3\" of a woodland terrain feature, the bearer increases their Dispel range by 3\" and may roll an extra D6 when making the Dispel roll, discarding the lowest result."}, {"name": "Orb of Midsummer", "pts": 35, "type": "Arcane Item", "description": "Once per turn, the bearer may re-roll a Casting roll."}, {"name": "Wand of Wych Elm", "pts": 30, "type": "Arcane Item", "description": "Once per turn, if the bearer is within 3\" of a woodland terrain feature, they may re-roll a failed Casting roll."}, {"name": "Sigil of the Mage Queen", "pts": 25, "type": "Arcane Item", "description": "Single use. The bearer may use it before making a Casting roll to apply a +2 modifier to that Casting roll."}, {"name": "Heartwood Pendant", "pts": 15, "type": "Arcane Item", "description": "In addition to the Lores of Magic they may normally know spells from, the bearer may also know spells from the Lore of the Wilds."}], "banners": [{"name": "Tapestry of Talsyn", "pts": 80, "type": "Magic Standard", "description": "Host of Talsyn Battle Standard Bearer only. The bearer's Command Range increases to 18\". Friendly units within Command Range improve their Leadership characteristic by 1 (max 10)."}, {"name": "Banner of the Wildwood", "pts": 40, "type": "Magic Standard", "description": "A unit carrying this banner gains the Fear special rule. If the unit already has Fear, it instead gains Terror."}, {"name": "Banner of the Hunter King", "pts": 25, "type": "Magic Standard", "description": "A unit carrying this banner gains the Vanguard special rule."}, {"name": "Banner of the Wild Hunt", "pts": 25, "type": "Magic Standard", "description": "Orion's Wild Hunt armies only. When calculating combat result, the unit may claim an additional +1 combat result point. The unit may also re-roll Pursuit rolls."}, {"name": "Standard of Morning's Chill", "pts": 25, "type": "Magic Standard", "description": "The bearer can cast the Swirling Mists spell from the Lore of the Wilds as a Bound Spell with Power Level 2."}, {"name": "Banner of Springtide", "pts": 20, "type": "Magic Standard", "description": "A unit carrying this banner gains the Quick Shot special rule."}, {"name": "Banner of the Eternal Queen", "pts": 20, "type": "Magic Standard", "description": "When calculating combat result, the unit may claim an additional +1 combat result point if within 6\" of a woodland terrain feature."}, {"name": "Banner of Midsummer's Eve", "pts": 15, "type": "Magic Standard", "description": "A unit carrying this banner gains the Ignores Cover special rule."}]}, "darkElves": {"weapons": [{"name": "Executioner's Axe", "pts": 70, "type": "Magic Weapon", "description": "S, AP -2. When making a roll To Wound, a roll of 2+ is always a success, regardless of the target's Toughness."}, {"name": "Sword of Ruin", "pts": 65, "type": "Magic Weapon", "description": "S. No armour, Ward or Regeneration saves are permitted against wounds caused by this weapon."}, {"name": "Lifetaker", "pts": 35, "type": "Magic Weapon", "description": "Range 24\", S 3, AP -1. Missile weapon firing bolts dipped in the venom of a Black Dragon."}, {"name": "Whip of Agony", "pts": 30, "type": "Magic Weapon", "description": "High Beastmasters only. S+1, AP -1. Any enemy model that suffers one or more unsaved wounds suffers a -1 modifier to its Toughness characteristic (minimum 1) for the remainder of the game."}], "armour": [{"name": "Shield of Ghrond", "pts": 40, "type": "Magic Armour", "description": "Shield. All attacks directed against the bearer suffer a -1 modifier to their Strength characteristic (minimum 1)."}, {"name": "Blood Armour", "pts": 30, "type": "Magic Armour", "description": "Infantry or cavalry only. Gives the wearer an armour value of 5+. For each unsaved wound the wearer inflicts, this armour value improves by 1, to a maximum of 2+."}], "talismans": [{"name": "Pendant of Khaeleth", "pts": 40, "type": "Talisman", "description": "The bearer has a 5+ Ward save against wounds caused by attacks with Strength 4 or lower, and a 4+ Ward save against wounds caused by attacks with Strength 5 or higher."}, {"name": "Pearl of Infinite Bleakness", "pts": 15, "type": "Talisman", "description": "The bearer and any unit they have joined gains the Immune to Psychology special rule."}], "enchanted": [{"name": "Black Dragon Egg", "pts": 35, "type": "Enchanted Item", "description": "Single use. During the Command sub-phase, the bearer may consume it. Until the end of that turn, the model has Toughness 6 (which cannot be improved further) and gains noxious breath."}, {"name": "Hydra's Tooth", "pts": 30, "type": "Enchanted Item", "description": "Missile weapon. Range 9\", S equal to the wielder's S, AP -3. This weapon can target a specific model within the target unit, such as a champion or a character."}, {"name": "The Guiding Eye", "pts": 25, "type": "Enchanted Item", "description": "Single use. The bearer and any unit they have joined may re-roll any failed rolls To Hit made during the Shooting phase."}], "arcane": [{"name": "Black Staff", "pts": 55, "type": "Arcane Item", "description": "When attempting to cast a spell, the bearer may roll an extra D6 and discard the lowest result. However, if a double 1 is rolled on any two of the dice rolled, the spell is miscast."}, {"name": "Tome of Furion", "pts": 15, "type": "Arcane Item", "description": "The bearer knows one more spell (chosen in the usual way) than is normal for their Level of Wizardry."}, {"name": "Focus Familiar", "pts": 10, "type": "Arcane Item", "description": "Single use. When the bearer attempts to cast a spell, place a marker completely within 12\" of the owner. The range and all effects of the spell are measured from this marker rather than the owner."}], "banners": [{"name": "Banner of Nagarythe", "pts": 65, "type": "Magic Standard", "description": "A unit carrying this banner gains the Stubborn special rule. When calculating combat result, the unit may claim an additional +1 combat result point."}, {"name": "Standard of Slaughter", "pts": 40, "type": "Magic Standard", "description": "When calculating combat result during a turn in which it charged, a unit carrying this standard may claim an additional +D3 combat result points."}, {"name": "Banner of Har Ganeth", "pts": 25, "type": "Magic Standard", "description": "A unit carrying this banner improves the Armour Piercing characteristic of its combat weapons by 1."}, {"name": "Cold-Blooded Banner", "pts": 20, "type": "Magic Standard", "description": "Single use. When making any test against its Leadership characteristic, the unit may roll an extra D6 and discard the highest result."}]}, "highElves": {"weapons": [{"name": "Woodsman's Axe", "pts": 90, "type": "Magic Weapon", "description": "Chracian Warhost armies only. S+3, AP -4."}, {"name": "The White Sword", "pts": 70, "type": "Magic Weapon", "description": "Infantry or chariot troop types only. S+3, AP -2."}, {"name": "The Blade of Leaping Gold", "pts": 50, "type": "Magic Weapon", "description": "S, AP -. The wielder gains the Strike First special rule and has a +1 modifier to their Initiative and Weapon Skill characteristics."}, {"name": "Bow of the Seafarer", "pts": 50, "type": "Magic Weapon", "description": "Counts as a Bow of Avelorn. Range 30\", S 5, AP -3. Shoots like a bolt thrower using the Through & Through special rule."}, {"name": "Star Lance", "pts": 45, "type": "Magic Weapon", "description": "Cavalry or monster troop types only. S+3, AP -4. Can only be used during a turn in which the wielder charged; otherwise must use hand weapon."}, {"name": "Blade of Sea Gold", "pts": 40, "type": "Magic Weapon", "description": "Sea Guard Garrison armies only. S+1, AP -1."}, {"name": "Reaver Bow", "pts": 40, "type": "Magic Weapon", "description": "Counts as a Bow of Avelorn. Range 30\", S+1, AP -. The wielder may make a number of shooting attacks equal to their Attacks characteristic with no multiple shots modifier."}, {"name": "Foe Bane", "pts": 20, "type": "Magic Weapon", "description": "S, AP -. When the wielder makes a roll To Wound, a roll of 4+ is always a success, regardless of the target's Toughness."}], "armour": [{"name": "Armour of Stars", "pts": 40, "type": "Magic Armour", "description": "Infantry or cavalry only. Heavy armour. The wearer is immune to the Killing Blow special rule. If struck a Killing Blow, armour and Regeneration saves may be taken; if unsaved, they lose a single Wound."}, {"name": "Armour of Caledor", "pts": 35, "type": "Magic Armour", "description": "Full plate armour. The wearer has a 5+ Ward save against any wounds suffered."}, {"name": "The Golden Shield", "pts": 30, "type": "Magic Armour", "description": "Shield. Any enemy model that directs its attacks against the bearer during the Combat phase must re-roll any rolls To Hit of a natural 6."}, {"name": "Dragon Helm", "pts": 10, "type": "Magic Armour", "description": "May be worn with other armour. Improves armour value by 1 (max 2+). The wearer has a 6+ Ward save against wounds caused by attacks with the Flaming Attacks special rule."}], "talismans": [{"name": "Circlet of Atrazar", "pts": 55, "type": "Talisman", "description": "The wearer has +1 Wound on their profile. If their troop type is infantry or cavalry, they also have a +1 modifier to their Toughness characteristic."}, {"name": "Sacred Incense", "pts": 35, "type": "Talisman", "description": "Any enemy model that targets this character or any unit they have joined during the Shooting phase suffers an additional -1 To Hit modifier."}, {"name": "The Loremaster's Cloak", "pts": 25, "type": "Talisman", "description": "The bearer and any unit they have joined has a 4+ Ward save against any wounds suffered that were caused by a Magic Missile."}, {"name": "Opal Amulet", "pts": 20, "type": "Talisman", "description": "Single use. Gives the bearer a 2+ Ward save against a single wound."}], "enchanted": [{"name": "Null Stone", "pts": 75, "type": "Enchanted Item", "description": "All Wizards (friend or foe) within the bearer's Command range suffer a -1 modifier to their Casting and Dispel rolls. Once per turn in the Command sub-phase, if not in combat, the bearer may make a Leadership test; if passed, they cannot be targeted by spells until the next Start of Turn sub-phase."}, {"name": "Amulet of the Tempest", "pts": 50, "type": "Enchanted Item", "description": "Sea Guard Garrison armies only. Whilst within 9\" of the bearer, enemy Wizards cannot add their Level of Wizardry to their Casting rolls."}, {"name": "The Cloak of Beards", "pts": 30, "type": "Enchanted Item", "description": "The wearer causes Terror. However, other models cannot use the wearer's Leadership."}, {"name": "Ring of Fury", "pts": 25, "type": "Enchanted Item", "description": "The wielder can cast the Hammerhand spell from the Lore of Battle Magic as a Bound spell with Power Level 1."}, {"name": "Seed of Rebirth", "pts": 20, "type": "Enchanted Item", "description": "The bearer gains the Regeneration (5+) special rule."}, {"name": "Gem of Courage", "pts": 15, "type": "Enchanted Item", "description": "Chracian Warhost armies only. Single use. Once per game, when required to make a Break test, the bearer and their unit may roll an extra D6 and discard the highest result."}], "arcane": [{"name": "The Vortex Shard", "pts": 50, "type": "Arcane Item", "description": "Single use. May be used instead of making a dispel attempt. The spell is automatically dispelled with no Dispel roll required. In addition, all Remains in Play spells currently in play are dispelled, including friendly spells."}, {"name": "Sigil of Asuryan", "pts": 40, "type": "Arcane Item", "description": "Single use. May be used instead of making a dispel attempt. The spell is automatically dispelled with no Dispel roll required. Note that a perfect invocation cannot be dispelled."}, {"name": "The Trickster's Pendant", "pts": 40, "type": "Arcane Item", "description": "Single use. When attempting a Wizardly dispel, roll an extra D6 and discard the lowest result. If the spell is dispelled, the casting Wizard cannot cast more spells this turn. If a double 1 is rolled on any two dice, the bearer is outclassed in the art."}, {"name": "Annulian Crystal", "pts": 30, "type": "Arcane Item", "description": "Once per turn, upon successfully casting a spell, the bearer may choose to forget that spell and immediately generate another (not including signature spells) in the usual manner."}, {"name": "Silvery Wand", "pts": 15, "type": "Arcane Item", "description": "The bearer knows one more spell (chosen in the usual way) than is normal for their Level of Wizardry. This does not increase the Wizard's Level."}, {"name": "Staff of Solidity", "pts": 15, "type": "Arcane Item", "description": "Single use. Once per game, when the bearer is required to roll on the Miscast table, they may choose not to."}], "banners": [{"name": "Banner of Resilience", "pts": 80, "type": "Magic Standard", "description": "A unit carrying this banner has a +1 modifier to its Toughness characteristic."}, {"name": "Banner of Arcane Protection", "pts": 70, "type": "Magic Standard", "description": "A unit carrying this banner gains the Magic Resistance (-3) special rule. In addition, friendly units within 6\" of the model carrying this standard gain the Magic Resistance (-1) special rule."}, {"name": "Battle Banner", "pts": 60, "type": "Magic Standard", "description": "When calculating combat result, a unit carrying the Battle Banner may claim an additional +D3 combat result points."}, {"name": "The Banner of Lothern", "pts": 55, "type": "Magic Standard", "description": "If the unit is equipped with thrusting spears, half of the models in the third rank (rounding up) can make supporting attacks."}, {"name": "Banner of Balance", "pts": 25, "type": "Magic Standard", "description": "Whilst in base contact with a unit carrying this banner, enemy units cannot re-roll any rolls To Hit or To Wound. However, nor can the unit carrying the Banner of Balance."}, {"name": "Lion Standard", "pts": 25, "type": "Magic Standard", "description": "A unit carrying the Lion Standard automatically passes any Fear or Terror tests it is required to make."}, {"name": "Banner of Confidence", "pts": 20, "type": "Magic Standard", "description": "A unit carrying this banner does not suffer the usual -1 To Hit modifier when making a Stand & Shoot charge reaction."}, {"name": "Banner of Ellyrion", "pts": 20, "type": "Magic Standard", "description": "A unit carrying this banner gains the Move Through Cover special rule."}]}, "tombKings": {"weapons": [{"name": "Destroyer of Eternities", "pts": 75, "type": "Magic Weapon", "description": "S+2, AP -2. Rather than attacking normally, the wielder may choose to make a special 'Scything' attack: the enemy unit suffers D6 automatic hits, each resolved using the weapon's profile."}, {"name": "The Conqueror's Blade", "pts": 55, "type": "Magic Weapon", "description": "S+2, AP -2. Whilst in a challenge, the bearer strikes a Killing Blow if they roll a natural 5 or 6 when making a To Wound roll. If the enemy General is slain in a challenge, you win a bonus of 100 Victory Points."}, {"name": "Crook & Flail of Radiance", "pts": 50, "type": "Magic Weapon", "description": "Monarchs of Nehekhara only. S, AP -1. Represents the high status of the bearer; all that enter their presence are humbled."}, {"name": "Blade of Antarhak", "pts": 45, "type": "Magic Weapon", "description": "Nehekharan Royal Host armies only. S+1, AP -1. For each Wound an enemy unit loses as a result of an attack with this weapon, the wielder immediately recovers a single lost Wound."}, {"name": "Flail of Skulls", "pts": 35, "type": "Magic Weapon", "description": "S+3, AP -1. The Strength modifier applies only against enemy models the wielder charged this turn."}, {"name": "Phakth's Blades of Justice", "pts": 35, "type": "Magic Weapon", "description": "Infantry troop type only. S, AP -1. Grants the wielder +1 Attack for each rank an enemy unit the wielder is engaged with has."}, {"name": "Staff of Aeons", "pts": 30, "type": "Magic Weapon", "description": "Mortuary Cult Liche Priest only. S+2, AP -1. Any model hit by one or more attacks made with this weapon suffers a -1 modifier to its armour value for the remainder of the game."}, {"name": "Serpent Staff", "pts": 20, "type": "Magic Weapon", "description": "Liche Priests only. S+2, AP -2."}], "armour": [{"name": "Armour of the Ages", "pts": 50, "type": "Magic Armour", "description": "Light armour. Enemy models must re-roll successful rolls To Wound made against the wearer."}, {"name": "Royal Mantle", "pts": 40, "type": "Magic Armour", "description": "Nehekharan Royal Host armies only. May be worn with other armour. Improves armour value by 1 (max 2+). The wearer's My Will Be Done special rule affects all friendly Nehekharan Undead units within 6\" rather than just the unit they have joined."}, {"name": "Warding Splint", "pts": 35, "type": "Magic Armour", "description": "Heavy armour, may be worn by a Liche Priest without penalty. The wearer has a 5+ Ward save against any wounds suffered."}, {"name": "Shield of Ptra", "pts": 25, "type": "Magic Armour", "description": "Shield. Any enemy model that directs their attacks against the bearer during the Combat phase suffers a -1 modifier to their Weapon Skill characteristic."}], "talismans": [{"name": "Amulet of the Serpent", "pts": 30, "type": "Talisman", "description": "The bearer and any unit they have joined gains the Poisoned Attacks special rule."}, {"name": "Crown of Kings", "pts": 30, "type": "Talisman", "description": "Monarch of Nehekhara only. During the Command sub-phase, if not in combat, the wearer may make a Leadership test. If passed, a single friendly unit of Skeleton Warriors, Skeleton Archers, Skeleton Horsemen or Skeleton Horse Archers within Command range recovers D3+1 Wounds."}, {"name": "Collar of Shapesh", "pts": 25, "type": "Talisman", "description": "Single use. When the wearer loses their last Wound, roll a D6. On a 4+, the Wound is not lost. Instead, a single friendly model within the wearer's Command range is removed from play as a casualty."}, {"name": "Relic of the Desert Sun", "pts": 25, "type": "Talisman", "description": "The bearer is not subject to the Dry as Dust or Flammable special rules."}], "enchanted": [{"name": "Cloak of the Dunes", "pts": 50, "type": "Enchanted Item", "description": "Infantry troop type only. The wearer gains the Fly (9) special rule. In addition, any enemy unit the wearer moves over during Remaining Moves suffers D6 Strength 2 hits with AP -1."}, {"name": "Staff of Awakening", "pts": 50, "type": "Enchanted Item", "description": "High Priest only. When the wielder uses the Arise! special rule on a friendly infantry or cavalry unit, that unit recovers an additional D3 Wounds."}, {"name": "Orb of Ptra", "pts": 40, "type": "Enchanted Item", "description": "Any enemy model that targets this character or any unit they have joined during the Shooting phase suffers an additional -1 To Hit modifier."}, {"name": "Icon of Rulership", "pts": 35, "type": "Enchanted Item", "description": "Chariot troop type only. This model doubles its Unit Strength from 3 to 6. In addition, any Impact Hits caused by this model have an AP of -2 and the Magical Attacks special rule."}, {"name": "Death Mask of Kharnutt", "pts": 20, "type": "Enchanted Item", "description": "The wearer of the Death Mask of Kharnutt gains the Terror special rule."}], "arcane": [{"name": "Ph\u00e2zerakt's Kanopi", "pts": 40, "type": "Arcane Item", "description": "Single use. During the Command sub-phase, if not in combat, the bearer may make a Leadership test. If passed, place a unit of 2D6+3 Summoned Skeleton Warriors anywhere completely within 12\" of this model, but not within 1\" of enemy models."}, {"name": "Enkhil's Kanopi", "pts": 30, "type": "Arcane Item", "description": "Single use. During the Command sub-phase, the bearer may open the Kanopi. Until the next Start of Turn sub-phase, all Remains in Play spells are dispelled and no new Remains in Play spells can be cast."}], "banners": [{"name": "Standard of the Cursing Word", "pts": 80, "type": "Magic Standard", "description": "Battle Standard Bearer only. At the end of any phase in which one or more models in the bearer's unit lost their last Wound to an enemy attack, the attacking unit must make a Leadership test. If failed, it suffers D3 Strength 2 hits for each model that lost its last Wound."}, {"name": "Icon of the Sacred Eye", "pts": 50, "type": "Magic Standard", "description": "A unit carrying this banner has a +1 modifier to its Weapon Skill characteristic (maximum 10)."}, {"name": "Royal Standard of Settra", "pts": 50, "type": "Magic Standard", "description": "May only be taken in a muster list that includes Settra the Imperishable and/or Nekaph. A unit carrying this banner gains the Hatred (enemy characters) and Terror special rules."}, {"name": "Sigil of Centuries", "pts": 45, "type": "Magic Standard", "description": "All enemy units within 6\" of the bearer suffer a -1 modifier to their Initiative characteristic (minimum 1)."}, {"name": "Icon of Rakaph", "pts": 40, "type": "Magic Standard", "description": "Unless making a charge move, a unit carrying this banner may perform a single free reform at any point during its movement."}, {"name": "Tapestry of Conquered Lands", "pts": 35, "type": "Magic Standard", "description": "Any enemy standard captured by a unit carrying this banner is worth 100 Victory Points as a trophy of war."}, {"name": "Banner of the Desert Winds", "pts": 30, "type": "Magic Standard", "description": "Infantry troop type only. A unit carrying this banner gains the Vanguard and Reserve Move special rules."}, {"name": "Mirage Banner", "pts": 20, "type": "Magic Standard", "description": "Any enemy model that targets a unit carrying this banner during the Shooting phase suffers an additional -1 To Hit modifier."}]}, "lizardmen": {"weapons": [{"name": "Blade of Revered Tzunki", "pts": 65, "type": "Magic Weapon", "description": "S+1. No armour or Ward saves are permitted against wounds caused by this weapon (Regeneration saves can be attempted as normal)."}, {"name": "Scimitar of the Sun Resplendent", "pts": 50, "type": "Magic Weapon", "description": "S, AP -1. Invigorates the wielder with the power of the sun."}, {"name": "Staff of the Lost Sun", "pts": 40, "type": "Magic Weapon", "description": "Two profiles: Ranged: Range 12\", S 4, AP -3. Combat: S+1, AP -. Projects beams of hot light from its tip."}, {"name": "Piranha Blade", "pts": 35, "type": "Magic Weapon", "description": "S, AP -1. The blade is inlaid with thousands of tiny barbed teeth that rip and tear through the flesh of the enemy."}], "armour": [{"name": "Shield of the Mirror Pool", "pts": 40, "type": "Magic Armour", "description": "Shield. Each time the bearer loses one or more Wounds to a Magic Missile, the caster suffers a single Strength 5 hit with AP -2."}, {"name": "Hide of the Cold Ones", "pts": 20, "type": "Magic Armour", "description": "May be worn with other armour. Improves armour value by 1 (max 2+). However, the wearer is also subject to the Stupidity special rule."}], "talismans": [{"name": "Glyph Necklace", "pts": 45, "type": "Talisman", "description": "The bearer has a 5+ Ward save against any wounds suffered and gains the Magic Resistance (-2) special rule."}, {"name": "Aura of Quetzl", "pts": 40, "type": "Talisman", "description": "Any enemy model that directs its attacks against the bearer during the Combat phase suffers a -1 modifier to its rolls To Hit."}], "enchanted": [{"name": "Cloak of Feathers", "pts": 40, "type": "Enchanted Item", "description": "Skink Heroes whose troop type is infantry only. The wearer gains the Fly (10) and Swiftstride special rules."}, {"name": "Venom of the Firefly Frog", "pts": 15, "type": "Enchanted Item", "description": "All attacks made during the Combat phase by the bearer have the Poisoned Attacks and Flaming Attacks special rules. Does not apply to non-magical weapons or the model's mount."}, {"name": "Horned One", "pts": 10, "type": "Enchanted Item", "description": "Saurus Hero mounted on a Cold One only. The character's mount loses the Stupidity special rule and has a Movement characteristic of 8."}], "arcane": [{"name": "Cupped Hands of the Old Ones", "pts": 55, "type": "Arcane Item", "description": "Should the bearer miscast a spell, roll a D6. On a 1, roll on the Miscast table as normal. On a 2+, the bearer instead nominates an enemy character; centre a 3\" blast template over that character and every model underneath risks suffering a Strength 6 hit with AP -2."}, {"name": "Cube of Darkness", "pts": 50, "type": "Arcane Item", "description": "Single use. May be used instead of making a dispel attempt. The spell is automatically dispelled. In addition, all Remains in Play spells currently in play are dispelled, including friendly spells."}, {"name": "Itxi Grub", "pts": 30, "type": "Arcane Item", "description": "Single use. Before making a Casting roll, the bearer may attempt to consume a single Itxi Grub by making a Toughness test. If passed, the bearer may apply a +3 modifier to the Casting roll. If failed, the bearer immediately loses a single Wound."}], "banners": [{"name": "Sun Standard of Chotec", "pts": 40, "type": "Magic Standard", "description": "Enemy units cannot declare a Stand & Shoot charge reaction against a unit carrying this banner. In addition, any enemy model that targets the unit during the Shooting phase suffers an additional -1 To Hit modifier."}, {"name": "Skavenpelt Banner", "pts": 35, "type": "Magic Standard", "description": "A unit carrying this banner gains the Frenzy and Hatred (Skaven) special rules."}, {"name": "Totem of Prophecy", "pts": 30, "type": "Magic Standard", "description": "A unit carrying this banner gains the Fear special rule."}, {"name": "Jaguar Standard", "pts": 20, "type": "Magic Standard", "description": "When a unit carrying this banner makes a Pursuit roll, it may roll an extra D6 and discard the lowest result."}]}, "bretonnia": {"weapons": [{"name": "Sword of the Quest", "pts": 70, "type": "Magic Weapon", "description": "When the wielder makes a roll To Wound, a roll of 3+ is always a success, regardless of the target's Toughness."}, {"name": "Crusader's Lance", "pts": 60, "type": "Magic Weapon", "description": "Cavalry only. Lance that can only be used during a turn in which the wielder charged. On a turn the wielder charges, they gain +2 Strength and -2 AP rather than the usual lance bonus."}, {"name": "Sword of Heroes", "pts": 60, "type": "Magic Weapon", "description": "The wielder of the Sword of Heroes has the Heroic Killing Blow special rule."}, {"name": "Heartwood Lance", "pts": 50, "type": "Magic Weapon", "description": "Cavalry only. When the wielder charges, for each roll To Hit of a natural 6, one additional hit is scored."}, {"name": "Morning Star of Fracasse", "pts": 40, "type": "Magic Weapon", "description": "Models hit by the Morning Star of Fracasse must re-roll any successful Armour Save rolls."}, {"name": "Frontier Axe", "pts": 30, "type": "Magic Weapon", "description": "The wielder of the Frontier Axe has the Multiple Wounds (2) special rule against models whose troop type is monstrous infantry, monstrous cavalry, monstrous creature, or behemoth."}, {"name": "Sword of the Stout Hearted", "pts": 25, "type": "Magic Weapon", "description": "The wielder of the Sword of the Stout Hearted and any unit they have joined are Immune to Psychology."}, {"name": "Foebreaker", "pts": 20, "type": "Magic Weapon", "description": "S+1, AP -1. The wielder may re-roll any failed rolls To Hit."}], "armour": [{"name": "Gilded Cuirass", "pts": 60, "type": "Magic Armour", "description": "Heavy armour. The wearer has a 4+ Ward save against any wounds suffered."}, {"name": "Anointed Armour", "pts": 45, "type": "Magic Armour", "description": "Full plate armour. The wearer has a 6+ Ward save against wounds and is immune to the Killing Blow special rule."}, {"name": "Gromril Great Helm", "pts": 40, "type": "Magic Armour", "description": "May be worn with other armour. Improves armour value by 1 (max 2+). The wearer has a 5+ Ward save against wounds caused by attacks with the Killing Blow special rule."}, {"name": "Ironspike Shield", "pts": 20, "type": "Magic Armour", "description": "Shield. Any enemy model that rolls a natural 1 when making a roll To Hit against the bearer during the Combat phase immediately suffers a Strength 4 hit with AP -."}], "talismans": [{"name": "Grail Pendant", "pts": 40, "type": "Talisman", "description": "Grail Knights and Grail Damsels only. The bearer has a 5+ Ward save against any wounds suffered."}, {"name": "Lucky Heirloom", "pts": 25, "type": "Talisman", "description": "Single use. Once per game, when the bearer suffers a wound that reduces them to 0 Wounds, roll a D6. On a 4+, the wound is ignored."}, {"name": "Mantle of the Damsel Elena", "pts": 25, "type": "Talisman", "description": "Damsels only. The bearer and any unit they have joined have the Magic Resistance (-2) special rule."}, {"name": "Sirienne's Locket", "pts": 25, "type": "Talisman", "description": "The bearer has a 4+ Ward save against any wounds suffered that were caused by a Magic Missile, a Magical Vortex, or an Assailment spell."}], "enchanted": [{"name": "Falcon-horn of Fredemund", "pts": 40, "type": "Enchanted Item", "description": "Once per game, during the Command sub-phase, the bearer may sound the horn. Until the next Start of Turn sub-phase, all friendly units within 12\" gain the Swiftstride special rule."}, {"name": "The Seal of Parravon", "pts": 35, "type": "Enchanted Item", "description": "The bearer and any unit they have joined gain the Move Through Cover special rule and do not suffer any penalties for moving through difficult terrain."}, {"name": "Antlers of the Great Hunt", "pts": 25, "type": "Enchanted Item", "description": "The bearer gains the Impact Hits (D3) special rule. These Impact Hits have an AP of -1."}, {"name": "Crusader's Clarion", "pts": 25, "type": "Enchanted Item", "description": "Once per game, during the Command sub-phase, all friendly units within 12\" of the bearer that are Fleeing may immediately make a Rally test."}, {"name": "Wyrmbreath Vial", "pts": 20, "type": "Enchanted Item", "description": "Single use. The bearer may cast the following Bound spell with Power Level 2: Magic Missile, range 12\", causes D6 Strength 4 hits each with AP -1 and the Flaming Attacks special rule."}, {"name": "Gauntlet of the Duel", "pts": 5, "type": "Enchanted Item", "description": "The bearer may issue and accept challenges. Whilst in a challenge, the bearer has a +1 modifier to their Weapon Skill characteristic."}], "arcane": [{"name": "Heart of the Wilds", "pts": 40, "type": "Arcane Item", "description": "The bearer knows one additional spell from the Lore of the Lady (chosen in the usual way) and may re-roll a single failed Casting roll per turn whilst within 6\" of a woodland terrain feature."}, {"name": "Diadem of Power", "pts": 35, "type": "Arcane Item", "description": "Single use. The bearer may use the Diadem of Power at the start of the Magic phase. If they do, generate D3 additional power dice this Magic phase."}], "banners": [{"name": "Banner of the Lady's Grace", "pts": 75, "type": "Magic Standard", "description": "All friendly units within the bearer's Command Range gain the Regeneration (6+) special rule."}, {"name": "Valorous Standard", "pts": 60, "type": "Magic Standard", "description": "When calculating combat result, a unit carrying the Valorous Standard may claim an additional +D3 combat result points."}, {"name": "Conqueror's Tapestry", "pts": 40, "type": "Magic Standard", "description": "A unit carrying the Conqueror's Tapestry gains the Hatred (all enemies) special rule during the first turn of any combat."}, {"name": "Crusader's Tapestry", "pts": 40, "type": "Magic Standard", "description": "A unit carrying the Crusader's Tapestry gains the Stubborn special rule."}, {"name": "Errantry Banner", "pts": 30, "type": "Magic Standard", "description": "A unit carrying the Errantry Banner increases its maximum charge range by 3\"."}, {"name": "Banner of Honourable Warfare", "pts": 25, "type": "Magic Standard", "description": "Enemy units in base contact with a unit carrying the Banner of Honourable Warfare cannot use the Stomp special rule."}, {"name": "Banner of the Zealous Knight", "pts": 25, "type": "Magic Standard", "description": "A unit carrying this banner re-rolls failed Panic tests."}, {"name": "Banner of Chalons", "pts": 20, "type": "Magic Standard", "description": "A unit carrying the Banner of Chalons gains the Swiftstride special rule."}]}, "empire": {"weapons": [{"name": "Runefang", "pts": 100, "type": "Magic Weapon", "description": "S, AP -2. When making a roll To Wound, a roll of 2+ is always a success, regardless of the target's Toughness."}, {"name": "Mace of Helsturm", "pts": 65, "type": "Magic Weapon", "description": "Two profiles. Single-handed: S, AP -. Double-handed: S 10, AP -5, one attack only. Must choose which profile to use at the start of each round of combat."}, {"name": "Hammer of Righteousness", "pts": 50, "type": "Magic Weapon", "description": "S+2, AP -2. Models hit must make a Leadership test for each hit. If failed, the hit wounds automatically with no Armour save. If passed, resolve To Wound and saves normally."}, {"name": "Sword of Justice", "pts": 50, "type": "Magic Weapon", "description": "S, AP -1. The wielder may re-roll any failed rolls To Wound."}, {"name": "Pearl Daggers", "pts": 35, "type": "Magic Weapon", "description": "S, AP -1. The wielder may re-roll any failed rolls To Hit during the Combat phase."}, {"name": "Blade of Silvered Steel", "pts": 30, "type": "Magic Weapon", "description": "S+1, AP -1. Knightly Order armies only. Undead models cannot make Armour or Regeneration saves against wounds caused by this weapon."}, {"name": "Dragon Bow", "pts": 25, "type": "Magic Weapon", "description": "Commanders of the Empire only. Range 36\", S 6, AP -2."}, {"name": "Von Trickschotte's Wondrous Arquebus", "pts": 25, "type": "Magic Weapon", "description": "City-state of Nuln armies only. Range 36\", S 5, AP -2. The wielder does not suffer the usual -1 modifier for shooting at long range."}], "armour": [{"name": "Armour of Fortune", "pts": 45, "type": "Magic Armour", "description": "Heavy armour. The wearer has a 6+ Ward save against any wounds suffered and is immune to the Killing Blow special rule. If struck a Killing Blow, armour and Regeneration saves may be taken; if the wound is unsaved, they lose a single Wound."}, {"name": "Shield of the Gorgon", "pts": 40, "type": "Magic Armour", "description": "Shield, Knightly Order armies only. Whilst in base contact with the bearer, enemy models suffer a -1 modifier to their Attacks characteristic (minimum 1)."}, {"name": "Armour of Tarnus", "pts": 35, "type": "Magic Armour", "description": "Light armour, may be worn by an Imperial Wizard without penalty. The wearer has a 5+ Ward save against any wounds suffered."}, {"name": "Twice-Blessed Armour", "pts": 25, "type": "Magic Armour", "description": "Full plate armour. The wearer may cast the Hammerhand spell from the Lore of Battle Magic as a Bound spell with Power Level 2."}], "talismans": [{"name": "The White Cloak", "pts": 30, "type": "Talisman", "description": "The wearer has a 5+ Ward save against any wounds suffered, and a 3+ Ward save against wounds caused by attacks with the Flaming Attacks special rule."}, {"name": "Jade Amulet", "pts": 25, "type": "Talisman", "description": "The bearer is immune to the Killing Blow special rule. If struck a Killing Blow, armour and Regeneration saves may be taken; if the wound is unsaved, they lose a single Wound."}, {"name": "Witch Hunter's Ward", "pts": 20, "type": "Talisman", "description": "The bearer has the Magic Resistance (-2) special rule. Once per game, the bearer may re-roll a single failed Armour Save roll."}, {"name": "Slayer's Hourglass", "pts": 10, "type": "Talisman", "description": "Enemy models whose troop type is monster suffer a -1 modifier to their Weapon Skill characteristic whilst in base contact with the bearer."}], "enchanted": [{"name": "Laurels of Victory", "pts": 40, "type": "Enchanted Item", "description": "When determining combat result, each unsaved wound caused by an attack made by the bearer (not their mount) is worth 2 combat result points rather than the usual 1."}, {"name": "Squintsoffen's Marvellous Magnifier", "pts": 35, "type": "Enchanted Item", "description": "City-state of Nuln armies only. The bearer and any unit they have joined do not suffer the usual -1 To Hit modifier when shooting at Long Range."}, {"name": "Ring of Fortune", "pts": 20, "type": "Enchanted Item", "description": "Single use. The bearer may re-roll any failed rolls To Wound made during the Combat phase."}, {"name": "Ring of Taal", "pts": 20, "type": "Enchanted Item", "description": "Single use. The bearer may cast the Oaken Shield spell from the Lore of Battle Magic as a Bound spell with Power Level 3."}, {"name": "The Silver Horn", "pts": 15, "type": "Enchanted Item", "description": "Characters with the Swiftstride special rule only. The bearer and any unit they have joined may re-roll the D6 when using the Swiftstride special rule."}, {"name": "Shroud of Iron", "pts": 10, "type": "Enchanted Item", "description": "The bearer and any unit they have joined has a 6+ Ward save against any wounds suffered that were caused by a non-magical template."}], "arcane": [{"name": "Book of Ashur", "pts": 85, "type": "Arcane Item", "description": "The bearer increases their Dispel range by 3\" and may apply a +1 modifier to any Casting or Dispel rolls, unless they roll any natural double. If any natural double is rolled, the +1 modifier cannot be applied to that roll."}, {"name": "Twin-Tailed Wand", "pts": 40, "type": "Arcane Item", "description": "Once per turn, the bearer may attempt to cast one of their spells a second time. If they miscast, instead of rolling on the Miscast table, they suffer D3 wounds with no armour or Regeneration saves permitted."}, {"name": "Wizard's Familiar", "pts": 35, "type": "Arcane Item", "description": "0-1 per Wizard. The owner may apply a +1 modifier to any of their Dispel rolls."}, {"name": "Tome of Midnight", "pts": 25, "type": "Arcane Item", "description": "The bearer knows one more spell than is normal for their Level of Wizardry. In addition, the bearer may re-roll a single failed Dispel roll per Magic phase."}, {"name": "Rod of Power", "pts": 25, "type": "Arcane Item", "description": "Once per Magic phase, the bearer may store up to 2 unused power dice at the end of the phase. These stored dice can be added to the power pool in a subsequent Magic phase."}], "banners": [{"name": "Banner of the Knights Panther", "pts": 80, "type": "Magic Standard", "description": "Battle Standard Bearer belonging to the Order of the Knights Panther only. A unit carrying this banner gains the Unbreakable special rule."}, {"name": "Imperial Banner", "pts": 60, "type": "Magic Standard", "description": "All friendly units within the Command range of the model carrying this banner roll 3D6 when making a Fear, Panic or Terror test and discard the highest result."}, {"name": "Griffon Standard", "pts": 50, "type": "Magic Standard", "description": "When determining combat result, a unit carrying the Griffon Standard can claim a Rank Bonus of +2 for each extra rank behind the first, rather than the usual +1."}, {"name": "Tapestry of Sigmar's Triumph", "pts": 40, "type": "Magic Standard", "description": "A unit carrying this tapestry may re-roll any rolls To Wound of a natural 1 during the first round of a combat."}, {"name": "Icon of Morr", "pts": 25, "type": "Magic Standard", "description": "A unit carrying the Icon of Morr gains the Fear special rule. If they already have Fear, they instead gain Terror."}, {"name": "The Banner of the Free State of Nuln", "pts": 20, "type": "Magic Standard", "description": "City-state of Nuln armies only. A unit carrying this banner gains the Stubborn special rule."}, {"name": "The Gleaming Pennant", "pts": 15, "type": "Magic Standard", "description": "Single use. A unit carrying the Gleaming Pennant may re-roll a single failed Leadership test. Note that a Break test is not a Leadership test."}, {"name": "Banner of Duty", "pts": 10, "type": "Magic Standard", "description": "A unit carrying the Banner of Duty may re-roll any failed Rally tests."}]}};

  // Build merged magic-items catalog: common items + faction-specific army items
  // Each slot is deduplicated by item name.
  const FACTION_ARMY_ITEM_KEYS = {
    eonir:         ["woodElves", "darkElves", "highElves"],
    tombKings:     ["tombKings"],
    lizardmen:     ["lizardmen"],
    borderPrinces: ["bretonnia", "empire"],
  };
  const ITEM_SLOTS = ["weapons", "armour", "talismans", "enchanted", "arcane", "banners"];

  const buildItemsCatalog = (factionKey) => {
    const catalog = {};
    ITEM_SLOTS.forEach((slot) => {
      const common = (magicItems && magicItems[slot]) ? magicItems[slot] : [];
      const factionKeys = FACTION_ARMY_ITEM_KEYS[factionKey] || [];
      const factionSpecific = factionKeys.flatMap((k) => (armyItems[k]?.[slot] || []));
      const seen = new Set();
      const merged = [...common, ...factionSpecific].filter((item) => {
        if (seen.has(item.name)) return false;
        seen.add(item.name);
        return true;
      });
      catalog[slot] = merged;
    });
    return catalog;
  };

  // Pre-compute merged catalog for current faction (stable reference)
  const factionItemsCatalog = useMemo(
    () => buildItemsCatalog(activeFaction),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeFaction, magicItems]
  );
  const [armyLists, setArmyLists] = useState({});
  const [currentListId, setCurrentListId] = useState(null);
  const [customUnitsDB, setCustomUnitsDB] = useState({});
  const [unitOverrides, setUnitOverrides] = useState({});
  const [customRules, setCustomRules] = useState([]);
  const [view, setView] = useState("roster"); // roster | units | traits | items | rules | data
  const [showGameView, setShowGameView] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [showNewUnitForm, setShowNewUnitForm] = useState(false);
  const [showNewListDialog, setShowNewListDialog] = useState(false);
  const [editingUnit, setEditingUnit] = useState(null);
  const [editingOverrideUnitId, setEditingOverrideUnitId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState(null);

  // Load from localStorage
  useEffect(() => {
    try {
      const listsRaw = localStorage.getItem(STORAGE_KEY);
      if (listsRaw) setArmyLists(JSON.parse(listsRaw));
    } catch (e) { /* first load */ }
    try {
      const unitsRaw = localStorage.getItem(CUSTOM_UNITS_KEY);
      if (unitsRaw) setCustomUnitsDB(JSON.parse(unitsRaw));
    } catch (e) { /* first load */ }
    try {
      const ovRaw = localStorage.getItem(OVERRIDES_KEY);
      if (ovRaw) setUnitOverrides(JSON.parse(ovRaw));
    } catch (e) { /* first load */ }
    try {
      const crRaw = localStorage.getItem(CUSTOM_RULES_KEY);
      if (crRaw) setCustomRules(JSON.parse(crRaw));
    } catch (e) { /* first load */ }
    setLoading(false);
  }, []);

  // Save army lists
  const saveArmyLists = useCallback((lists) => {
    setArmyLists(lists);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
      writeSnapshot(lists);
    } catch (e) { console.error("Save failed:", e); }
  }, []);

  // Save custom units
  const saveCustomUnits = useCallback((units) => {
    setCustomUnitsDB(units);
    try {
      localStorage.setItem(CUSTOM_UNITS_KEY, JSON.stringify(units));
    } catch (e) { console.error("Save failed:", e); }
  }, []);

  // Save unit overrides
  const saveOverrides = useCallback((overrides) => {
    setUnitOverrides(overrides);
    try {
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
    } catch (e) { console.error("Save failed:", e); }
  }, []);

  // Save custom house rules
  const saveCustomRules = useCallback((rules) => {
    setCustomRules(rules);
    try {
      localStorage.setItem(CUSTOM_RULES_KEY, JSON.stringify(rules));
    } catch (e) { console.error("Save failed:", e); }
  }, []);

  const notify = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2500);
  };

  const faction = factions[activeFaction];
  const rawUnits = [
    ...(baseUnits[activeFaction] || []),
    ...(customUnitsDB[activeFaction] || []),
  ];
  const allUnits = applyAllOverrides(rawUnits, unitOverrides);

  // Combined house rules: base (from data files) + user-created custom rules
  const allHouseRules = [...(houseRules || []), ...customRules];

  const currentList = currentListId ? armyLists[currentListId] : null;

  // ── Army List CRUD ──
  const createList = (name, pointsLimit) => {
    const id = `list_${Date.now()}`;
    const newList = {
      id,
      name,
      faction: activeFaction,
      pointsLimit: parseInt(pointsLimit) || 2000,
      entries: [],
      traits: [],
      notes: "",
      createdAt: new Date().toISOString(),
    };
    const updated = { ...armyLists, [id]: newList };
    saveArmyLists(updated);
    setCurrentListId(id);
    setShowNewListDialog(false);
    notify("Army list created!");
  };

  const deleteList = (id) => {
    const updated = { ...armyLists };
    delete updated[id];
    saveArmyLists(updated);
    if (currentListId === id) setCurrentListId(null);
  };

  const addUnitToList = (unitDef, quantity = null) => {
    if (!currentList) return;
    const entry = {
      entryId: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      unitId: unitDef.id,
      unitName: unitDef.name,
      modelCount: quantity || unitDef.minSize || 1,
      isCharacter: unitDef.isCharacter || false,
      ptsCost: unitDef.isCharacter
        ? unitDef.ptsCost || 0
        : (unitDef.ptsPerModel || 0) * (quantity || unitDef.minSize || 1),
      category: unitDef.category,
      activeUpgrades: (unitDef.upgrades || []).filter(u => u.default).map(u => u.id),
      commandMagicItems: {},
      assignedTraits: [],
      magicItems: unitDef.isCharacter ? {} : null,
      relicForm: unitDef.relic ? "basic" : null,
      arrows: null,
      notes: "",
    };
    const updated = {
      ...armyLists,
      [currentListId]: {
        ...currentList,
        entries: [...currentList.entries, entry],
      },
    };
    saveArmyLists(updated);
    notify(`Added ${unitDef.name}`);
  };

  const updateEntry = (entryId, changes) => {
    if (!currentList) return;
    const entries = currentList.entries.map((e) => {
      if (e.entryId !== entryId) return e;
      const updated = { ...e, ...changes };
      const unitDef = allUnits.find((u) => u.id === e.unitId);
      if (!unitDef) return updated;
      // Full points recalculation
      const modelCount = updated.modelCount || 1;
      const usesPerModel = ARROWS_PER_MODEL_UNITS.includes(unitDef.id);
      const arrowCost = updated.arrows
        ? (usesPerModel ? (updated.arrows.ptsPerModel || 0) * modelCount : (updated.arrows.ptsFlat || 0))
        : 0;
      // Calculate upgrade costs (per-model upgrades × modelCount)
      const upgradeDefs = unitDef.upgrades || [];
      const activeUpgrades = updated.activeUpgrades || [];
      const upgradeCost = upgradeDefs
        .filter(u => activeUpgrades.includes(u.id))
        .reduce((sum, u) => sum + (u.perModel ? (u.pts || 0) * modelCount : (u.pts || 0)), 0);
      // Calculate command magic items cost
      const commandMagicItems = updated.commandMagicItems || {};
      const commandMagicCost = Object.values(commandMagicItems).reduce((sum, items) => {
        return sum + Object.values(items || {}).reduce((s, item) => s + (item?.pts || 0), 0);
      }, 0);
      if (unitDef.isCharacter) {
        updated.ptsCost = (unitDef.ptsCost || 0) + calcMagicItemsCost(updated.magicItems) + arrowCost + upgradeCost + commandMagicCost;
      } else {
        updated.ptsCost = ((unitDef.ptsPerModel || 0) * modelCount) + arrowCost + upgradeCost + commandMagicCost;
      }
      return updated;
    });
    saveArmyLists({
      ...armyLists,
      [currentListId]: { ...currentList, entries },
    });
  };

  const removeEntry = (entryId) => {
    if (!currentList) return;
    saveArmyLists({
      ...armyLists,
      [currentListId]: {
        ...currentList,
        entries: currentList.entries.filter((e) => e.entryId !== entryId),
      },
    });
  };

  // ── Auto-migrate stale entry.unitName to match live unitDef.name ──────────
  useEffect(() => {
    if (!allUnits || allUnits.length === 0 || Object.keys(armyLists).length === 0) return;
    let changed = false;
    const migrated = {};
    Object.entries(armyLists).forEach(([listId, list]) => {
      const newEntries = list.entries.map((e) => {
        const unitDef = allUnits.find((u) => u.id === e.unitId);
        if (unitDef && unitDef.name && e.unitName !== unitDef.name) {
          changed = true;
          return { ...e, unitName: unitDef.name };
        }
        return e;
      });
      migrated[listId] = { ...list, entries: newEntries };
    });
    if (changed) {
      saveArmyLists(migrated);
    }
  }, [allUnits]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPoints = currentList
    ? currentList.entries.reduce((sum, e) => sum + (e.ptsCost || 0), 0)
    : 0;

  // ── Custom Unit CRUD ──
  const addCustomUnit = (unit) => {
    const existing = customUnitsDB[activeFaction] || [];
    const updated = {
      ...customUnitsDB,
      [activeFaction]: [...existing, { ...unit, id: `custom_${Date.now()}`, isCustom: true }],
    };
    saveCustomUnits(updated);
    notify("Custom unit added!");
    setShowNewUnitForm(false);
  };

  const removeCustomUnit = (unitId) => {
    const existing = customUnitsDB[activeFaction] || [];
    const updated = {
      ...customUnitsDB,
      [activeFaction]: existing.filter((u) => u.id !== unitId),
    };
    saveCustomUnits(updated);
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner} />
        <p style={styles.loadingText}>Marshalling forces...</p>
      </div>
    );
  }

  return (
    <div style={styles.appContainer}>
      {/* ══ Game View Overlay ══ */}
      {showGameView && currentList && (
        <GameView
          currentList={currentList}
          allUnits={allUnits}
          faction={faction}
          activeFaction={activeFaction}
          totalPoints={totalPoints}
          onClose={() => setShowGameView(false)}
          localRulesDesc={SPECIAL_RULES_DESC}
        />
      )}

      {/* ══ Notification ══ */}
      {notification && (
        <div style={styles.notification}>{notification}</div>
      )}

      {/* ══ Header ══ */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div>
            <h1 style={styles.title}>⚔ The Old World</h1>
            <p style={styles.subtitle}>Narrative Campaign Army Builder</p>
          </div>
          <div style={styles.pointsBadge}>
            {currentList && (
              <>
                <span style={{
                  ...styles.pointsNumber,
                  color: totalPoints > currentList.pointsLimit ? "#ef4444" : "#fbbf24",
                }}>
                  {totalPoints}
                </span>
                <span style={styles.pointsSlash}>/</span>
                <span style={styles.pointsLimit}>{currentList.pointsLimit} pts</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ══ Faction Tabs ══ */}
      <div style={styles.factionBar}>
        {Object.entries(factions).map(([key, f]) => (
          <button
            key={key}
            onClick={() => { setActiveFaction(key); setCurrentListId(null); setSelectedUnit(null); }}
            style={{
              ...styles.factionTab,
              ...(activeFaction === key ? {
                background: f.color,
                color: "#fff",
                borderColor: f.accent,
                boxShadow: `0 0 12px ${f.color}66`,
              } : {}),
            }}
          >
            <span style={{ fontSize: 18 }}>{f.icon}</span>
            <span style={styles.factionTabName}>{f.name.split("–")[0].trim()}</span>
          </button>
        ))}
      </div>

      {/* ══ Nav ══ */}
      <nav style={styles.nav}>
        {[
          { key: "named", label: "Named Characters", icon: "⚔️" },
          { key: "roster", label: "Army Roster", icon: "📜" },
          { key: "units", label: "Unit Database", icon: "🗡" },
          { key: "items", label: "Items & Relics", icon: "✨" },
          { key: "map", label: "Campaign Map", icon: "🗺" },
          { key: "rules", label: "House Rules", icon: "📖" },
          { key: "data", label: "Manage Data", icon: "⚙" },
          { key: "settings", label: "Settings", icon: "🔧" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setView(tab.key); setSelectedUnit(null); }}
            style={{
              ...styles.navBtn,
              ...(view === tab.key ? {
                background: `${faction.color}44`,
                borderBottom: `2px solid ${faction.accent}`,
                color: faction.accent,
              } : {}),
            }}
          >
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </nav>

      {/* ══ Main Content ══ */}
      <main style={styles.main}>
        {view === "named" && (
          <NamedCharactersView
            allUnits={allUnits}
            faction={faction}
            activeFaction={activeFaction}
            addUnitToList={currentList ? addUnitToList : null}
          />
        )}
        {view === "roster" && (
          <RosterView
            faction={faction}
            activeFaction={activeFaction}
            armyLists={armyLists}
            currentList={currentList}
            currentListId={currentListId}
            setCurrentListId={setCurrentListId}
            createList={createList}
            deleteList={deleteList}
            allUnits={allUnits}
            addUnitToList={addUnitToList}
            updateEntry={updateEntry}
            removeEntry={removeEntry}
            totalPoints={totalPoints}
            showNewListDialog={showNewListDialog}
            setShowNewListDialog={setShowNewListDialog}
            notify={notify}
            magicItems={factionItemsCatalog}
            onOpenGameView={() => setShowGameView(true)}
          />
        )}
        {view === "units" && (
          <UnitsView
            allUnits={allUnits}
            faction={faction}
            activeFaction={activeFaction}
            selectedUnit={selectedUnit}
            setSelectedUnit={setSelectedUnit}
            addUnitToList={currentList ? addUnitToList : null}
            unitOverrides={unitOverrides}
            saveOverrides={saveOverrides}
            editingOverrideUnitId={editingOverrideUnitId}
            setEditingOverrideUnitId={setEditingOverrideUnitId}
          />
        )}
        {view === "items" && (
          <ItemsView allUnits={allUnits} faction={faction} magicItems={factionItemsCatalog} />
        )}
        {view === "rules" && <RulesView houseRules={allHouseRules} customRules={customRules} saveCustomRules={saveCustomRules} faction={faction} notify={notify} />}
        {view === "map" && <MapView factions={FALLBACK_FACTIONS} />}
        {view === "data" && (
          <DataView
            faction={faction}
            activeFaction={activeFaction}
            allUnits={allUnits}
            baseUnits={baseUnits}
            addCustomUnit={addCustomUnit}
            removeCustomUnit={removeCustomUnit}
            showNewUnitForm={showNewUnitForm}
            setShowNewUnitForm={setShowNewUnitForm}
            unitOverrides={unitOverrides}
            saveOverrides={saveOverrides}
            customUnitsDB={customUnitsDB}
            saveCustomUnits={saveCustomUnits}
            customRules={customRules}
            saveCustomRules={saveCustomRules}
            notify={notify}
            setView={setView}
            setSelectedUnit={setSelectedUnit}
            setEditingOverrideUnitId={setEditingOverrideUnitId}
          />
        )}
        {view === "settings" && (
          <SettingsView
            onRefreshData={onRefreshData}
            notify={notify}
            armyLists={armyLists}
            onRestoreBackup={(restored) => {
              if (restored.lists)     saveArmyLists(restored.lists);
              if (restored.units)     saveCustomUnits(restored.units);
              if (restored.overrides) saveOverrides(restored.overrides);
              if (restored.rules)     saveCustomRules(restored.rules);
              notify("✅ Backup restored successfully!");
            }}
          />
        )}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ROSTER VIEW
// ═══════════════════════════════════════════════════════════════

function RosterView({
  faction, activeFaction, armyLists, currentList, currentListId,
  setCurrentListId, createList, deleteList, allUnits, addUnitToList,
  updateEntry, removeEntry, totalPoints, showNewListDialog, setShowNewListDialog, notify,
  magicItems, onOpenGameView,
}) {
  const [newListName, setNewListName] = useState("");
  const [newListPts, setNewListPts] = useState("2000");
  const [showAddUnit, setShowAddUnit] = useState(false);

  const factionLists = Object.values(armyLists).filter(
    (l) => l.faction === activeFaction
  );

  // Group entries by category
  const grouped = {};
  if (currentList) {
    UNIT_CATEGORIES.forEach((cat) => {
      const entries = currentList.entries.filter((e) => e.category === cat);
      if (entries.length > 0) grouped[cat] = entries;
    });
  }

  return (
    <div style={styles.rosterContainer}>
      {/* List Selector */}
      <div style={styles.listSelector}>
        <div style={styles.listSelectorHeader}>
          <h2 style={styles.sectionTitle}>Army Lists</h2>
          <button
            style={{ ...styles.btn, background: faction.color }}
            onClick={() => setShowNewListDialog(true)}
          >
            + New List
          </button>
        </div>
        {factionLists.length === 0 && !showNewListDialog && (
          <div style={styles.emptyState}>
            <p style={{ color: "#9ca3af" }}>No army lists yet. Create one to get started.</p>
          </div>
        )}
        <div style={styles.listGrid}>
          {factionLists.map((l) => (
            <div
              key={l.id}
              onClick={() => setCurrentListId(l.id)}
              style={{
                ...styles.listCard,
                ...(currentListId === l.id ? {
                  borderColor: faction.accent,
                  boxShadow: `0 0 8px ${faction.color}44`,
                } : {}),
              }}
            >
              <div style={styles.listCardHeader}>
                <strong style={{ color: "#e5e7eb" }}>{l.name}</strong>
                <button
                  style={styles.deleteBtn}
                  onClick={(e) => { e.stopPropagation(); deleteList(l.id); }}
                >
                  ✕
                </button>
              </div>
              <div style={styles.listCardMeta}>
                {l.entries.length} units · {l.entries.reduce((s, e) => s + (e.ptsCost || 0), 0)}/{l.pointsLimit} pts
              </div>
            </div>
          ))}
        </div>
        {showNewListDialog && (
          <div style={styles.newListForm}>
            <input
              style={styles.input}
              placeholder="List name..."
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
            />
            <input
              style={{ ...styles.input, width: 100 }}
              type="number"
              placeholder="Points"
              value={newListPts}
              onChange={(e) => setNewListPts(e.target.value)}
            />
            <button
              style={{ ...styles.btn, background: faction.color }}
              onClick={() => {
                if (newListName.trim()) {
                  createList(newListName.trim(), newListPts);
                  setNewListName("");
                  setNewListPts("2000");
                }
              }}
            >
              Create
            </button>
            <button
              style={{ ...styles.btn, background: "#374151" }}
              onClick={() => setShowNewListDialog(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Active List */}
      {currentList && (
        <div style={styles.activeList}>
          <div style={styles.activeListHeader}>
            <h2 style={{ ...styles.sectionTitle, color: faction.accent }}>
              {currentList.name}
            </h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={{ ...styles.btn, background: "#1e3a5f" }}
                onClick={onOpenGameView}
              >
                🎮 Game View
              </button>
              <button
                style={{ ...styles.btn, background: faction.color }}
                onClick={() => setShowAddUnit(!showAddUnit)}
              >
                {showAddUnit ? "Close" : "+ Add Unit"}
              </button>
            </div>
          </div>

          {/* Points Bar */}
          <div style={styles.pointsBar}>
            <div
              style={{
                ...styles.pointsFill,
                width: `${Math.min(100, (totalPoints / currentList.pointsLimit) * 100)}%`,
                background: totalPoints > currentList.pointsLimit
                  ? "linear-gradient(90deg, #ef4444, #dc2626)"
                  : `linear-gradient(90deg, ${faction.color}, ${faction.accent})`,
              }}
            />
          </div>

          {/* Add Unit Panel */}
          {showAddUnit && (
            <AddUnitPanel
              allUnits={allUnits}
              faction={faction}
              onAdd={(unit, qty) => { addUnitToList(unit, qty); }}
            />
          )}

          {/* Grouped Entries */}
          {Object.entries(grouped).map(([cat, entries]) => (
            <div key={cat} style={styles.categoryGroup}>
              <h3 style={{ ...styles.categoryTitle, color: faction.accent }}>{cat}</h3>
              {entries.map((entry) => {
                const unitDef = allUnits.find((u) => u.id === entry.unitId);
                return (
                  <EntryCard
                    key={entry.entryId}
                    entry={entry}
                    unitDef={unitDef}
                    faction={faction}
                    updateEntry={updateEntry}
                    removeEntry={removeEntry}
                    itemsCatalog={magicItems}
                  />
                );
              })}
            </div>
          ))}

          {currentList.entries.length === 0 && (
            <div style={styles.emptyState}>
              <p style={{ color: "#9ca3af", textAlign: "center", padding: 40 }}>
                Your army list is empty. Add units from the panel above or the Unit Database tab.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ADD UNIT PANEL
// ═══════════════════════════════════════════════════════════════

function AddUnitPanel({ allUnits, faction, onAdd }) {
  const [filter, setFilter] = useState("");
  const [selectedCat, setSelectedCat] = useState("All");

  const filtered = allUnits.filter((u) => {
    const matchName = u.name.toLowerCase().includes(filter.toLowerCase());
    const matchCat = selectedCat === "All" || u.category === selectedCat;
    return matchName && matchCat;
  });

  return (
    <div style={styles.addUnitPanel}>
      <div style={styles.addUnitFilters}>
        <input
          style={styles.input}
          placeholder="Search units..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div style={styles.catFilters}>
          {["All", ...UNIT_CATEGORIES].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCat(cat)}
              style={{
                ...styles.catBtn,
                ...(selectedCat === cat
                  ? { background: faction.color, color: "#fff" }
                  : {}),
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
      <div style={styles.addUnitGrid}>
        {filtered.map((unit) => (
          <div key={unit.id} style={styles.addUnitCard}>
            <div>
              <strong style={{ color: "#e5e7eb" }}>{unit.name}</strong>
              <div style={styles.unitMeta}>
                {unit.category} · {unit.troopType || "Character"} ·{" "}
                {unit.isCharacter
                  ? `${unit.ptsCost || "?"} pts`
                  : `${unit.ptsPerModel || "?"} pts/model`}
              </div>
            </div>
            <button
              style={{ ...styles.btn, background: faction.color, padding: "4px 12px", fontSize: 13 }}
              onClick={() => onAdd(unit)}
            >
              Add
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <p style={{ color: "#6b7280", padding: 16 }}>No units found.</p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAGIC ITEMS PANEL
// ═══════════════════════════════════════════════════════════════

function MagicItemsPanel({ entry, unitDef, faction, updateEntry, itemsCatalog }) {
  const [openSlot, setOpenSlot] = useState(null);

  const budget = getMagicItemBudget(unitDef);
  if (budget === 0) return null;

  const allowedSlots = getAllowedSlots(unitDef);
  if (allowedSlots.length === 0) return null;

  const equipped = entry.magicItems || {};
  const spent = calcMagicItemsCost(equipped);
  const remaining = budget - spent;

  // Relic slot blocking for named characters
  const relicSlot = unitDef.relic ? getRelicSlot(unitDef.relic) : null;
  const hasRelic = !!entry.relicForm && !!unitDef.relic && unitDef.relic.name !== "TBD";

  const equipItem = (slot, item) => {
    const updated = { ...equipped, [slot]: item };
    updateEntry(entry.entryId, { magicItems: updated });
    setOpenSlot(null);
  };

  const removeItem = (slot) => {
    const updated = { ...equipped };
    delete updated[slot];
    updateEntry(entry.entryId, { magicItems: updated });
  };

  // Only show slots this character is allowed to use
  const visibleSlots = MAGIC_ITEM_SLOTS.filter(s => allowedSlots.includes(s));

  return (
    <div style={{ margin: "8px 0", padding: 10, background: "#1a1a2e", borderRadius: 6, border: "1px solid #2d2d44" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "#d1d5db", fontSize: 13, fontWeight: 600 }}>⚔️ Magic Items</span>
        <span style={{
          fontSize: 12, fontFamily: "monospace", padding: "2px 8px", borderRadius: 4,
          background: remaining < 0 ? "#7f1d1d" : "#1f2937",
          color: remaining < 0 ? "#fca5a5" : remaining === budget ? "#6b7280" : "#fbbf24",
        }}>
          {spent}/{budget} pts
        </span>
      </div>

      {visibleSlots.map((slot) => {
        // Relic occupies this slot — show locked row
        if (hasRelic && relicSlot === slot) {
          const relicFormLabel = entry.relicForm === "upgraded" ? "★ Upgraded" : "Basic";
          return (
            <div key={slot} style={{ marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", background: "#2a1a0a", borderRadius: 4, border: "1px solid #b4530966" }}>
                <span style={{ color: "#9ca3af", fontSize: 11, minWidth: 90 }}>{MAGIC_SLOT_LABELS[slot]}</span>
                <span style={{ color: "#fbbf24", fontSize: 12, flex: 1, fontStyle: "italic" }}>✦ {unitDef.relic.name}</span>
                <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "#422006", color: "#f59e0b", border: "1px solid #92400e" }}>{relicFormLabel} · Relic</span>
              </div>
            </div>
          );
        }

        const equippedItem = equipped[slot];
        const isOpen = openSlot === slot;
        const items = (itemsCatalog && itemsCatalog[slot]) || [];

        return (
          <div key={slot} style={{ marginBottom: 4 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
              background: equippedItem ? `${faction.color}22` : "#111827",
              borderRadius: 4, border: `1px solid ${equippedItem ? faction.color + "66" : "#1f2937"}`,
            }}>
              <span style={{ color: "#9ca3af", fontSize: 11, minWidth: 90 }}>{MAGIC_SLOT_LABELS[slot]}</span>
              {equippedItem ? (
                <>
                  <span style={{ color: "#e5e7eb", fontSize: 12, flex: 1 }}>{equippedItem.name}</span>
                  <span style={{ color: "#fbbf24", fontSize: 11, fontFamily: "monospace" }}>{equippedItem.pts}pts</span>
                  <button
                    onClick={() => removeItem(slot)}
                    style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 12, padding: "0 4px" }}
                  >✕</button>
                </>
              ) : (
                <button
                  onClick={() => setOpenSlot(isOpen ? null : slot)}
                  style={{
                    background: "none", border: `1px dashed ${isOpen ? faction.accent : "#374151"}`,
                    color: isOpen ? faction.accent : "#6b7280", cursor: "pointer", fontSize: 11,
                    padding: "2px 8px", borderRadius: 3, flex: 1, textAlign: "left",
                  }}
                >
                  {isOpen ? "Cancel" : "+ Equip"}
                </button>
              )}
            </div>

            {isOpen && (
              <div style={{
                maxHeight: 180, overflowY: "auto", background: "#0f0f1a", borderRadius: 4,
                border: "1px solid #2d2d44", marginTop: 2, marginLeft: 96,
              }}>
                {items.filter((item) => item.pts <= remaining).length === 0 ? (
                  <div style={{ color: "#6b7280", fontSize: 11, padding: 8, textAlign: "center" }}>
                    No items fit remaining budget ({remaining}pts)
                  </div>
                ) : (
                  items.map((item) => {
                    const canAfford = item.pts <= remaining;
                    return (
                      <button
                        key={item.name}
                        disabled={!canAfford}
                        onClick={() => canAfford && equipItem(slot, item)}
                        style={{
                          display: "flex", justifyContent: "space-between", width: "100%",
                          padding: "4px 8px", background: "none", border: "none",
                          borderBottom: "1px solid #1f2937", cursor: canAfford ? "pointer" : "default",
                          color: canAfford ? "#d1d5db" : "#4b5563", fontSize: 12, textAlign: "left",
                          opacity: canAfford ? 1 : 0.5,
                        }}
                        onMouseEnter={(e) => { if (canAfford) e.target.style.background = "#1f2937"; }}
                        onMouseLeave={(e) => { e.target.style.background = "none"; }}
                      >
                        <span>{item.name}</span>
                        <span style={{ color: canAfford ? "#fbbf24" : "#4b5563", fontFamily: "monospace" }}>{item.pts}pts</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}

      {Object.keys(equipped).length > 0 && (
        <button
          onClick={() => updateEntry(entry.entryId, { magicItems: {} })}
          style={{
            background: "none", border: "1px solid #374151", color: "#9ca3af",
            cursor: "pointer", fontSize: 11, padding: "3px 10px", borderRadius: 3, marginTop: 6, width: "100%",
          }}
        >
          Clear All Items
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// UNIT UPGRADES PANEL
// ═══════════════════════════════════════════════════════════════

function UpgradesPanel({ entry, unitDef, faction, updateEntry, itemsCatalog }) {
  const upgrades = unitDef.upgrades || [];
  if (upgrades.length === 0) return null;

  const active = entry.activeUpgrades || [];
  const modelCount = entry.modelCount || 1;
  const totalUpgradeCost = upgrades.filter(u => active.includes(u.id)).reduce((s, u) => {
    return s + (u.perModel ? (u.pts || 0) * modelCount : (u.pts || 0));
  }, 0);

  // Command magic items cost
  const commandMagicItems = entry.commandMagicItems || {};
  const commandMagicCost = Object.values(commandMagicItems).reduce((sum, items) => {
    return sum + Object.values(items || {}).reduce((s, item) => s + (item?.pts || 0), 0);
  }, 0);

  const toggle = (upId) => {
    const upDef = upgrades.find(u => u.id === upId);
    if (!upDef) return;

    if (active.includes(upId)) {
      // Deactivating: remove it (and clear any command magic items for this upgrade)
      const next = active.filter(id => id !== upId);
      const changes = { activeUpgrades: next };
      if (upDef.magic && commandMagicItems[upId]) {
        const newCmi = { ...commandMagicItems };
        delete newCmi[upId];
        changes.commandMagicItems = newCmi;
      }
      updateEntry(entry.entryId, changes);
    } else {
      // Sprites budget check — 50pt pool
      if (upDef.type === "sprites") {
        const spent = upgrades
          .filter(u => u.type === "sprites" && active.includes(u.id))
          .reduce((s, u) => s + (u.pts || 0), 0);
        if (spent + (upDef.pts || 0) > 50) return;
      }
      // Activating: if exclusive, deselect other exclusive upgrades of same type
      let next = [...active, upId];
      if (upDef.exclusive) {
        const otherExclusiveIds = upgrades
          .filter(u => u.exclusive && u.type === upDef.type && u.id !== upId)
          .map(u => u.id);
        next = next.filter(id => !otherExclusiveIds.includes(id));
      }
      updateEntry(entry.entryId, { activeUpgrades: next });
    }
  };

  // Group by type
  const commandUpgrades = upgrades.filter(u => (u.type || "equipment") === "command");
  const equipUpgrades = upgrades.filter(u => (u.type || "equipment") === "equipment");
  const specialUpgrades = upgrades.filter(u => (u.type || "equipment") === "special");
  const mountUpgrades = upgrades.filter(u => u.type === "mount");
  const spritesUpgrades = upgrades.filter(u => u.type === "sprites");
  const kindredUpgrades = upgrades.filter(u => u.type === "kindred");
  const loreUpgrades = upgrades.filter(u => u.type === "lore");

  // Sprites budget tracking
  const SPRITES_BUDGET = 50;
  const spritesSpent = spritesUpgrades.filter(u => active.includes(u.id)).reduce((s, u) => s + (u.pts || 0), 0);

  // Check for exclusive groups within equipment (e.g., arrows, knight orders)
  const hasExclusiveEquip = equipUpgrades.some(u => u.exclusive);

  const renderUpgrade = (u, opts = {}) => {
    const isActive = active.includes(u.id);
    const isExclusive = !!u.exclusive;
    // Sprites: disable if adding this would exceed budget
    const wouldExceedBudget = u.type === "sprites" && !isActive && (spritesSpent + (u.pts || 0) > SPRITES_BUDGET);
    const isDisabled = wouldExceedBudget;
    const costDisplay = u.pts > 0
      ? (u.perModel ? `+${u.pts}pts/model` : `+${u.pts}pts`)
      : null;
    return (
      <div key={u.id}>
        <button
          onClick={() => !isDisabled && toggle(u.id)}
          style={{
            display: "flex", alignItems: "center", gap: 6, width: "100%",
            padding: "5px 8px", background: isActive ? `${faction.color}22` : "transparent",
            border: `1px solid ${isActive ? faction.color + "66" : "#1f1f33"}`,
            borderRadius: 4, cursor: isDisabled ? "not-allowed" : "pointer", textAlign: "left", transition: "all 0.15s",
            opacity: isDisabled ? 0.4 : 1,
          }}
        >
          <span style={{
            width: 16, height: 16, borderRadius: isExclusive ? 8 : 3, display: "flex", alignItems: "center", justifyContent: "center",
            border: `1.5px solid ${isActive ? faction.accent : "#4b5563"}`,
            background: isActive ? faction.color : "transparent", fontSize: 11, color: "#fff", flexShrink: 0,
          }}>
            {isActive ? (isExclusive ? "●" : "✓") : ""}
          </span>
          <span style={{ color: isActive ? "#e5e7eb" : "#9ca3af", fontSize: 12, flex: 1 }}>
            {u.name}
            {u.note && <span style={{ color: "#6b7280", fontSize: 10, marginLeft: 4 }}>({u.note})</span>}
            {u.magic && <span style={{ color: "#a78bfa", fontSize: 10, marginLeft: 4 }}>✦ {u.magic.maxPoints}pts items</span>}
            {u.description && (
              <span style={{ display: "block", color: "#6b7280", fontSize: 10, marginTop: 2, fontStyle: "italic", lineHeight: 1.35 }}>
                {u.description}
              </span>
            )}
          </span>
          {costDisplay && (
            <span style={{ color: "#fbbf24", fontSize: 11, fontFamily: "monospace", flexShrink: 0 }}>{costDisplay}</span>
          )}
          {!costDisplay && (
            <span style={{ color: "#6b7280", fontSize: 10, fontFamily: "monospace", flexShrink: 0 }}>free</span>
          )}
        </button>
        {/* Command magic items sub-panel */}
        {isActive && u.magic && u.magic.maxPoints > 0 && itemsCatalog && (
          <CommandMagicItemsPanel
            upgradeId={u.id}
            upgradeName={u.name}
            magic={u.magic}
            entry={entry}
            faction={faction}
            updateEntry={updateEntry}
            itemsCatalog={itemsCatalog}
          />
        )}
      </div>
    );
  };

  const renderGroup = (label, list) => {
    if (list.length === 0) return null;
    const hasExclusive = list.some(u => u.exclusive);
    return (
      <>
        <div style={{ color: "#6b7280", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
          {label}
          {hasExclusive && <span style={{ color: "#4b5563", fontSize: 9, fontStyle: "italic" }}>(pick one)</span>}
        </div>
        {list.map(renderUpgrade)}
      </>
    );
  };

  return (
    <div style={{ margin: "8px 0", padding: 10, background: "#1a1a2e", borderRadius: 6, border: "1px solid #2d2d44" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "#d1d5db", fontSize: 13, fontWeight: 600 }}>⚙ Unit Upgrades</span>
        {(totalUpgradeCost + commandMagicCost) > 0 && (
          <span style={{ fontSize: 12, fontFamily: "monospace", padding: "2px 8px", borderRadius: 4, background: "#1f2937", color: "#fbbf24" }}>
            +{totalUpgradeCost + commandMagicCost} pts
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {renderGroup("Command", commandUpgrades)}
        {hasExclusiveEquip ? (
          <>
            {/* Separate exclusive options from regular options */}
            {renderGroup("Equipment", equipUpgrades.filter(u => !u.exclusive))}
            {renderGroup("Options", equipUpgrades.filter(u => u.exclusive))}
          </>
        ) : (
          renderGroup("Equipment", equipUpgrades)
        )}
        {renderGroup("Special", specialUpgrades)}
        {renderGroup("Mount", mountUpgrades)}
        {/* Forest Sprites – pooled 50pt budget */}
        {spritesUpgrades.length > 0 && (
          <>
            <div style={{ color: "#6b7280", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
              Forest Sprites
              <span style={{ color: spritesSpent >= SPRITES_BUDGET ? "#ef4444" : "#22c55e", fontSize: 9, fontFamily: "monospace" }}>
                ({spritesSpent}/{SPRITES_BUDGET}pts)
              </span>
            </div>
            {spritesUpgrades.map(u => renderUpgrade(u))}
          </>
        )}
        {/* Kindreds – pick one */}
        {kindredUpgrades.length > 0 && renderGroup("Kindred", kindredUpgrades)}
        {/* Lore Selection – pick one */}
        {loreUpgrades.length > 0 && renderGroup("Lore", loreUpgrades)}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMMAND MAGIC ITEMS PANEL (for champions, standard bearers)
// ═══════════════════════════════════════════════════════════════

function CommandMagicItemsPanel({ upgradeId, upgradeName, magic, entry, faction, updateEntry, itemsCatalog }) {
  const [expandedSlot, setExpandedSlot] = useState(null);
  const commandMagicItems = entry.commandMagicItems || {};
  const myItems = commandMagicItems[upgradeId] || {};
  const spentPts = Object.values(myItems).reduce((s, item) => s + (item?.pts || 0), 0);
  const budget = magic.maxPoints || 0;
  const allowedSlots = magic.slots || [];

  if (budget <= 0 || allowedSlots.length === 0) return null;

  const setItem = (slot, item) => {
    const updated = { ...myItems, [slot]: item };
    const newCmi = { ...commandMagicItems, [upgradeId]: updated };
    updateEntry(entry.entryId, { commandMagicItems: newCmi });
    setExpandedSlot(null);
  };

  const clearItem = (slot) => {
    const updated = { ...myItems };
    delete updated[slot];
    const newCmi = { ...commandMagicItems, [upgradeId]: updated };
    updateEntry(entry.entryId, { commandMagicItems: newCmi });
  };

  return (
    <div style={{ marginLeft: 22, marginTop: 2, padding: "6px 8px", background: "#0f0f1a", borderRadius: 4, border: "1px solid #1f1f33" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ color: "#a78bfa", fontSize: 11 }}>✦ {upgradeName} Items</span>
        <span style={{ color: spentPts > budget ? "#ef4444" : "#6b7280", fontSize: 10, fontFamily: "monospace" }}>
          {spentPts}/{budget} pts
        </span>
      </div>
      {allowedSlots.map(slot => {
        const currentItem = myItems[slot];
        const label = MAGIC_SLOT_LABELS[slot] || slot;
        const catalogItems = (itemsCatalog?.[slot] || []).filter(i => (i.pts || 0) <= (budget - spentPts + (currentItem?.pts || 0)));
        return (
          <div key={slot} style={{ marginTop: 2 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 4, padding: "2px 4px",
              background: currentItem ? `${faction.color}15` : "transparent",
              borderRadius: 3, border: `1px solid ${currentItem ? faction.color + "44" : "#1f1f33"}`,
            }}>
              <span style={{ color: "#6b7280", fontSize: 10, minWidth: 70 }}>{label}</span>
              {currentItem ? (
                <>
                  <span style={{ color: "#d1d5db", fontSize: 11, flex: 1 }}>{currentItem.name}</span>
                  <span style={{ color: "#fbbf24", fontSize: 10, fontFamily: "monospace" }}>{currentItem.pts}pts</span>
                  <button
                    onClick={() => clearItem(slot)}
                    style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 10, padding: "0 2px" }}
                  >✕</button>
                </>
              ) : (
                <button
                  onClick={() => setExpandedSlot(expandedSlot === slot ? null : slot)}
                  style={{
                    background: "none", border: `1px dashed ${expandedSlot === slot ? faction.accent : "#374151"}`,
                    color: expandedSlot === slot ? faction.accent : "#4b5563", cursor: "pointer", fontSize: 10,
                    padding: "1px 6px", borderRadius: 3, flex: 1, textAlign: "left",
                  }}
                >
                  {expandedSlot === slot ? "Cancel" : "+ Add"}
                </button>
              )}
            </div>
            {expandedSlot === slot && (
              <div style={{
                maxHeight: 140, overflowY: "auto", background: "#0a0a15", borderRadius: 3,
                border: "1px solid #1f1f33", marginTop: 1, marginLeft: 74,
              }}>
                {catalogItems.length === 0 && (
                  <div style={{ padding: "4px 6px", color: "#4b5563", fontSize: 10 }}>No items fit budget</div>
                )}
                {catalogItems.map(item => (
                  <button
                    key={item.name}
                    onClick={() => setItem(slot, item)}
                    style={{
                      display: "flex", justifyContent: "space-between", width: "100%",
                      padding: "3px 6px", background: "none", border: "none",
                      borderBottom: "1px solid #1a1a2e", cursor: "pointer",
                      color: "#d1d5db", fontSize: 11, textAlign: "left",
                    }}
                    onMouseEnter={(e) => { e.target.style.background = "#1a1a2e"; }}
                    onMouseLeave={(e) => { e.target.style.background = "none"; }}
                  >
                    <span>{item.name}</span>
                    <span style={{ color: "#fbbf24", fontFamily: "monospace", fontSize: 10 }}>{item.pts}pts</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ENCHANTED ARROWS PANEL
// ═══════════════════════════════════════════════════════════════

function EnchantedArrowsPanel({ entry, unitDef, faction, updateEntry }) {
  const [showPicker, setShowPicker] = useState(false);
  const currentArrows = entry.arrows;
  const modelCount = entry.modelCount || 1;
  const usesPerModel = ARROWS_PER_MODEL_UNITS.includes(unitDef?.id);
  const arrowCost = currentArrows
    ? (usesPerModel ? (currentArrows.ptsPerModel || 0) * modelCount : (currentArrows.ptsFlat || 0))
    : 0;

  const selectArrows = (arrow) => {
    updateEntry(entry.entryId, { arrows: arrow });
    setShowPicker(false);
  };

  const removeArrows = () => {
    updateEntry(entry.entryId, { arrows: null });
  };

  return (
    <div style={{ margin: "8px 0", padding: 10, background: "#1a1a2e", borderRadius: 6, border: "1px solid #2d2d44" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ color: "#d1d5db", fontSize: 13, fontWeight: 600 }}>🏹 Enchanted Arrows</span>
        {currentArrows && (
          <span style={{ fontSize: 12, fontFamily: "monospace", padding: "2px 8px", borderRadius: 4, background: "#1f2937", color: "#fbbf24" }}>
            +{arrowCost} pts{usesPerModel ? ` (${currentArrows.ptsPerModel}/model)` : " (flat)"}
          </span>
        )}
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
        background: currentArrows ? `${faction.color}22` : "#111827",
        borderRadius: 4, border: `1px solid ${currentArrows ? faction.color + "66" : "#1f2937"}`,
      }}>
        <span style={{ color: "#9ca3af", fontSize: 11, minWidth: 90 }}>🏹 Arrows</span>
        {currentArrows ? (
          <>
            <span style={{ color: "#e5e7eb", fontSize: 12, flex: 1 }}>{currentArrows.name}</span>
            <span style={{ color: "#fbbf24", fontSize: 11, fontFamily: "monospace" }}>
              {usesPerModel ? `${currentArrows.ptsPerModel}pts/m` : `${currentArrows.ptsFlat}pts`}
            </span>
            <button
              onClick={removeArrows}
              style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 12, padding: "0 4px" }}
            >✕</button>
          </>
        ) : (
          <button
            onClick={() => setShowPicker(!showPicker)}
            style={{
              background: "none", border: `1px dashed ${showPicker ? faction.accent : "#374151"}`,
              color: showPicker ? faction.accent : "#6b7280", cursor: "pointer", fontSize: 11,
              padding: "2px 8px", borderRadius: 3, flex: 1, textAlign: "left",
            }}
          >
            {showPicker ? "Cancel" : "+ Equip Arrows"}
          </button>
        )}
      </div>
      {showPicker && (
        <div style={{
          maxHeight: 180, overflowY: "auto", background: "#0f0f1a", borderRadius: 4,
          border: "1px solid #2d2d44", marginTop: 2, marginLeft: 96,
        }}>
          {ENCHANTED_ARROWS.map((arrow) => (
            <button
              key={arrow.name}
              onClick={() => selectArrows(arrow)}
              style={{
                display: "flex", justifyContent: "space-between", width: "100%",
                padding: "4px 8px", background: "none", border: "none",
                borderBottom: "1px solid #1f2937", cursor: "pointer",
                color: "#d1d5db", fontSize: 12, textAlign: "left",
              }}
              onMouseEnter={(e) => { e.target.style.background = "#1f2937"; }}
              onMouseLeave={(e) => { e.target.style.background = "none"; }}
            >
              <span>{arrow.name}</span>
              <span style={{ color: "#fbbf24", fontFamily: "monospace" }}>
                {usesPerModel ? `${arrow.ptsPerModel}pts/m` : `${arrow.ptsFlat}pts`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ENTRY CARD
// ═══════════════════════════════════════════════════════════════

// Returns the active mount's extra data (profile/equipment/rules) if the unit has one selected
function getActiveMountData(entry, unitDef) {
  if (!entry?.activeUpgrades?.length || !unitDef?.upgrades) return null;
  return (unitDef.upgrades.find(
    (u) => u.type === "mount" && entry.activeUpgrades.includes(u.id) && u.mountProfile
  ) || null);
}

function EntryCard({ entry, unitDef, faction, updateEntry, removeEntry, itemsCatalog }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={styles.entryCard}>
      <div style={styles.entryHeader} onClick={() => setExpanded(!expanded)}>
        <div style={styles.entryLeft}>
          <span style={{ ...styles.expandArrow, transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>
            ▸
          </span>
          <div>
            <strong style={{ color: "#e5e7eb" }}>{unitDef?.name || entry.unitName}</strong>
            {unitDef?._hasOverride && <span style={{ fontSize: 9, color: "#f59e0b", fontWeight: 700, marginLeft: 4 }}>⚑</span>}
            {!entry.isCharacter && (
              <span style={styles.modelCount}> × {entry.modelCount}</span>
            )}
            {entry.isCharacter && entry.magicItems && Object.keys(entry.magicItems).length > 0 && (
              <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
                {Object.entries(entry.magicItems).map(([slot, item]) => item && (
                  <span key={slot} style={{
                    fontSize: 10, padding: "1px 5px", borderRadius: 3,
                    background: "#1f2937", border: "1px solid #374151", color: "#9ca3af",
                  }}>
                    {item.name} ({item.pts})
                  </span>
                ))}
              </div>
            )}
            {entry.arrows && (
              <span style={{
                fontSize: 10, padding: "1px 5px", borderRadius: 3, marginTop: 2, display: "inline-block",
                background: "#422006", border: "1px solid #92400e", color: "#fbbf24",
              }}>
                🏹 {entry.arrows.name}
              </span>
            )}
            {entry.activeUpgrades?.length > 0 && unitDef?.upgrades && (
              <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
                {unitDef.upgrades.filter(u => entry.activeUpgrades.includes(u.id)).map(u => {
                  const actualCost = u.perModel ? (u.pts || 0) * (entry.modelCount || 1) : (u.pts || 0);
                  return (
                    <span key={u.id} style={{
                      fontSize: 10, padding: "1px 5px", borderRadius: 3,
                      background: u.type === "mount" ? "#1a2e1a" : "#1e3a5f",
                      border: `1px solid ${u.type === "mount" ? "#22c55e44" : "#2563eb44"}`,
                      color: u.type === "mount" ? "#86efac" : "#93c5fd",
                    }}>
                      {u.name}{actualCost > 0 ? ` (+${actualCost})` : ""}
                    </span>
                  );
                })}
                {/* Show command magic items as badges too */}
                {entry.commandMagicItems && Object.entries(entry.commandMagicItems).map(([upId, items]) =>
                  Object.entries(items || {}).map(([slot, item]) => item && (
                    <span key={`${upId}-${slot}`} style={{
                      fontSize: 10, padding: "1px 5px", borderRadius: 3,
                      background: "#2d1b4e", border: "1px solid #7c3aed44", color: "#c4b5fd",
                    }}>
                      {item.name} ({item.pts})
                    </span>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        <div style={styles.entryRight}>
          <span style={{ color: "#fbbf24", fontWeight: 600, fontFamily: "monospace" }}>
            {entry.ptsCost} pts
          </span>
          <button
            style={styles.removeBtn}
            onClick={(e) => { e.stopPropagation(); removeEntry(entry.entryId); }}
          >
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <div style={styles.entryExpanded}>
          {/* Model count adjuster */}
          {!entry.isCharacter && unitDef && (
            <div style={styles.countAdjuster}>
              <span style={{ color: "#9ca3af", fontSize: 13 }}>Models:</span>
              <button
                style={styles.adjBtn}
                onClick={() => {
                  const next = Math.max(unitDef.minSize || 1, entry.modelCount - 1);
                  updateEntry(entry.entryId, { modelCount: next });
                }}
              >
                −
              </button>
              <span style={{ color: "#e5e7eb", minWidth: 28, textAlign: "center" }}>{entry.modelCount}</span>
              <button
                style={styles.adjBtn}
                onClick={() => {
                  const next = Math.min(unitDef.maxSize || 99, entry.modelCount + 1);
                  updateEntry(entry.entryId, { modelCount: next });
                }}
              >
                +
              </button>
            </div>
          )}

          {/* Relic toggle */}
          {unitDef?.relic && unitDef.relic.name !== "TBD" && (
            <div style={styles.relicToggle}>
              <span style={{ color: "#9ca3af", fontSize: 13 }}>Relic form:</span>
              <button
                onClick={() => updateEntry(entry.entryId, { relicForm: "basic" })}
                style={{
                  ...styles.relicBtn,
                  ...(entry.relicForm === "basic" ? { background: faction.color, color: "#fff" } : {}),
                }}
              >
                Basic
              </button>
              <button
                onClick={() => updateEntry(entry.entryId, { relicForm: "upgraded" })}
                style={{
                  ...styles.relicBtn,
                  ...(entry.relicForm === "upgraded" ? { background: "#b45309", color: "#fff" } : {}),
                }}
              >
                Upgraded ★
              </button>
            </div>
          )}

          {/* Unit Upgrades (characters and non-characters) */}
          {unitDef?.upgrades?.length > 0 && (
            <UpgradesPanel entry={entry} unitDef={unitDef} faction={faction} updateEntry={updateEntry} itemsCatalog={itemsCatalog} />
          )}

          {/* Magic Items – only mount when character has budget and slots to avoid hook-order issues */}
          {entry.isCharacter && getMagicItemBudget(unitDef) > 0 && getAllowedSlots(unitDef).length > 0 && (
            <MagicItemsPanel entry={entry} unitDef={unitDef} faction={faction} updateEntry={updateEntry} itemsCatalog={itemsCatalog} />
          )}

          {/* Enchanted Arrows – skip if dataset already provides arrow options as upgrades */}
          {unitDef && canTakeEnchantedArrows(unitDef) && !unitHasDatasetArrowOptions(unitDef) && (
            <EnchantedArrowsPanel entry={entry} unitDef={unitDef} faction={faction} updateEntry={updateEntry} />
          )}

          {/* Stat block */}
          {unitDef?.profiles?.length > 0 && (() => {
            const mountUpg = getActiveMountData(entry, unitDef);
            const allProfiles = mountUpg ? [...unitDef.profiles, mountUpg.mountProfile] : unitDef.profiles;
            return (
              <>
                <div style={styles.statBlock}>
                  <table style={styles.statTable}>
                    <thead>
                      <tr>
                        {["", "M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"].map((h) => (
                          <th key={h} style={styles.statTh}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allProfiles.map((p, i) => {
                        const isMount = i >= unitDef.profiles.length;
                        return (
                          <tr key={i}>
                            <td style={{ ...styles.statTd, color: isMount ? "#4ade80" : faction.accent, textAlign: "left", fontWeight: 600, fontSize: 12 }}>
                              {isMount ? "🐉 " : ""}{p.name}
                            </td>
                            {["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"].map((s) => {
                              const isOverridden = !isMount && unitDef._overriddenStats?.[i]?.[s];
                              return (
                                <td key={s} style={{
                                  ...styles.statTd,
                                  ...(isOverridden ? { color: "#fbbf24", fontWeight: 700, background: "#422006", borderRadius: 2 } : {}),
                                }}
                                  title={isOverridden ? `House ruled: ${isOverridden.from} → ${isOverridden.to}` : undefined}
                                >{p[s]}</td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {mountUpg?.mountEquipment?.length > 0 && (
                  <div style={{ padding: "3px 10px 5px", fontSize: 12, color: "#4ade80" }}>
                    🐉 <strong>Weapons:</strong> {mountUpg.mountEquipment.join(" · ")}
                  </div>
                )}
                {mountUpg?.mountArmour && (
                  <div style={{ padding: "1px 10px 4px", fontSize: 12, color: "#4ade80" }}>
                    🐉 <strong>Armour:</strong> {mountUpg.mountArmour}
                  </div>
                )}
                {mountUpg?.mountRules?.length > 0 && (
                  <div style={{ padding: "2px 10px 5px", fontSize: 12, color: "#86efac" }}>
                    🐉 <strong>Rules:</strong> {mountUpg.mountRules.join(", ")}
                  </div>
                )}
                {mountUpg?.mountBase && (
                  <div style={{ padding: "1px 10px 5px", fontSize: 11, color: "#6b7280" }}>
                    🐉 Base: {mountUpg.mountBase}
                  </div>
                )}
              </>
            );
          })()}

          {/* Special rules */}
          {unitDef?.specialRules?.length > 0 && (
            <div style={styles.rulesBlock}>
              {unitDef.specialRules.map((r, i) => {
                const isAdded = unitDef._addedRules?.includes(r);
                return (
                  <div key={i} style={{
                    ...styles.ruleItem,
                    ...(isAdded ? { color: "#fbbf24", fontWeight: 600 } : {}),
                  }}>
                    {isAdded ? "⚑ " : "• "}{r}
                  </div>
                );
              })}
            </div>
          )}

          {/* House rule note on overridden units */}
          {unitDef?._houseRuleNote && (
            <div style={{ marginTop: 8, padding: "6px 10px", background: "#422006", borderRadius: 4, border: "1px solid #92400e", fontSize: 11, color: "#fbbf24" }}>
              ⚑ {unitDef._houseRuleNote}
            </div>
          )}

          {/* Notes */}
          <textarea
            style={styles.notesInput}
            placeholder="Add notes (traits, upgrades, etc.)..."
            value={entry.notes}
            onChange={(e) => updateEntry(entry.entryId, { notes: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// UNITS VIEW
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// NAMED CHARACTERS VIEW
// ═══════════════════════════════════════════════════════════════

function NamedCharactersView({ allUnits, faction, activeFaction, addUnitToList }) {
  const [selected, setSelected] = useState(null);
  const namedChars = allUnits.filter(u => u.isNamed || u.category === "Named Characters");

  const relicColor = { basic: "#4c1d95", upgraded: "#92400e" };

  const renderRelic = (relic) => {
    if (!relic || relic.name === "TBD") return null;
    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 13, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          ✦ Relic: {relic.name}
          <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 400, textTransform: "uppercase", letterSpacing: 1 }}>{relic.type}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ background: "#1a1230", border: "1px solid #4c1d9566", borderRadius: 6, padding: 12 }}>
            <div style={{ color: "#a78bfa", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Basic Form</div>
            <p style={{ color: "#d1d5db", fontSize: 12, margin: 0, lineHeight: 1.6 }}>{relic.basicForm}</p>
          </div>
          <div style={{ background: "#1a1510", border: "1px solid #92400e66", borderRadius: 6, padding: 12 }}>
            <div style={{ color: "#f59e0b", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>★ Upgraded Form</div>
            <p style={{ color: "#d1d5db", fontSize: 12, margin: 0, lineHeight: 1.6 }}>{relic.upgradedForm}</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", gap: 16, height: "100%", minHeight: 0 }}>
      {/* Sidebar */}
      <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ ...styles.sectionTitle, marginBottom: 12 }}>⚔️ Named Characters</h2>
        {namedChars.length === 0 && (
          <p style={{ color: "#6b7280", fontSize: 13 }}>No named characters found.</p>
        )}
        {namedChars.map(u => (
          <button
            key={u.id}
            onClick={() => setSelected(u)}
            style={{
              ...styles.unitListItem,
              ...(selected?.id === u.id ? { background: `${faction.color}44`, borderColor: faction.accent } : {}),
              flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "8px 12px",
            }}
          >
            <span style={{ color: "#e5e7eb", fontWeight: 600, fontSize: 13 }}>{u.name}</span>
            <span style={{ color: "#6b7280", fontSize: 11 }}>
              {u.ptsCost}pts
              {u.relic && u.relic.name !== "TBD" && (
                <span style={{ color: "#fbbf24", marginLeft: 6 }}>✦ {u.relic.name.split(" (")[0]}</span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
        {!selected ? (
          <div style={styles.emptyState}>
            <p style={{ color: "#6b7280" }}>Select a named character to view their full profile and relic.</p>
          </div>
        ) : (
          <div style={{ padding: 4 }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h2 style={{ color: faction.accent, margin: 0, fontSize: 22, fontWeight: 700 }}>{selected.name}</h2>
                <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 4 }}>
                  {selected.troopType || "Character"} · {selected.ptsCost}pts
                  {selected.base && <span style={{ marginLeft: 8 }}>· Base: {selected.base}mm</span>}
                </div>
              </div>
              {addUnitToList && (
                <button
                  style={{ ...styles.btn, background: faction.color }}
                  onClick={() => addUnitToList(selected)}
                >
                  + Add to List
                </button>
              )}
            </div>

            {/* Stat block */}
            {selected.profiles?.length > 0 && (
              <div style={styles.statBlock}>
                <table style={styles.statTable}>
                  <thead>
                    <tr>{["Model","M","WS","BS","S","T","W","I","A","Ld"].map(h => (
                      <th key={h} style={styles.statHeader}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {selected.profiles.map((p, i) => (
                      <tr key={i}>{[p.name, p.M, p.WS, p.BS, p.S, p.T, p.W, p.I, p.A, p.Ld].map((v, j) => (
                        <td key={j} style={{ ...styles.statCell, ...(j > 0 ? { textAlign: "center" } : {}) }}>{v ?? "-"}</td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Equipment */}
            {selected.equipment?.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ color: "#6b7280", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Equipment</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {selected.equipment.map((eq, i) => (
                    <span key={i} style={{ fontSize: 12, padding: "3px 8px", background: "#1f2937", border: "1px solid #374151", borderRadius: 4, color: "#d1d5db" }}>
                      {eq}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Special Rules */}
            {selected.specialRules?.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ color: "#6b7280", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Special Rules</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {selected.specialRules.map((r, i) => (
                    <span key={i} style={{ fontSize: 12, padding: "3px 8px", background: "#0f1629", border: `1px solid ${faction.color}44`, borderRadius: 4, color: "#93c5fd" }}>
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Relic */}
            {renderRelic(selected.relic)}

            {/* Upgrades preview */}
            {selected.upgrades?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ color: "#6b7280", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Available Upgrades</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {selected.upgrades.filter(u => u.type !== "lore").map((u, i) => (
                    <span key={i} style={{
                      fontSize: 11, padding: "3px 8px", borderRadius: 4,
                      background: u.type === "mount" ? "#1a2e1a" : u.type === "sprites" ? "#1a1a10" : "#1e3a5f",
                      border: `1px solid ${u.type === "mount" ? "#22c55e44" : u.type === "sprites" ? "#84cc1644" : "#2563eb44"}`,
                      color: u.type === "mount" ? "#86efac" : u.type === "sprites" ? "#bef264" : "#93c5fd",
                    }}>
                      {u.name}{u.pts > 0 ? ` (+${u.pts})` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {selected.notes && (
              <div style={{ marginTop: 14, color: "#6b7280", fontSize: 12, fontStyle: "italic", borderTop: "1px solid #1f2937", paddingTop: 10 }}>
                {selected.notes}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
function UnitsView({ allUnits, faction, activeFaction, selectedUnit, setSelectedUnit, addUnitToList, unitOverrides, saveOverrides, editingOverrideUnitId, setEditingOverrideUnitId }) {
  const [filter, setFilter] = useState("");
  const newRecruitUrl = getNewRecruitWikiUrl(activeFaction);

  const filtered = allUnits.filter((u) =>
    u.name.toLowerCase().includes(filter.toLowerCase())
  );

  const byCategory = {};
  UNIT_CATEGORIES.forEach((cat) => {
    const units = filtered.filter((u) => u.category === cat);
    if (units.length > 0) byCategory[cat] = units;
  });

  return (
    <div style={styles.unitsContainer}>
      <div style={styles.unitsSidebar}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <h2 style={{ ...styles.sectionTitle, marginBottom: 0 }}>Unit Database</h2>
          <a
            href={newRecruitUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12,
              color: faction.accent,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
            title="Open this faction on New Recruit to verify points and rules"
          >
            Verify on New Recruit ↗
          </a>
        </div>
        <input
          style={styles.input}
          placeholder="Search..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {Object.entries(byCategory).map(([cat, units]) => (
          <div key={cat}>
            <h3 style={{ ...styles.categoryTitle, color: faction.accent, marginTop: 16 }}>{cat}</h3>
            {units.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelectedUnit(u)}
                style={{
                  ...styles.unitListItem,
                  ...(selectedUnit?.id === u.id
                    ? { background: `${faction.color}44`, borderColor: faction.accent }
                    : {}),
                  ...(u._hasOverride ? { borderLeft: "3px solid #f59e0b" } : {}),
                }}
              >
                <span style={{ color: "#e5e7eb", display: "flex", alignItems: "center", gap: 4 }}>
                  {u.name}
                  {u._hasOverride && <span style={{ fontSize: 9, color: "#f59e0b", fontWeight: 700 }}>⚑</span>}
                  {u.isCustom && <span style={{ fontSize: 9, color: "#fbbf24", fontWeight: 700 }}>★</span>}
                </span>
                <span style={{ color: "#6b7280", fontSize: 12 }}>
                  {u.isCharacter ? `${u.ptsCost || "?"}pts` : `${u.ptsPerModel || "?"}pts/m`}
                </span>
              </button>
            ))}
          </div>
        ))}
        {Object.keys(byCategory).length === 0 && (
          <p style={{ color: "#6b7280", padding: 16 }}>No units found.</p>
        )}
      </div>

      <div style={styles.unitsDetail}>
        {selectedUnit ? (
          <UnitDetail
            unit={selectedUnit}
            faction={faction}
            addToList={addUnitToList}
            unitOverrides={unitOverrides}
            saveOverrides={saveOverrides}
            editingOverrideUnitId={editingOverrideUnitId}
            setEditingOverrideUnitId={setEditingOverrideUnitId}
          />
        ) : (
          <div style={styles.emptyState}>
            <p style={{ color: "#6b7280" }}>Select a unit to view its profile.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// UNIT OVERRIDE EDITOR
// ═══════════════════════════════════════════════════════════════

function UnitOverrideEditor({ unit, override, onSave, onCancel, faction }) {
  const [ov, setOv] = useState(() => ({
    houseRuleNote: override.houseRuleNote || "",
    ptsOverride: override.ptsOverride ?? "",
    minSizeOverride: override.minSizeOverride ?? "",
    maxSizeOverride: override.maxSizeOverride ?? "",
    addSpecialRules: (override.addSpecialRules || []).join("\n"),
    removeSpecialRules: (override.removeSpecialRules || []).join("\n"),
    addEquipment: (override.addEquipment || []).join("\n"),
    removeEquipment: (override.removeEquipment || []).join("\n"),
    statOverrides: override.statOverrides || {},
  }));

  const STATS = ["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"];

  const handleSave = () => {
    const parsed = {
      houseRuleNote: ov.houseRuleNote.trim() || undefined,
      ptsOverride: ov.ptsOverride !== "" ? Number(ov.ptsOverride) : undefined,
      minSizeOverride: ov.minSizeOverride !== "" ? Number(ov.minSizeOverride) : undefined,
      maxSizeOverride: ov.maxSizeOverride !== "" ? Number(ov.maxSizeOverride) : undefined,
      addSpecialRules: ov.addSpecialRules.split("\n").filter(s => s.trim()) || undefined,
      removeSpecialRules: ov.removeSpecialRules.split("\n").filter(s => s.trim()) || undefined,
      addEquipment: ov.addEquipment.split("\n").filter(s => s.trim()) || undefined,
      removeEquipment: ov.removeEquipment.split("\n").filter(s => s.trim()) || undefined,
      statOverrides: Object.keys(ov.statOverrides).length > 0 ? ov.statOverrides : undefined,
    };
    // Clean undefineds
    Object.keys(parsed).forEach(k => {
      if (parsed[k] === undefined || (Array.isArray(parsed[k]) && parsed[k].length === 0)) delete parsed[k];
    });
    onSave(parsed);
  };

  const handleClear = () => {
    onSave({});
  };

  const updateStat = (profileIdx, stat, val) => {
    const updated = { ...ov.statOverrides };
    if (!updated[profileIdx]) updated[profileIdx] = {};
    if (val === "" || val == null) {
      delete updated[profileIdx][stat];
      if (Object.keys(updated[profileIdx]).length === 0) delete updated[profileIdx];
    } else {
      updated[profileIdx][stat] = val;
    }
    setOv({ ...ov, statOverrides: updated });
  };

  const fld = styles.formField;
  const lbl = styles.formLabel;
  const inp = styles.input;

  return (
    <div style={{ margin: "16px 0", padding: 16, background: "#1a1528", borderRadius: 8, border: "2px solid #4c1d95" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ color: "#c4b5fd", margin: 0, fontSize: 15 }}>✎ House Rule Override: {unit.name}</h3>
        <div style={{ display: "flex", gap: 6 }}>
          {override.houseRuleNote && (
            <button style={{ ...styles.btn, background: "#7f1d1d", fontSize: 11 }} onClick={handleClear}>
              Reset All
            </button>
          )}
        </div>
      </div>

      <p style={{ color: "#6b7280", fontSize: 12, margin: "0 0 12px", lineHeight: 1.5 }}>
        Patch this unit without replacing it. Only fields you fill in will override the base data. Leave blank to keep original values.
      </p>

      {/* House rule note */}
      <div style={fld}>
        <label style={lbl}>House Rule Note (shown on datasheet)</label>
        <input
          style={inp}
          value={ov.houseRuleNote}
          onChange={(e) => setOv({ ...ov, houseRuleNote: e.target.value })}
          placeholder="e.g. Waywatchers get +1 to wound when stationary"
        />
      </div>

      {/* Points and size overrides */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginTop: 12 }}>
        <div style={fld}>
          <label style={lbl}>{unit.isCharacter ? "Points Cost" : "Pts/Model"} Override</label>
          <input
            style={inp}
            type="number"
            value={ov.ptsOverride}
            onChange={(e) => setOv({ ...ov, ptsOverride: e.target.value })}
            placeholder={String(unit.isCharacter ? (unit.ptsCost || 0) : (unit.ptsPerModel || 0))}
          />
        </div>
        {!unit.isCharacter && (
          <>
            <div style={fld}>
              <label style={lbl}>Min Size Override</label>
              <input style={inp} type="number" value={ov.minSizeOverride}
                onChange={(e) => setOv({ ...ov, minSizeOverride: e.target.value })}
                placeholder={String(unit.minSize || 1)} />
            </div>
            <div style={fld}>
              <label style={lbl}>Max Size Override</label>
              <input style={inp} type="number" value={ov.maxSizeOverride}
                onChange={(e) => setOv({ ...ov, maxSizeOverride: e.target.value })}
                placeholder={String(unit.maxSize || 99)} />
            </div>
          </>
        )}
      </div>

      {/* Stat overrides */}
      {unit.profiles?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <label style={lbl}>Stat Overrides (leave blank = no change)</label>
          {unit.profiles.map((p, pi) => (
            <div key={pi} style={{ marginTop: 4 }}>
              <span style={{ color: "#9ca3af", fontSize: 11 }}>{p.name}:</span>
              <div style={{ display: "flex", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
                {STATS.map(stat => (
                  <div key={stat} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <span style={{ color: "#6b7280", fontSize: 9 }}>{stat}</span>
                    <input
                      style={{ ...inp, width: 38, textAlign: "center", padding: "4px 2px", fontSize: 12 }}
                      value={ov.statOverrides[pi]?.[stat] || ""}
                      onChange={(e) => updateStat(pi, stat, e.target.value)}
                      placeholder={String(p[stat] || "-")}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Special rules add/remove */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        <div style={fld}>
          <label style={lbl}>Add Special Rules (one per line)</label>
          <textarea
            style={{ ...inp, height: 60, resize: "vertical" }}
            value={ov.addSpecialRules}
            onChange={(e) => setOv({ ...ov, addSpecialRules: e.target.value })}
            placeholder={"e.g.\nStationary Precision: +1 to wound when not moving"}
          />
        </div>
        <div style={fld}>
          <label style={lbl}>Remove Special Rules (name match, one per line)</label>
          <textarea
            style={{ ...inp, height: 60, resize: "vertical" }}
            value={ov.removeSpecialRules}
            onChange={(e) => setOv({ ...ov, removeSpecialRules: e.target.value })}
            placeholder={"e.g.\nSkirmish"}
          />
        </div>
      </div>

      {/* Equipment add/remove */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <div style={fld}>
          <label style={lbl}>Add Equipment (one per line)</label>
          <textarea
            style={{ ...inp, height: 50, resize: "vertical" }}
            value={ov.addEquipment}
            onChange={(e) => setOv({ ...ov, addEquipment: e.target.value })}
            placeholder="e.g. Enchanted Cloak"
          />
        </div>
        <div style={fld}>
          <label style={lbl}>Remove Equipment (name match, one per line)</label>
          <textarea
            style={{ ...inp, height: 50, resize: "vertical" }}
            value={ov.removeEquipment}
            onChange={(e) => setOv({ ...ov, removeEquipment: e.target.value })}
            placeholder="e.g. Shield"
          />
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <button style={{ ...styles.btn, background: "#374151" }} onClick={onCancel}>Cancel</button>
        <button style={{ ...styles.btn, background: "#4c1d95" }} onClick={handleSave}>
          Save Override
        </button>
      </div>
    </div>
  );
}

function UnitDetail({ unit, faction, addToList, unitOverrides, saveOverrides, editingOverrideUnitId, setEditingOverrideUnitId }) {
  const parsed = parseWeapons(unit.equipment);
  const { weapons, nonWeapons } = parsed.weapons !== undefined ? parsed : { weapons: [], nonWeapons: unit.equipment || [] };
  const isEditing = editingOverrideUnitId === unit.id;

  const tblStyle = { width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "'Segoe UI', sans-serif", marginBottom: 16 };
  const thStyle = { padding: "6px 10px", textAlign: "left", background: "#1a1a2e", color: "#e5e7eb", borderBottom: "2px solid #2d2d44", fontWeight: 700, fontSize: 12 };
  const tdStyle = { padding: "6px 10px", textAlign: "left", color: "#d1d5db", borderBottom: "1px solid #1f1f33" };
  const sectionGap = { marginTop: 20 };

  return (
    <div style={styles.unitDetail}>
      {/* Header */}
      <div style={styles.unitDetailHeader}>
        <div>
          <h2 style={{ color: faction.accent, margin: 0, fontSize: 22 }}>
            {unit.name}
          </h2>
          <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {unit.category}
            {unit.isCustom && <span style={styles.customBadge}>HOMEBREW</span>}
            {unit._hasOverride && (
              <span style={styles.houseRuleBadge}>⚑ HOUSE RULED</span>
            )}
          </div>
          {/* House rule note */}
          {unit._houseRuleNote && (
            <div style={{ marginTop: 6, padding: "6px 10px", background: "#422006", borderRadius: 4, border: "1px solid #92400e", fontSize: 12, color: "#fbbf24" }}>
              📋 {unit._houseRuleNote}
            </div>
          )}
          {/* Override change summary */}
          {unit._overrideChanges?.length > 0 && (
            <div style={{ marginTop: 6, padding: "6px 10px", background: "#1e1b2e", borderRadius: 4, border: "1px solid #4c1d95", fontSize: 11, color: "#c4b5fd" }}>
              {unit._overrideChanges.map((c, i) => <div key={i}>• {c}</div>)}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#fbbf24", fontSize: 20, fontWeight: 700 }}>
            {unit.isCharacter ? `${unit.ptsCost || "?"} pts` : `${unit.ptsPerModel || "?"} pts/model`}
          </div>
          {!unit.isCharacter && (
            <div style={{ color: "#6b7280", fontSize: 12 }}>
              Size: {unit.minSize || "?"}-{unit.maxSize || "?"}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
            {addToList && (
              <button
                style={{ ...styles.btn, background: faction.color }}
                onClick={() => addToList(unit)}
              >
                + Add to List
              </button>
            )}
            {saveOverrides && !unit.isCustom && (
              <button
                style={{ ...styles.btn, background: isEditing ? "#7f1d1d" : "#4c1d95", fontSize: 12 }}
                onClick={() => setEditingOverrideUnitId(isEditing ? null : unit.id)}
              >
                {isEditing ? "✕ Close" : "✎ House Rule"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Override Editor */}
      {isEditing && saveOverrides && (
        <UnitOverrideEditor
          unit={unit}
          override={unitOverrides?.[unit.id] || {}}
          onSave={(ov) => {
            const updated = { ...unitOverrides };
            // Clean empty overrides
            const isEmpty = !ov.houseRuleNote && !ov.ptsOverride && !ov.minSizeOverride && !ov.maxSizeOverride
              && !ov.addSpecialRules?.length && !ov.removeSpecialRules?.length
              && !ov.addEquipment?.length && !ov.removeEquipment?.length
              && !ov.addUpgrades?.length && !ov.removeUpgrades?.length
              && (!ov.statOverrides || Object.keys(ov.statOverrides).length === 0);
            if (isEmpty) {
              delete updated[unit.id];
            } else {
              updated[unit.id] = ov;
            }
            saveOverrides(updated);
            setEditingOverrideUnitId(null);
          }}
          onCancel={() => setEditingOverrideUnitId(null)}
          faction={faction}
        />
      )}

      {/* ── Model Profile Table ── */}
      {unit.profiles?.length > 0 && (
        <div style={sectionGap}>
          <table style={tblStyle}>
            <thead>
              <tr>
                {["Model", "M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"].map((h) => (
                  <th key={h} style={{ ...thStyle, textAlign: h === "Model" ? "left" : "center", minWidth: h === "Model" ? 140 : 36 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {unit.profiles.map((p, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, color: faction.accent, fontWeight: 600 }}>{p.name}</td>
                  {["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"].map((s) => {
                    const isOverridden = unit._overriddenStats?.[i]?.[s];
                    return (
                      <td key={s} style={{
                        ...tdStyle,
                        textAlign: "center",
                        ...(isOverridden ? {
                          color: "#fbbf24",
                          fontWeight: 700,
                          background: "#422006",
                        } : {}),
                      }}
                        title={isOverridden ? `House ruled: ${isOverridden.from} → ${isOverridden.to}` : undefined}
                      >{p[s]}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Weapon Table ── */}
      {weapons.length > 0 && (
        <div>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={{ ...thStyle, minWidth: 160 }}>Weapon</th>
                <th style={thStyle}>R</th>
                <th style={thStyle}>S</th>
                <th style={thStyle}>AP</th>
                <th style={thStyle}>Special Rules</th>
              </tr>
            </thead>
            <tbody>
              {weapons.map((w, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{w.name}</td>
                  <td style={tdStyle}>{w.range}</td>
                  <td style={tdStyle}>{w.strength}</td>
                  <td style={tdStyle}>{w.ap}</td>
                  <td style={tdStyle}>{w.specRules}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {unit.equipment?.some(e => /unless specified/i.test(e)) || (
            <div style={{ color: "#6b7280", fontSize: 11, marginTop: -12, marginBottom: 12, fontStyle: "italic" }}>
              Unless specified otherwise, all models are assumed to be equipped with a hand weapon.
            </div>
          )}
        </div>
      )}

      {/* ── Non-weapon Equipment ── */}
      {nonWeapons.length > 0 && (
        <div>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Equipment</th>
              </tr>
            </thead>
            <tbody>
              {nonWeapons.map((e, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{e}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Base & Unit Info Tables ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Base */}
        {unit.base && (
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Base</th>
                <th style={thStyle}>Base Size</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={tdStyle}>Base</td>
                <td style={tdStyle}>{unit.base}</td>
              </tr>
            </tbody>
          </table>
        )}
        {/* Unit Info */}
        <table style={tblStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Unit</th>
              <th style={thStyle}>Troop Type</th>
              {!unit.isCharacter && <th style={thStyle}>Unit Size</th>}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdStyle}>{unit.name.split("(")[0].trim()}</td>
              <td style={{ ...tdStyle, color: "#93c5fd" }}>{unit.troopType || "—"}</td>
              {!unit.isCharacter && (
                <td style={tdStyle}>{unit.minSize || 1}{unit.maxSize && unit.maxSize !== unit.minSize ? `-${unit.maxSize}` : ""}</td>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Special Rules (full descriptions) ── */}
      {unit.specialRules?.length > 0 && (
        <div style={{ ...sectionGap, background: "#0f0f1a", border: "1px solid #2d2d44", borderRadius: 8, overflow: "hidden" }}>
          <div style={{
            padding: "8px 14px", background: "#1a1a2e", borderBottom: "2px solid #2d2d44",
            fontWeight: 700, color: "#e5e7eb", fontSize: 13, fontFamily: "'Segoe UI', sans-serif",
          }}>
            Special Rules
          </div>
          <div style={{ padding: "10px 14px" }}>
            {unit.specialRules.map((r, i) => {
              // Extract rule name (before any colon or parenthetical detail)
              const ruleName = r.split(":")[0].split("(")[0].trim();
              // Look for full description - try exact match first, then base name
              const desc = SPECIAL_RULES_DESC[r] || SPECIAL_RULES_DESC[ruleName] || null;
              const isAdded = unit._addedRules?.includes(r);
              return (
                <div key={i} style={{
                  padding: "8px 0",
                  borderBottom: i < unit.specialRules.length - 1 ? "1px solid #1f1f33" : "none",
                  ...(isAdded ? { background: "#42200622", borderLeft: "3px solid #f59e0b", paddingLeft: 10, marginLeft: -14 } : {}),
                }}>
                  {isAdded && <span style={{ color: "#f59e0b", fontSize: 10, fontWeight: 700, marginRight: 6 }}>⚑ HOUSE RULE</span>}
                  <span style={{ color: isAdded ? "#fbbf24" : "#e5e7eb", fontWeight: 700, fontSize: 13 }}>{r.split(":")[0]}:</span>
                  <span style={{ color: isAdded ? "#fcd34d" : "#9ca3af", fontSize: 13, marginLeft: 4 }}>
                    {desc || (r.includes(":") ? r.split(":").slice(1).join(":").trim() : r)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Available Upgrades ── */}
      {unit.upgrades?.length > 0 && (
        <div style={{ ...sectionGap, background: "#0f0f1a", border: "1px solid #2d2d44", borderRadius: 8, overflow: "hidden" }}>
          <div style={{
            padding: "8px 14px", background: "#1a1a2e", borderBottom: "2px solid #2d2d44",
            fontWeight: 700, color: "#e5e7eb", fontSize: 13, fontFamily: "'Segoe UI', sans-serif",
          }}>
            Available Upgrades
          </div>
          <div style={{ padding: "8px 14px" }}>
            {unit.upgrades.map((u, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "5px 0",
                borderBottom: i < unit.upgrades.length - 1 ? "1px solid #1f1f33" : "none",
              }}>
                <span style={{ color: "#d1d5db", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "#6b7280", fontSize: 10, textTransform: "uppercase" }}>
                    {u.type}
                  </span>
                  {u.name}
                  {u.note && <span style={{ color: "#6b7280", fontSize: 11 }}>({u.note})</span>}
                  {u.exclusive && <span style={{ color: "#4b5563", fontSize: 9, fontStyle: "italic" }}>⊘</span>}
                  {u.magic && <span style={{ color: "#a78bfa", fontSize: 10 }}>✦ {u.magic.maxPoints}pts</span>}
                </span>
                <span style={{ color: u.pts > 0 ? "#fbbf24" : "#6b7280", fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                  {u.pts > 0 ? `+${u.pts} pts${u.perModel ? "/model" : ""}` : "free"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Relic ── */}
      {unit.relic && (
        <div style={{ ...styles.detailSection, borderLeft: `3px solid #b45309`, paddingLeft: 16, marginTop: 20 }}>
          <h3 style={{ ...styles.detailLabel, color: "#fbbf24" }}>
            ✨ Relic: {unit.relic.name}
          </h3>
          <div style={{ color: "#9ca3af", fontSize: 12, marginBottom: 8 }}>Type: {unit.relic.type}</div>
          <div style={styles.relicFormBlock}>
            <strong style={{ color: "#d1d5db" }}>Basic Form:</strong>
            <p style={{ color: "#9ca3af", marginTop: 4 }}>{unit.relic.basicForm}</p>
          </div>
          <div style={{ ...styles.relicFormBlock, borderColor: "#b45309" }}>
            <strong style={{ color: "#fbbf24" }}>★ Upgraded Form:</strong>
            <p style={{ color: "#9ca3af", marginTop: 4 }}>{unit.relic.upgradedForm}</p>
          </div>
        </div>
      )}

      {/* ── Restrictions ── */}
      {unit.restrictions?.length > 0 && (
        <div style={{ ...styles.detailSection, marginTop: 16 }}>
          <h3 style={{ ...styles.detailLabel, color: "#ef4444" }}>Restrictions</h3>
          {unit.restrictions.map((r, i) => (
            <div key={i} style={{ color: "#fca5a5", fontSize: 13, marginTop: 4 }}>⚠ {r}</div>
          ))}
        </div>
      )}

      {/* ── Notes ── */}
      {unit.notes && (
        <div style={{ ...styles.detailSection, marginTop: 16 }}>
          <h3 style={styles.detailLabel}>Notes</h3>
          <p style={{ color: "#9ca3af" }}>{unit.notes}</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ITEMS VIEW
// ═══════════════════════════════════════════════════════════════

function ItemsView({ allUnits, faction, magicItems }) {
  const characters = allUnits.filter((u) => u.isCharacter && u.relic);

  return (
    <div style={styles.itemsContainer}>
      <h2 style={styles.sectionTitle}>Character Relics</h2>
      <p style={{ color: "#9ca3af", marginBottom: 24 }}>
        Each character has a unique relic with a basic and upgraded form, unlocked through campaign quests.
      </p>
      <div style={styles.itemsGrid}>
        {characters.map((char) => (
          <div key={char.id} style={styles.relicCard}>
            <div style={styles.relicCardHeader}>
              <div>
                <h3 style={{ color: "#fbbf24", margin: 0, fontSize: 18 }}>
                  {char.relic.name}
                </h3>
                <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 2 }}>
                  {char.name} · {char.relic.type}
                </div>
              </div>
              <span style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 4,
                background: char.relic.name === "TBD" ? "#374151" : `${faction.color}66`,
                color: char.relic.name === "TBD" ? "#6b7280" : faction.accent,
              }}>
                {char.relic.name === "TBD" ? "PENDING" : "DESIGNED"}
              </span>
            </div>
            {char.relic.name !== "TBD" && (
              <>
                <div style={{ ...styles.relicFormBlock, marginTop: 12 }}>
                  <strong style={{ color: "#d1d5db", fontSize: 13 }}>Basic Form</strong>
                  <p style={{ color: "#9ca3af", fontSize: 13, marginTop: 4 }}>{char.relic.basicForm}</p>
                </div>
                <div style={{ ...styles.relicFormBlock, borderColor: "#b45309" }}>
                  <strong style={{ color: "#fbbf24", fontSize: 13 }}>★ Upgraded Form</strong>
                  <p style={{ color: "#9ca3af", fontSize: 13, marginTop: 4 }}>{char.relic.upgradedForm}</p>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Common Magic Items Reference */}
      <h2 style={{ ...styles.sectionTitle, marginTop: 40 }}>Common Magic Items</h2>
      <p style={{ color: "#9ca3af", marginBottom: 16 }}>
        Available to all factions. Points shown are base cost.
      </p>
      {Object.entries(magicItems).map(([category, items]) => (
        <div key={category} style={{ marginBottom: 20 }}>
          <h3 style={{ color: "#fbbf24", fontSize: 15, marginBottom: 8, textTransform: "capitalize" }}>
            {({ weapons: "Magic Weapons", armour: "Magic Armour", talismans: "Talismans", enchanted: "Enchanted Items", arcane: "Arcane Items", banners: "Magic Standards" })[category] || category}
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {items.map((item) => (
              <span key={item.name} style={{
                fontSize: 12, padding: "3px 8px", borderRadius: 4,
                background: "#1f2937", border: "1px solid #374151", color: "#d1d5db",
              }}>
                {item.name} <span style={{ color: "#fbbf24" }}>{item.pts}pts</span>
              </span>
            ))}
          </div>
        </div>
      ))}

      {/* Enchanted Arrows Reference */}
      <h2 style={{ ...styles.sectionTitle, marginTop: 40 }}>Enchanted Arrows</h2>
      <p style={{ color: "#9ca3af", marginBottom: 16 }}>
        Available to Wood Elf units and characters with Asrai Longbow. Glade Riders &amp; infantry use per-model pricing; characters &amp; other units pay a flat cost.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <h4 style={{ color: "#9ca3af", fontSize: 12, marginBottom: 8, fontFamily: "'Segoe UI', sans-serif", letterSpacing: 1 }}>INFANTRY / GLADE RIDERS</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {ENCHANTED_ARROWS.map((arrow) => (
              <span key={arrow.name} style={{
                fontSize: 12, padding: "3px 8px", borderRadius: 4,
                background: "#422006", border: "1px solid #92400e", color: "#fbbf24",
              }}>
                🏹 {arrow.name} <span style={{ color: "#fde68a" }}>{arrow.ptsPerModel}pts/model</span>
              </span>
            ))}
          </div>
        </div>
        <div>
          <h4 style={{ color: "#9ca3af", fontSize: 12, marginBottom: 8, fontFamily: "'Segoe UI', sans-serif", letterSpacing: 1 }}>CHARACTERS / OTHER</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {ENCHANTED_ARROWS.map((arrow) => (
              <span key={arrow.name} style={{
                fontSize: 12, padding: "3px 8px", borderRadius: 4,
                background: "#422006", border: "1px solid #92400e", color: "#fbbf24",
              }}>
                🏹 {arrow.name} <span style={{ color: "#fde68a" }}>{arrow.ptsFlat}pts flat</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RULES VIEW
// ═══════════════════════════════════════════════════════════════

function RulesView({ houseRules, customRules, saveCustomRules, faction, notify }) {
  const [newFaction, setNewFaction] = useState("General");
  const [newRule, setNewRule] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingIdx, setEditingIdx] = useState(null); // index in customRules
  const [editText, setEditText] = useState("");
  const [editFaction, setEditFaction] = useState("General");

  const addRule = () => {
    if (!newRule.trim()) return;
    saveCustomRules([...customRules, { faction: newFaction, rule: newRule.trim(), isCustom: true }]);
    setNewRule("");
    notify("House rule added!");
  };

  const removeCustomRule = (idx) => {
    if (editingIdx === idx) setEditingIdx(null);
    saveCustomRules(customRules.filter((_, i) => i !== idx));
    notify("House rule removed.");
  };

  const startEdit = (idx) => {
    setEditingIdx(idx);
    setEditText(customRules[idx].rule);
    setEditFaction(customRules[idx].faction);
  };

  const saveEdit = () => {
    if (!editText.trim()) return;
    const updated = customRules.map((r, i) =>
      i === editingIdx ? { ...r, rule: editText.trim(), faction: editFaction } : r
    );
    saveCustomRules(updated);
    setEditingIdx(null);
    notify("House rule updated!");
  };

  return (
    <div style={styles.rulesContainer}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={styles.sectionTitle}>Campaign House Rules & Errata</h2>
        <button
          style={{ ...styles.btn, background: faction?.color || "#4c1d95" }}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "Close" : "+ Add House Rule"}
        </button>
      </div>

      {/* Add rule form */}
      {showForm && (
        <div style={{ background: "#12121f", border: "1px solid #2d2d44", borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 10, alignItems: "flex-end" }}>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Scope</label>
              <select style={styles.input} value={newFaction} onChange={(e) => setNewFaction(e.target.value)}>
                <option>General</option>
                <option>Eonir</option>
                <option>Tomb Kings</option>
                <option>Lizardmen</option>
                <option>Border Princes</option>
                <option>Custom</option>
              </select>
            </div>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Rule</label>
              <input
                style={styles.input}
                value={newRule}
                onChange={(e) => setNewRule(e.target.value)}
                placeholder="Describe the house rule..."
                onKeyDown={(e) => e.key === "Enter" && addRule()}
              />
            </div>
            <button style={{ ...styles.btn, background: faction?.color || "#4c1d95", height: 36 }} onClick={addRule} disabled={!newRule.trim()}>
              Add
            </button>
          </div>
        </div>
      )}

      <div style={styles.rulesGrid}>
        {houseRules.map((r, i) => {
          // Find if this is a custom rule (exists in customRules)
          const customIdx = customRules.findIndex(cr => cr.faction === r.faction && cr.rule === r.rule);
          const isCustom = customIdx >= 0;
          return (
            <div key={i} style={{ ...styles.ruleCard, ...(isCustom ? { borderColor: "#4c1d95" } : {}) }}>
              {isCustom && editingIdx === customIdx ? (
                /* Inline edit form */
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8 }}>
                    <select style={styles.input} value={editFaction} onChange={e => setEditFaction(e.target.value)}>
                      <option>General</option>
                      <option>Eonir</option>
                      <option>Tomb Kings</option>
                      <option>Lizardmen</option>
                      <option>Border Princes</option>
                      <option>Custom</option>
                    </select>
                    <input
                      style={styles.input}
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && saveEdit()}
                      autoFocus
                    />
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={{ ...styles.btn, background: faction?.color || "#4c1d95", padding: "4px 12px", fontSize: 12 }} onClick={saveEdit}>Save</button>
                    <button style={{ ...styles.btn, background: "#374151", padding: "4px 12px", fontSize: 12 }} onClick={() => setEditingIdx(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <span style={styles.ruleFaction}>{r.faction}</span>
                      {isCustom && <span style={{ ...styles.houseRuleBadge, marginLeft: 6 }}>CUSTOM</span>}
                    </div>
                    {isCustom && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          style={{ ...styles.removeBtn, background: "#1e3a5f", color: "#93c5fd", fontSize: 11, padding: "2px 7px" }}
                          onClick={() => startEdit(customIdx)}
                        >✎</button>
                        <button style={styles.removeBtn} onClick={() => removeCustomRule(customIdx)}>✕</button>
                      </div>
                    )}
                  </div>
                  <p style={{ color: "#d1d5db", margin: 0, marginTop: 8 }}>{r.rule}</p>
                </>
              )}
            </div>
          );
        })}
        {houseRules.length === 0 && (
          <p style={{ color: "#6b7280", padding: 16 }}>No house rules yet. Add some above!</p>
        )}
      </div>
      <div style={{ marginTop: 32 }}>
        <h3 style={{ ...styles.sectionTitle, fontSize: 16 }}>Campaign Systems</h3>
        <div style={styles.systemsGrid}>
          <div style={styles.systemCard}>
            <h4 style={{ color: "#fbbf24", margin: "0 0 8px 0" }}>Trait Progression</h4>
            <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>
              183 total traits (80 universal + faction-specific). Units: max 2 traits. Characters: max 4 traits.
              Earn through battles and campaign objectives.
            </p>
          </div>
          <div style={styles.systemCard}>
            <h4 style={{ color: "#fbbf24", margin: "0 0 8px 0" }}>Character Relics</h4>
            <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>
              Each character has one unique relic with basic and upgraded forms. Upgrade unlocked via quest achievement.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS VIEW (Google Drive, etc.)
// ═══════════════════════════════════════════════════════════════

function SettingsView({ onRefreshData, notify, armyLists, onRestoreBackup }) {
  const fileInputRef = useRef(null);

  // ── Google Drive custom-data config (existing read-only feature) ──
  const saved = getGoogleDriveConfig();
  const [indexFileId, setIndexFileId] = useState(saved?.indexFileId ?? "");
  const [fileIds, setFileIds] = useState({
    units: saved?.fileIds?.units ?? "",
    items: saved?.fileIds?.items ?? "",
    rules: saved?.fileIds?.rules ?? "",
    lore:  saved?.fileIds?.lore  ?? "",
  });
  const [gdSaving, setGdSaving] = useState(false);
  const [gdLoading, setGdLoading] = useState(false);

  // ── Backup state ──
  const [snapshot,       setSnapshot]      = useState(() => readSnapshot());
  const [driveClientId,  setDriveClientIdS] = useState(() => getDriveClientId());
  const [driveConnected, setDriveConnected] = useState(() => !!getDriveToken());
  const [driveWorking,   setDriveWorking]   = useState(false);
  const [driveLastSaved, setDriveLastSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tow-backup-drive-last") || "null"); } catch { return null; }
  });
  const [autoSync, setAutoSync] = useState(() => localStorage.getItem("tow-backup-auto") === "1");

  // Refresh snapshot badge whenever armyLists changes
  useEffect(() => { setSnapshot(readSnapshot()); }, [armyLists]);

  // Auto-sync to Drive (debounced 2s after last change)
  useEffect(() => {
    if (!autoSync || !getDriveToken() || !armyLists) return;
    const timer = setTimeout(async () => {
      try {
        await saveToDrive(armyLists);
        const now = Date.now();
        localStorage.setItem("tow-backup-drive-last", JSON.stringify(now));
        setDriveLastSaved(now);
      } catch (e) { console.warn("[Backup] Auto-sync failed:", e.message); }
    }, 2000);
    return () => clearTimeout(timer);
  }, [armyLists, autoSync]);

  // ── Google Drive custom-data handlers ──
  const handleGdSave = async () => {
    setGdSaving(true);
    try {
      const config = {};
      if (indexFileId.trim()) config.indexFileId = indexFileId.trim();
      const ids = {};
      if (fileIds.units.trim()) ids.units = fileIds.units.trim();
      if (fileIds.items.trim()) ids.items = fileIds.items.trim();
      if (fileIds.rules.trim()) ids.rules = fileIds.rules.trim();
      if (fileIds.lore.trim())  ids.lore  = fileIds.lore.trim();
      if (Object.keys(ids).length > 0) config.fileIds = ids;
      if (Object.keys(config).length === 0) {
        setGoogleDriveConfig(null); clearGoogleDriveCache(); notify("Google Drive disabled.");
      } else { setGoogleDriveConfig(config); notify("Saved. Load custom data to apply."); }
      onRefreshData?.();
    } catch (e) { notify("Save failed: " + (e?.message || "Unknown error")); }
    finally { setGdSaving(false); }
  };

  const handleGdLoadNow = async () => {
    setGdLoading(true);
    try { clearGoogleDriveCache(); onRefreshData?.(); notify("Custom data reloaded."); }
    catch (e) { notify("Reload failed: " + (e?.message || "Unknown error")); }
    finally { setGdLoading(false); }
  };

  // ── Backup handlers ──
  const handleDownload = () => { downloadBackup(armyLists); notify("💾 Backup file downloaded!"); };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const restored = await parseBackupFile(file);
      const listCount = Object.keys(restored.lists || {}).length;
      if (!window.confirm(
        `Restore backup from ${restored.exportedAt?.slice(0,10) || "unknown date"}?\n` +
        `This will replace your current ${listCount} list(s). This cannot be undone.`
      )) return;
      onRestoreBackup(restored);
    } catch (e) { notify("❌ Import failed: " + e.message); }
  };

  const handleRestoreSnapshot = () => {
    if (!snapshot) return;
    const listCount = Object.keys(snapshot.lists || {}).length;
    if (!window.confirm(
      `Restore auto-snapshot from ${formatAge(snapshot.at)}?\n` +
      `Contains ${listCount} list(s). Current data will be replaced.`
    )) return;
    onRestoreBackup(snapshot);
  };

  const handleDriveConnect = async () => {
    setDriveWorking(true);
    try {
      if (driveClientId !== getDriveClientId()) setDriveClientId(driveClientId);
      await saveToDrive(armyLists);
      const now = Date.now();
      localStorage.setItem("tow-backup-drive-last", JSON.stringify(now));
      setDriveLastSaved(now);
      setDriveConnected(true);
      notify("✅ Connected! Backup saved to Google Drive.");
    } catch (e) {
      notify("❌ Drive error: " + e.message);
      if (e.message.includes("Auth") || e.message.includes("Client ID")) setDriveConnected(false);
    } finally { setDriveWorking(false); }
  };

  const handleDriveLoad = async () => {
    setDriveWorking(true);
    try {
      const data = await loadFromDrive();
      const listCount = Object.keys(data.lists || {}).length;
      if (!window.confirm(
        `Restore Drive backup from ${data.exportedAt?.slice(0,10) || "unknown date"}?\n` +
        `Contains ${listCount} list(s). Current data will be replaced.`
      )) { setDriveWorking(false); return; }
      onRestoreBackup(data);
    } catch (e) { notify("❌ Drive load failed: " + e.message); }
    finally { setDriveWorking(false); }
  };

  const handleDriveDisconnect = () => {
    clearDriveToken();
    setDriveConnected(false);
    setAutoSync(false);
    localStorage.removeItem("tow-backup-auto");
    notify("Disconnected from Google Drive.");
  };

  const toggleAutoSync = (on) => {
    setAutoSync(on);
    localStorage.setItem("tow-backup-auto", on ? "1" : "0");
    if (on && !getDriveToken()) notify("Connect to Google Drive first to enable auto-sync.");
  };

  const s = styles;
  const btnC = (color) => ({ ...s.btn, background: color, fontSize: 13 });

  return (
    <div style={s.settingsContainer}>
      <h2 style={s.sectionTitle}>Settings</h2>

      {/* BACKUP & RESTORE */}
      <section style={{ ...s.settingsSection, border: "1px solid #2d5a2744", borderRadius: 8, padding: 20, background: "#0d1a0d" }}>
        <h3 style={{ color: "#4ade80", marginBottom: 4, fontSize: 16 }}>💾 Backup & Restore</h3>
        <p style={{ color: "#6b7280", fontSize: 12, marginBottom: 16, marginTop: 0 }}>
          Your army lists live in your browser. Use any layer below to protect them.
        </p>

        {/* Layer 1 – Auto-snapshot */}
        <div style={{ background: "#111", borderRadius: 6, padding: 12, marginBottom: 12, border: "1px solid #1f2937" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div>
              <span style={{ color: "#e5e7eb", fontSize: 13, fontWeight: 600 }}>🔄 Auto-snapshot</span>
              <span style={{ color: "#4ade80", fontSize: 11, marginLeft: 8, background: "#14532d", padding: "1px 6px", borderRadius: 10 }}>ALWAYS ON</span>
            </div>
            <span style={{ color: snapshot ? "#9ca3af" : "#4b5563", fontSize: 12 }}>
              {snapshot ? `Last: ${formatAge(snapshot.at)}` : "No snapshot yet"}
            </span>
          </div>
          <p style={{ color: "#6b7280", fontSize: 12, margin: "0 0 10px 0" }}>
            A snapshot is written to your browser on every save. Zero setup required. Use this to recover from accidental changes.
          </p>
          <button
            style={{ ...btnC("#374151"), opacity: snapshot ? 1 : 0.4 }}
            onClick={handleRestoreSnapshot}
            disabled={!snapshot}
          >
            ↩ Restore Auto-snapshot
          </button>
        </div>

        {/* Layer 2 – File export/import */}
        <div style={{ background: "#111", borderRadius: 6, padding: 12, marginBottom: 12, border: "1px solid #1f2937" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ color: "#e5e7eb", fontSize: 13, fontWeight: 600 }}>📁 File Backup</span>
            <span style={{ color: "#6b7280", fontSize: 12 }}>Manual — saves a .json file</span>
          </div>
          <p style={{ color: "#6b7280", fontSize: 12, margin: "0 0 10px 0" }}>
            Download a complete backup of all lists, custom units, and house rules. Email it to yourself or drop it anywhere safe.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btnC("#2563eb")} onClick={handleDownload}>⬇ Download Backup</button>
            <button style={btnC("#374151")} onClick={() => fileInputRef.current?.click()}>⬆ Restore from File</button>
            <input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImportFile} />
          </div>
        </div>

        {/* Layer 3 – Google Drive OAuth auto-sync */}
        <div style={{ background: "#111", borderRadius: 6, padding: 12, border: "1px solid #1f2937" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ color: "#e5e7eb", fontSize: 13, fontWeight: 600 }}>☁ Google Drive Auto-sync</span>
            {driveConnected
              ? <span style={{ color: "#4ade80", fontSize: 12 }}>● Connected{driveLastSaved ? ` · saved ${formatAge(driveLastSaved)}` : ""}</span>
              : <span style={{ color: "#6b7280", fontSize: 12 }}>○ Not connected</span>
            }
          </div>
          <p style={{ color: "#6b7280", fontSize: 12, margin: "0 0 10px 0" }}>
            Saves your backup silently to your own Google Drive (private appdata folder — invisible in the Drive UI).
            Requires a free Google Cloud project with Drive API enabled.{" "}
            <a href="https://developers.google.com/drive/api/quickstart/js" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa" }}>
              Setup guide ↗
            </a>
          </p>

          {!driveConnected ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={s.formField}>
                <label style={s.formLabel}>Google OAuth2 Client ID</label>
                <input
                  style={s.input}
                  placeholder="xxxx.apps.googleusercontent.com"
                  value={driveClientId}
                  onChange={(e) => setDriveClientIdS(e.target.value)}
                />
                <span style={{ color: "#4b5563", fontSize: 11, marginTop: 3, display: "block" }}>
                  Google Cloud Console → APIs & Services → Credentials.
                  Set Authorized redirect URI to: <code>{window.location.origin}/oauth2callback</code>
                </span>
              </div>
              <button
                style={{ ...btnC("#15803d"), width: "fit-content", opacity: driveClientId.trim() ? 1 : 0.5 }}
                onClick={handleDriveConnect}
                disabled={driveWorking || !driveClientId.trim()}
              >
                {driveWorking ? "Connecting…" : "🔑 Connect & Save Now"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={autoSync} onChange={(e) => toggleAutoSync(e.target.checked)} />
                <span style={{ color: "#e5e7eb", fontSize: 13 }}>Auto-sync on every save</span>
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={btnC("#2563eb")}  onClick={handleDriveConnect} disabled={driveWorking}>{driveWorking ? "Saving…" : "☁ Save to Drive Now"}</button>
                <button style={btnC("#374151")}  onClick={handleDriveLoad}    disabled={driveWorking}>{driveWorking ? "Loading…" : "⬇ Restore from Drive"}</button>
                <button style={btnC("#7f1d1d")}  onClick={handleDriveDisconnect}>Disconnect</button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* VERIFY UNIT DATA */}
      <section style={s.settingsSection}>
        <h3 style={{ color: "#fbbf24", marginBottom: 8 }}>Verify unit data (New Recruit)</h3>
        <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
          New Recruit (newrecruit.eu) uses the same catalogue data (BSData on GitHub). Compare points and rules there.
        </p>
        <a href={getNewRecruitWikiUrl()} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#60a5fa", textDecoration: "none" }}>
          Open New Recruit wiki ↗
        </a>
      </section>

      {/* DATASET JSON */}
      <section style={s.settingsSection}>
        <h3 style={{ color: "#fbbf24", marginBottom: 8 }}>Dataset JSON (recommended)</h3>
        <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
          Use unit data from <code>public/data/datasets/</code>.{" "}
          <strong>Elf</strong> rosters → <strong>Eonir</strong>.{" "}
          <strong>Renegade Crowns / Empire / Bretonnia</strong> → <strong>Border Princes</strong>.{" "}
          <strong>Tomb Kings</strong> → <strong>Tomb Kings</strong>.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isDatasetEnabled()}
            onChange={(e) => {
              setDatasetEnabled(e.target.checked);
              if (!e.target.checked) clearDatasetCache();
              onRefreshData?.();
              notify(e.target.checked ? "Dataset JSON enabled." : "Using catalogue or local data.");
            }}
          />
          <span style={{ color: "#e5e7eb" }}>Use dataset JSON files for Eonir, Border Princes, Tomb Kings</span>
        </label>
      </section>

      {/* BSDATA */}
      <section style={s.settingsSection}>
        <h3 style={{ color: "#fbbf24", marginBottom: 8 }}>TOW catalogues (BSData)</h3>
        <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
          Load from{" "}
          <a href="https://github.com/vflam/Warhammer-The-Old-World" target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa" }}>
            vflam/Warhammer-The-Old-World
          </a>. Ignored when dataset JSON is on.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isBsdataEnabled()}
            onChange={(e) => {
              setBsdataEnabled(e.target.checked);
              if (!e.target.checked) clearBsdataCache();
              onRefreshData?.();
              notify(e.target.checked ? "TOW catalogue enabled." : "Using dataset or local data.");
            }}
          />
          <span style={{ color: "#e5e7eb" }}>Use TOW catalogues for all factions</span>
        </label>
      </section>

      {/* GOOGLE DRIVE CUSTOM DATA (read-only, existing feature) */}
      <section style={s.settingsSection}>
        <h3 style={{ color: "#fbbf24", marginBottom: 8 }}>Google Drive – Custom Unit Data</h3>
        <p style={{ color: "#9ca3af", fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
          Load custom units, items, and rules from a shared Drive folder (read-only). Share files as{" "}
          <strong>Anyone with link can view</strong>, then paste file IDs below.
        </p>
        <div style={s.formField}>
          <label style={s.formLabel}>Index file ID (recommended)</label>
          <input
            style={s.input}
            placeholder="e.g. 1abc123xyz..."
            value={indexFileId}
            onChange={(e) => setIndexFileId(e.target.value)}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          {["units","items","rules","lore"].map(k => (
            <div key={k} style={s.formField}>
              <label style={s.formLabel}>{k.charAt(0).toUpperCase()+k.slice(1)}</label>
              <input style={s.input} placeholder="File ID" value={fileIds[k]} onChange={(e) => setFileIds({ ...fileIds, [k]: e.target.value })} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button style={{ ...s.btn, background: "#2563eb" }} onClick={handleGdSave} disabled={gdSaving}>{gdSaving ? "Saving…" : "Save"}</button>
          <button style={{ ...s.btn, background: "#374151" }} onClick={handleGdLoadNow} disabled={gdLoading}>{gdLoading ? "Loading…" : "Reload Custom Data"}</button>
        </div>
      </section>
    </div>
  );
}


// CUSTOM GAME CONFIG (Import/Export + Quick Apply)
// ═══════════════════════════════════════════════════════════════

function CustomGameConfig({ unitOverrides, saveOverrides, customUnitsDB, saveCustomUnits, customRules, saveCustomRules, allUnits, activeFaction, faction, notify, setView, setSelectedUnit, setEditingOverrideUnitId }) {
  const [expanded, setExpanded] = useState(false);
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [quickSearch, setQuickSearch] = useState("");
  const [quickUnit, setQuickUnit] = useState(null);
  const [quickForm, setQuickForm] = useState({ houseRuleNote: "", addSpecialRules: "" });

  // Export current game config as JSON
  const exportConfig = () => {
    const config = {
      _format: "tow-army-builder-game-config",
      _version: 1,
      _faction: activeFaction,
      _exportedAt: new Date().toISOString(),
      unitOverrides: unitOverrides || {},
      customUnits: customUnitsDB || {},
      customRules: customRules || [],
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `game-config-${activeFaction}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify("Game config exported!");
  };

  // Import game config from JSON
  const importConfig = () => {
    try {
      const config = JSON.parse(importText);
      let imported = 0;

      if (config.unitOverrides && typeof config.unitOverrides === "object") {
        const merged = { ...unitOverrides, ...config.unitOverrides };
        saveOverrides(merged);
        imported += Object.keys(config.unitOverrides).length;
      }
      if (config.customUnits && typeof config.customUnits === "object") {
        const merged = { ...customUnitsDB };
        for (const [fid, units] of Object.entries(config.customUnits)) {
          if (Array.isArray(units)) {
            merged[fid] = [...(merged[fid] || []), ...units];
          }
        }
        saveCustomUnits(merged);
      }
      if (Array.isArray(config.customRules)) {
        saveCustomRules([...customRules, ...config.customRules]);
      }

      notify(`Imported ${imported} unit override(s)!`);
      setImportText("");
      setShowImport(false);
    } catch (e) {
      notify("Import failed: invalid JSON");
    }
  };

  // Quick-apply override to a unit
  const quickApply = () => {
    if (!quickUnit) return;
    const existing = unitOverrides[quickUnit.id] || {};
    const newRules = quickForm.addSpecialRules.split("\n").filter(s => s.trim());
    const updated = {
      ...existing,
      houseRuleNote: quickForm.houseRuleNote || existing.houseRuleNote,
    };
    // Merge new rules with existing
    if (newRules.length || existing.addSpecialRules?.length) {
      updated.addSpecialRules = [...(existing.addSpecialRules || []), ...newRules].filter(Boolean);
    }
    // Clean empty
    if (!updated.houseRuleNote) delete updated.houseRuleNote;
    if (!updated.addSpecialRules?.length) delete updated.addSpecialRules;

    const isEmpty = !updated.houseRuleNote && !updated.addSpecialRules?.length
      && !updated.ptsOverride && !updated.statOverrides;
    const allOv = { ...unitOverrides };
    if (isEmpty) {
      delete allOv[quickUnit.id];
    } else {
      allOv[quickUnit.id] = updated;
    }
    saveOverrides(allOv);
    notify(`Override applied to ${quickUnit.name}`);
    setQuickUnit(null);
    setQuickForm({ houseRuleNote: "", addSpecialRules: "" });
    setQuickSearch("");
  };

  const filteredUnits = quickSearch.length >= 2
    ? allUnits.filter(u => u.name.toLowerCase().includes(quickSearch.toLowerCase())).slice(0, 8)
    : [];

  const overrideCount = Object.keys(unitOverrides || {}).length;
  const customUnitCount = (customUnitsDB[activeFaction] || []).length;
  const ruleCount = (customRules || []).length;

  return (
    <div style={{ marginTop: 32 }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}
      >
        <h3 style={{ color: "#f59e0b", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ transform: expanded ? "rotate(90deg)" : "rotate(0)", display: "inline-block", transition: "transform 0.15s" }}>▸</span>
          🎲 Custom Game Config
        </h3>
        <span style={{ color: "#6b7280", fontSize: 12 }}>
          {overrideCount} override{overrideCount !== 1 ? "s" : ""} · {customUnitCount} custom unit{customUnitCount !== 1 ? "s" : ""} · {ruleCount} rule{ruleCount !== 1 ? "s" : ""}
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: "#6b7280", fontSize: 12, margin: "0 0 12px" }}>
            Manage your house rules, unit changes, and custom units. Changes layer on top of the base data — anything you don't modify stays the same.
          </p>

          {/* Export / Import buttons */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <button style={{ ...styles.btn, background: "#1e3a5f" }} onClick={exportConfig}>
              ↓ Export Game Config
            </button>
            <button style={{ ...styles.btn, background: "#1e3a5f" }} onClick={() => setShowImport(!showImport)}>
              ↑ Import Game Config
            </button>
            {overrideCount > 0 && (
              <button
                style={{ ...styles.btn, background: "#7f1d1d", fontSize: 11 }}
                onClick={() => {
                  if (confirm("Clear ALL unit overrides? This cannot be undone.")) {
                    saveOverrides({});
                    notify("All overrides cleared");
                  }
                }}
              >
                Clear All Overrides
              </button>
            )}
          </div>

          {/* Import panel */}
          {showImport && (
            <div style={{ padding: 12, background: "#1a1528", borderRadius: 8, border: "1px solid #4c1d95", marginBottom: 16 }}>
              <label style={styles.formLabel}>Paste game config JSON:</label>
              <textarea
                style={{ ...styles.input, height: 120, resize: "vertical", fontFamily: "monospace", fontSize: 11 }}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='{"unitOverrides": {...}, "customUnits": {...}, "customRules": [...]}'
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button style={{ ...styles.btn, background: "#4c1d95" }} onClick={importConfig} disabled={!importText.trim()}>
                  Import
                </button>
                <button style={{ ...styles.btn, background: "#374151" }} onClick={() => { setShowImport(false); setImportText(""); }}>
                  Cancel
                </button>
              </div>
              <div style={{ color: "#6b7280", fontSize: 11, marginTop: 8 }}>
                Imports merge with existing config. Duplicate overrides for the same unit will use the imported version. Share this JSON with your group so everyone has the same house rules.
              </div>
            </div>
          )}

          {/* Quick-Apply Override */}
          <div style={{ padding: 12, background: "#0f0f1a", borderRadius: 8, border: "1px solid #2d2d44", marginBottom: 16 }}>
            <h4 style={{ color: "#e5e7eb", margin: "0 0 8px", fontSize: 13 }}>⚡ Quick Apply Override</h4>
            <p style={{ color: "#6b7280", fontSize: 11, margin: "0 0 8px" }}>
              Quickly add a house rule note or special rule to any unit. For full override editing (stats, points, equipment), use the ✎ House Rule button in the Unit Database tab.
            </p>
            <input
              style={styles.input}
              placeholder="Search for a unit..."
              value={quickSearch}
              onChange={(e) => { setQuickSearch(e.target.value); setQuickUnit(null); }}
            />
            {filteredUnits.length > 0 && !quickUnit && (
              <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid #2d2d44", borderRadius: 4, marginTop: 4 }}>
                {filteredUnits.map(u => (
                  <div
                    key={u.id}
                    style={{ padding: "6px 10px", cursor: "pointer", color: "#d1d5db", fontSize: 12, borderBottom: "1px solid #1f1f33" }}
                    onClick={() => {
                      setQuickUnit(u);
                      setQuickSearch(u.name);
                      const existing = unitOverrides[u.id] || {};
                      setQuickForm({
                        houseRuleNote: existing.houseRuleNote || "",
                        addSpecialRules: (existing.addSpecialRules || []).join("\n"),
                      });
                    }}
                    onMouseEnter={(e) => e.target.style.background = "#1a1a2e"}
                    onMouseLeave={(e) => e.target.style.background = "transparent"}
                  >
                    {u.name}
                    <span style={{ color: "#6b7280", marginLeft: 8, fontSize: 10 }}>{u.category}</span>
                    {u._hasOverride && <span style={{ color: "#f59e0b", marginLeft: 4, fontSize: 10 }}>⚑</span>}
                  </div>
                ))}
              </div>
            )}
            {quickUnit && (
              <div style={{ marginTop: 8 }}>
                <div style={{ color: faction.accent, fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                  {quickUnit.name}
                  {quickUnit._hasOverride && <span style={{ color: "#f59e0b", fontSize: 10, marginLeft: 6 }}>already has overrides</span>}
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>House Rule Note</label>
                  <input
                    style={styles.input}
                    value={quickForm.houseRuleNote}
                    onChange={(e) => setQuickForm({ ...quickForm, houseRuleNote: e.target.value })}
                    placeholder="e.g. +1 to wound when stationary"
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Add Special Rules (one per line)</label>
                  <textarea
                    style={{ ...styles.input, height: 60, resize: "vertical" }}
                    value={quickForm.addSpecialRules}
                    onChange={(e) => setQuickForm({ ...quickForm, addSpecialRules: e.target.value })}
                    placeholder={"Stationary Precision: +1 to wound when the unit has not moved this turn"}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button style={{ ...styles.btn, background: faction.color }} onClick={quickApply}>
                    Apply Override
                  </button>
                  <button
                    style={{ ...styles.btn, background: "#374151", fontSize: 11 }}
                    onClick={() => {
                      setView("units");
                      setSelectedUnit(quickUnit);
                      setEditingOverrideUnitId(quickUnit.id);
                    }}
                  >
                    Full Editor →
                  </button>
                  <button
                    style={{ ...styles.btn, background: "#374151" }}
                    onClick={() => { setQuickUnit(null); setQuickSearch(""); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DATA MANAGEMENT VIEW
// ═══════════════════════════════════════════════════════════════

function DataView({ faction, activeFaction, allUnits, baseUnits, addCustomUnit, removeCustomUnit, showNewUnitForm, setShowNewUnitForm, unitOverrides, saveOverrides, customUnitsDB, saveCustomUnits, customRules, saveCustomRules, notify, setView, setSelectedUnit, setEditingOverrideUnitId }) {
  const [form, setForm] = useState({
    name: "", category: "Core", ptsPerModel: "", ptsCost: "",
    minSize: "5", maxSize: "20", troopType: "", base: "",
    isCharacter: false, equipment: "", specialRules: "", notes: "",
    profileName: "", M: "", WS: "", BS: "", S: "", T: "", W: "", I: "", A: "", Ld: "",
  });

  const handleSubmit = () => {
    const unit = {
      name: form.name,
      category: form.category,
      troopType: form.troopType || undefined,
      base: form.base || undefined,
      isCharacter: form.isCharacter,
      profiles: form.profileName ? [{
        name: form.profileName,
        M: form.M || "-", WS: form.WS || "-", BS: form.BS || "-",
        S: form.S || "-", T: form.T || "-", W: form.W || "-",
        I: form.I || "-", A: form.A || "-", Ld: form.Ld || "-",
      }] : [],
      equipment: form.equipment ? form.equipment.split("\n").filter(Boolean) : [],
      specialRules: form.specialRules ? form.specialRules.split("\n").filter(Boolean) : [],
      notes: form.notes,
    };
    if (form.isCharacter) {
      unit.ptsCost = parseInt(form.ptsCost) || 0;
    } else {
      unit.ptsPerModel = parseInt(form.ptsPerModel) || 0;
      unit.minSize = parseInt(form.minSize) || 1;
      unit.maxSize = parseInt(form.maxSize) || 20;
    }
    addCustomUnit(unit);
    setForm({
      name: "", category: "Core", ptsPerModel: "", ptsCost: "",
      minSize: "5", maxSize: "20", troopType: "", base: "",
      isCharacter: false, equipment: "", specialRules: "", notes: "",
      profileName: "", M: "", WS: "", BS: "", S: "", T: "", W: "", I: "", A: "", Ld: "",
    });
  };

  const userUnits = allUnits.filter((u) => !baseUnits[activeFaction]?.find((d) => d.id === u.id));

  return (
    <div style={styles.dataContainer}>
      <div style={styles.dataHeader}>
        <h2 style={styles.sectionTitle}>Manage Data</h2>
        <button
          style={{ ...styles.btn, background: faction.color }}
          onClick={() => setShowNewUnitForm(!showNewUnitForm)}
        >
          {showNewUnitForm ? "Close Form" : "+ Add Custom Unit"}
        </button>
      </div>

      {showNewUnitForm && (
        <div style={styles.newUnitForm}>
          <h3 style={{ color: faction.accent, marginTop: 0 }}>New Custom Unit</h3>
          <div style={styles.formGrid}>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Name</label>
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Category</label>
              <select style={styles.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {UNIT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={styles.formField}>
              <label style={styles.formLabel}>
                <input
                  type="checkbox"
                  checked={form.isCharacter}
                  onChange={(e) => setForm({ ...form, isCharacter: e.target.checked })}
                  style={{ marginRight: 6 }}
                />
                Is Character
              </label>
            </div>
            {form.isCharacter ? (
              <div style={styles.formField}>
                <label style={styles.formLabel}>Points Cost</label>
                <input style={styles.input} type="number" value={form.ptsCost} onChange={(e) => setForm({ ...form, ptsCost: e.target.value })} />
              </div>
            ) : (
              <>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Pts/Model</label>
                  <input style={styles.input} type="number" value={form.ptsPerModel} onChange={(e) => setForm({ ...form, ptsPerModel: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Min Size</label>
                  <input style={styles.input} type="number" value={form.minSize} onChange={(e) => setForm({ ...form, minSize: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Max Size</label>
                  <input style={styles.input} type="number" value={form.maxSize} onChange={(e) => setForm({ ...form, maxSize: e.target.value })} />
                </div>
              </>
            )}
            <div style={styles.formField}>
              <label style={styles.formLabel}>Troop Type</label>
              <input style={styles.input} value={form.troopType} onChange={(e) => setForm({ ...form, troopType: e.target.value })} placeholder="e.g. Monstrous Cavalry" />
            </div>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Base</label>
              <input style={styles.input} value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })} placeholder="e.g. 50x50mm" />
            </div>
          </div>

          <h4 style={{ color: "#9ca3af", marginBottom: 8 }}>Profile (optional)</h4>
          <div style={styles.profileGrid}>
            <div style={styles.formField}>
              <label style={styles.formLabel}>Name</label>
              <input style={styles.input} value={form.profileName} onChange={(e) => setForm({ ...form, profileName: e.target.value })} />
            </div>
            {["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"].map((stat) => (
              <div key={stat} style={styles.formField}>
                <label style={styles.formLabel}>{stat}</label>
                <input style={{ ...styles.input, width: 50, textAlign: "center" }} value={form[stat]} onChange={(e) => setForm({ ...form, [stat]: e.target.value })} />
              </div>
            ))}
          </div>

          <div style={styles.formField}>
            <label style={styles.formLabel}>Equipment (one per line)</label>
            <textarea style={{ ...styles.input, height: 60 }} value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} />
          </div>
          <div style={styles.formField}>
            <label style={styles.formLabel}>Special Rules (one per line)</label>
            <textarea style={{ ...styles.input, height: 60 }} value={form.specialRules} onChange={(e) => setForm({ ...form, specialRules: e.target.value })} />
          </div>
          <div style={styles.formField}>
            <label style={styles.formLabel}>Notes</label>
            <textarea style={{ ...styles.input, height: 40 }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <button
            style={{ ...styles.btn, background: faction.color, marginTop: 12 }}
            onClick={handleSubmit}
            disabled={!form.name.trim()}
          >
            Save Unit
          </button>
        </div>
      )}

      {/* User-added units */}
      {userUnits.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ color: "#9ca3af" }}>Your Custom Units</h3>
          {userUnits.map((u) => (
            <div key={u.id} style={styles.customUnitRow}>
              <div>
                <strong style={{ color: "#e5e7eb" }}>{u.name}</strong>
                <span style={{ color: "#6b7280", fontSize: 12, marginLeft: 8 }}>
                  {u.category} · {u.isCharacter ? `${u.ptsCost}pts` : `${u.ptsPerModel}pts/m`}
                </span>
              </div>
              <button style={styles.removeBtn} onClick={() => removeCustomUnit(u.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Unit Overrides (House Rules for specific units) */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{ color: "#c4b5fd" }}>⚑ Unit Overrides (House Rules)</h3>
        <p style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
          Modify any base unit without replacing it. Changes apply on top of the original data. Edit overrides from the Unit Database tab (✎ House Rule button).
        </p>
        {(() => {
          const overriddenUnits = allUnits.filter(u => u._hasOverride);
          if (overriddenUnits.length === 0) return (
            <p style={{ color: "#4b5563", fontSize: 12, fontStyle: "italic", marginTop: 8 }}>
              No unit overrides yet. Go to Unit Database, select a unit, and click "✎ House Rule" to add one.
            </p>
          );
          return overriddenUnits.map(u => (
            <div key={u.id} style={{ ...styles.customUnitRow, borderLeft: "3px solid #4c1d95" }}>
              <div>
                <strong style={{ color: "#e5e7eb" }}>{u.name}</strong>
                <span style={styles.houseRuleBadge}>⚑ OVERRIDE</span>
                {u._houseRuleNote && (
                  <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 2 }}>{u._houseRuleNote}</div>
                )}
                {u._overrideChanges?.length > 0 && (
                  <div style={{ color: "#6b7280", fontSize: 10, marginTop: 2 }}>
                    {u._overrideChanges.join(" · ")}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  style={{ ...styles.btn, background: "#4c1d95", fontSize: 11, padding: "4px 10px" }}
                  onClick={() => {
                    setView("units");
                    setSelectedUnit(u);
                    setEditingOverrideUnitId(u.id);
                  }}
                >
                  Edit
                </button>
                <button
                  style={styles.removeBtn}
                  onClick={() => {
                    const updated = { ...unitOverrides };
                    delete updated[u.id];
                    saveOverrides(updated);
                  }}
                >✕</button>
              </div>
            </div>
          ));
        })()}
      </div>

      {/* ═══ Custom Game Config (Import/Export) ═══ */}
      <CustomGameConfig
        unitOverrides={unitOverrides}
        saveOverrides={saveOverrides}
        customUnitsDB={customUnitsDB}
        saveCustomUnits={saveCustomUnits}
        customRules={customRules}
        saveCustomRules={saveCustomRules}
        allUnits={allUnits}
        activeFaction={activeFaction}
        faction={faction}
        notify={notify}
        setView={setView}
        setSelectedUnit={setSelectedUnit}
        setEditingOverrideUnitId={setEditingOverrideUnitId}
      />

      {/* Pre-loaded data summary */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{ color: "#9ca3af" }}>Pre-Loaded Data ({faction.name})</h3>
        <div style={{ color: "#6b7280", fontSize: 13 }}>
          {(baseUnits[activeFaction] || []).length} units loaded ({(baseUnits[activeFaction] || []).filter(u => u.isCustom).length} homebrew + {(baseUnits[activeFaction] || []).filter(u => !u.isCustom).length} from army book)
        </div>
        {(baseUnits[activeFaction] || []).map((u) => (
          <div key={u.id} style={{ ...styles.customUnitRow, opacity: 0.6 }}>
            <div>
              <strong style={{ color: "#9ca3af" }}>{u.name}</strong>
              <span style={{ color: "#6b7280", fontSize: 12, marginLeft: 8 }}>{u.category}</span>
            </div>
            <span style={styles.customBadge}>BUILT-IN</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const styles = {
  appContainer: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #0a0a0f 0%, #111118 50%, #0d0d14 100%)",
    color: "#d1d5db",
    fontFamily: "'Crimson Text', 'Georgia', serif",
  },
  loadingContainer: {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    height: "100vh", background: "#0a0a0f",
  },
  loadingSpinner: {
    width: 40, height: 40, border: "3px solid #1f2937",
    borderTop: "3px solid #fbbf24", borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  loadingText: { color: "#6b7280", marginTop: 16, fontStyle: "italic" },
  notification: {
    position: "fixed", top: 16, right: 16, zIndex: 1000,
    background: "#065f46", color: "#d1fae5", padding: "10px 20px",
    borderRadius: 8, fontSize: 14, boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
    animation: "fadeIn 0.3s ease",
  },

  // Header
  header: {
    background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
    borderBottom: "1px solid #2d2d44",
    padding: "16px 24px",
  },
  headerInner: { display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 1200, margin: "0 auto" },
  title: { margin: 0, fontSize: 26, color: "#fbbf24", letterSpacing: 1, fontWeight: 700 },
  subtitle: { margin: "2px 0 0", fontSize: 13, color: "#6b7280", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Segoe UI', sans-serif" },
  pointsBadge: { textAlign: "right" },
  pointsNumber: { fontSize: 28, fontWeight: 700, fontFamily: "monospace" },
  pointsSlash: { color: "#4b5563", fontSize: 18, margin: "0 4px" },
  pointsLimit: { color: "#6b7280", fontSize: 14, fontFamily: "monospace" },

  // Faction tabs
  factionBar: { display: "flex", gap: 6, padding: "10px 24px", background: "#0f0f1a", borderBottom: "1px solid #1f1f33", overflowX: "auto" },
  factionTab: {
    display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
    border: "1px solid #2d2d44", borderRadius: 6, background: "#1a1a2e",
    color: "#9ca3af", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap",
    transition: "all 0.2s", fontFamily: "'Segoe UI', sans-serif",
  },
  factionTabName: { fontWeight: 600 },

  // Nav
  nav: { display: "flex", gap: 2, padding: "0 24px", background: "#0f0f1a", borderBottom: "1px solid #1f1f33", overflowX: "auto" },
  navBtn: {
    padding: "10px 16px", background: "transparent", border: "none",
    borderBottom: "2px solid transparent", color: "#6b7280",
    cursor: "pointer", fontSize: 13, display: "flex", gap: 6, alignItems: "center",
    whiteSpace: "nowrap", transition: "all 0.2s", fontFamily: "'Segoe UI', sans-serif",
  },

  // Main
  main: { maxWidth: 1200, margin: "0 auto", padding: "20px 24px" },

  // Shared
  sectionTitle: { color: "#e5e7eb", fontSize: 18, marginTop: 0, fontWeight: 700 },
  btn: {
    padding: "6px 16px", border: "none", borderRadius: 6, color: "#fff",
    cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Segoe UI', sans-serif",
    transition: "opacity 0.2s",
  },
  input: {
    background: "#1a1a2e", border: "1px solid #2d2d44", borderRadius: 6,
    padding: "8px 12px", color: "#e5e7eb", fontSize: 13, width: "100%",
    outline: "none", fontFamily: "'Segoe UI', sans-serif", boxSizing: "border-box",
  },
  emptyState: { padding: 32, textAlign: "center" },
  deleteBtn: {
    background: "transparent", border: "none", color: "#6b7280",
    cursor: "pointer", fontSize: 14, padding: "2px 6px",
  },
  removeBtn: {
    background: "#7f1d1d44", border: "1px solid #7f1d1d", color: "#fca5a5",
    cursor: "pointer", fontSize: 12, padding: "2px 8px", borderRadius: 4,
  },
  customBadge: {
    display: "inline-block", fontSize: 10, padding: "1px 6px",
    background: "#92400e33", color: "#fbbf24", borderRadius: 3,
    marginLeft: 8, fontFamily: "'Segoe UI', sans-serif", letterSpacing: 1,
  },
  houseRuleBadge: {
    display: "inline-block", fontSize: 10, padding: "1px 6px",
    background: "#4c1d9533", color: "#c4b5fd", borderRadius: 3,
    marginLeft: 8, fontFamily: "'Segoe UI', sans-serif", letterSpacing: 1, fontWeight: 600,
  },

  // Roster
  rosterContainer: {},
  listSelector: { marginBottom: 24 },
  listSelectorHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  listGrid: { display: "flex", gap: 8, flexWrap: "wrap" },
  listCard: {
    padding: "10px 14px", background: "#1a1a2e", border: "1px solid #2d2d44",
    borderRadius: 8, cursor: "pointer", minWidth: 180, transition: "all 0.2s",
  },
  listCardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  listCardMeta: { color: "#6b7280", fontSize: 12, marginTop: 4, fontFamily: "'Segoe UI', sans-serif" },
  newListForm: { display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" },
  activeList: { marginTop: 8 },
  activeListHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  pointsBar: { height: 6, background: "#1f1f33", borderRadius: 3, overflow: "hidden", marginBottom: 20 },
  pointsFill: { height: "100%", borderRadius: 3, transition: "width 0.4s ease" },

  // Add unit panel
  addUnitPanel: { background: "#12121f", border: "1px solid #2d2d44", borderRadius: 8, padding: 16, marginBottom: 20 },
  addUnitFilters: { marginBottom: 12 },
  catFilters: { display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" },
  catBtn: {
    padding: "4px 10px", border: "1px solid #2d2d44", borderRadius: 4,
    background: "#1a1a2e", color: "#9ca3af", cursor: "pointer", fontSize: 12,
    fontFamily: "'Segoe UI', sans-serif",
  },
  addUnitGrid: { display: "flex", flexDirection: "column", gap: 4, maxHeight: 300, overflowY: "auto" },
  addUnitCard: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 12px", background: "#1a1a2e", borderRadius: 6, border: "1px solid #2d2d44",
  },
  unitMeta: { color: "#6b7280", fontSize: 12, marginTop: 2, fontFamily: "'Segoe UI', sans-serif" },

  // Category groups
  categoryGroup: { marginBottom: 20 },
  categoryTitle: {
    fontSize: 14, textTransform: "uppercase", letterSpacing: 2,
    marginBottom: 8, fontFamily: "'Segoe UI', sans-serif", fontWeight: 700,
  },

  // Entry card
  entryCard: { background: "#12121f", border: "1px solid #2d2d44", borderRadius: 8, marginBottom: 6, overflow: "hidden" },
  entryHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", cursor: "pointer" },
  entryLeft: { display: "flex", alignItems: "center", gap: 8 },
  entryRight: { display: "flex", alignItems: "center", gap: 12 },
  expandArrow: { color: "#6b7280", fontSize: 14, transition: "transform 0.2s", display: "inline-block" },
  modelCount: { color: "#9ca3af", fontSize: 14 },
  entryExpanded: { padding: "0 14px 14px", borderTop: "1px solid #1f1f33" },
  countAdjuster: { display: "flex", alignItems: "center", gap: 8, marginTop: 10 },
  adjBtn: {
    width: 28, height: 28, background: "#1f1f33", border: "1px solid #2d2d44",
    borderRadius: 4, color: "#e5e7eb", cursor: "pointer", fontSize: 16, display: "flex",
    alignItems: "center", justifyContent: "center",
  },
  relicToggle: { display: "flex", alignItems: "center", gap: 8, marginTop: 10 },
  relicBtn: {
    padding: "4px 12px", border: "1px solid #2d2d44", borderRadius: 4,
    background: "#1a1a2e", color: "#9ca3af", cursor: "pointer", fontSize: 12,
    fontFamily: "'Segoe UI', sans-serif",
  },

  // Stat table
  statBlock: { marginTop: 10, overflowX: "auto" },
  statTable: { width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "'Segoe UI', sans-serif" },
  statTh: { padding: "4px 8px", textAlign: "center", color: "#6b7280", borderBottom: "1px solid #2d2d44", fontSize: 11, fontWeight: 600 },
  statTd: { padding: "4px 8px", textAlign: "center", color: "#d1d5db", borderBottom: "1px solid #1f1f33" },

  // Rules block
  rulesBlock: { marginTop: 10 },
  ruleItem: { color: "#9ca3af", fontSize: 13, marginTop: 4, lineHeight: 1.5 },
  equipItem: { color: "#9ca3af", fontSize: 13, marginTop: 4 },
  notesInput: {
    width: "100%", marginTop: 10, background: "#0f0f1a", border: "1px solid #1f1f33",
    borderRadius: 4, padding: 8, color: "#9ca3af", fontSize: 12, resize: "vertical",
    height: 40, outline: "none", fontFamily: "'Segoe UI', sans-serif", boxSizing: "border-box",
  },

  // Units view
  unitsContainer: { display: "flex", gap: 20, minHeight: 500 },
  unitsSidebar: { width: 280, flexShrink: 0 },
  unitListItem: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 10px", background: "#12121f", border: "1px solid transparent",
    borderRadius: 6, cursor: "pointer", width: "100%", marginTop: 4,
    textAlign: "left", fontSize: 13,
  },
  unitsDetail: { flex: 1, minWidth: 0 },
  unitDetail: { background: "#12121f", border: "1px solid #2d2d44", borderRadius: 8, padding: 20 },
  unitDetailHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  detailSection: { marginTop: 20 },
  detailLabel: { color: "#9ca3af", fontSize: 12, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, fontFamily: "'Segoe UI', sans-serif" },
  relicFormBlock: {
    background: "#0f0f1a", border: "1px solid #2d2d44", borderRadius: 6,
    padding: 12, marginTop: 8,
  },

  // Items view
  itemsContainer: {},
  itemsGrid: { display: "flex", flexDirection: "column", gap: 12 },
  relicCard: { background: "#12121f", border: "1px solid #2d2d44", borderRadius: 8, padding: 16 },
  relicCardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },

  // Rules view
  rulesContainer: {},
  rulesGrid: { display: "flex", flexDirection: "column", gap: 8 },
  ruleCard: { background: "#12121f", border: "1px solid #2d2d44", borderRadius: 8, padding: 14 },
  ruleFaction: {
    fontSize: 11, padding: "2px 8px", background: "#1f1f33", borderRadius: 3,
    color: "#9ca3af", fontFamily: "'Segoe UI', sans-serif", letterSpacing: 1,
  },
  systemsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginTop: 12 },
  systemCard: { background: "#12121f", border: "1px solid #2d2d44", borderRadius: 8, padding: 14 },

  // Data view
  dataContainer: {},
  dataHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  settingsContainer: {},
  settingsSection: { background: "#12121f", border: "1px solid #2d2d44", borderRadius: 8, padding: 20, marginBottom: 24 },
  newUnitForm: { background: "#12121f", border: "1px solid #2d2d44", borderRadius: 8, padding: 20, marginBottom: 20 },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 16 },
  profileGrid: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-end" },
  formField: { display: "flex", flexDirection: "column", gap: 4 },
  formLabel: { color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'Segoe UI', sans-serif" },
  customUnitRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 12px", background: "#12121f", border: "1px solid #2d2d44",
    borderRadius: 6, marginTop: 6,
  },
};

// ═══════════════════════════════════════════════════════════════
// APP WRAPPER: loads data from dataService, then renders ArmyBuilder
// ═══════════════════════════════════════════════════════════════

export default function App() {
  const [data, setData] = useState(null);

  useEffect(() => {
    loadAllData()
      .then(setData)
      .catch((e) => {
        console.error("Failed to load data:", e);
        setData({
          factions: FALLBACK_FACTIONS,
          units: {},
          items: { weapons: [], armour: [], talismans: [], enchanted: [], arcane: [], banners: [] },
          rules: [],
        });
      });
  }, []);

  const refreshData = useCallback(() => {
    clearCache();
    loadAllData().then(setData);
  }, []);

  if (!data) {
    return (
      <div style={{
        display: "flex", justifyContent: "center", alignItems: "center",
        minHeight: "100vh", background: "#0f0f1a", color: "#9ca3af", fontFamily: "system-ui",
      }}>
        Loading…
      </div>
    );
  }

  return <ArmyBuilder data={data} onRefreshData={refreshData} />;
}
