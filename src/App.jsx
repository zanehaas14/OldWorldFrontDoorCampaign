import { useState, useEffect, useCallback, useRef } from "react";
import { loadAllData } from "./lib/dataService";

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
  "Characters",
  "Lords",
  "Heroes",
  "Core",
  "Special",
  "Rare",
  "Custom",
];


const STORAGE_KEY = "tow-campaign-army-lists";
const CUSTOM_UNITS_KEY = "tow-campaign-custom-units";

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

// Determine which magic item slots a character can access
function getAllowedSlots(unitDef) {
  if (!unitDef?.isCharacter) return [];
  // Named characters get no magic items
  if (unitDef.troopType?.includes("named")) return [];
  // If unit explicitly defines allowed slots, use those
  if (unitDef.allowedSlots) return unitDef.allowedSlots;
  // Auto-detect from unit characteristics
  const slots = [];
  const notes = (unitDef.notes || "").toLowerCase();
  const rules = (unitDef.specialRules || []).join(" ").toLowerCase();
  const isWizard = rules.includes("wizard") || notes.includes("wizard") || notes.includes("lore");
  const isTreeSpirit = rules.includes("tree spirit");
  const isBSBCapable = notes.includes("bsb") || notes.includes("battle standard");
  // Everyone who can take magic items gets weapons, talismans, enchanted
  slots.push("weapons", "talismans", "enchanted");
  // Armour: melee fighters get it, wizards and tree spirits generally don't
  if (!isWizard && !isTreeSpirit) {
    slots.push("armour");
  }
  // Arcane: wizards only
  if (isWizard) {
    slots.push("arcane");
  }
  // Banners: BSB capable only
  if (isBSBCapable) {
    slots.push("banners");
  }
  return slots;
}

function getMagicItemBudget(unitDef) {
  if (!unitDef?.isCharacter) return 0;
  if (unitDef.troopType?.includes("named")) return 0;
  const match = unitDef.notes?.match(/Magic Items?\s*\((\d+)\s*pts?\)/i);
  if (match) return parseInt(match[1]);
  if (unitDef.category === "Lords") return 100;
  if (unitDef.category === "Heroes") return 50;
  return 0;
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
  "Flammable": "A model with this rule suffers an additional -1 modifier to its armour save when wounded by a Flaming Attack, and must re-roll successful Ward saves against Flaming Attacks.",
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

function ArmyBuilder({ data }) {
  const { factions, units: baseUnits, items: magicItems, rules: houseRules } = data;
  const [activeFaction, setActiveFaction] = useState("eonir");
  const [armyLists, setArmyLists] = useState({});
  const [currentListId, setCurrentListId] = useState(null);
  const [customUnitsDB, setCustomUnitsDB] = useState({});
  const [view, setView] = useState("roster"); // roster | units | traits | items | rules | data
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [showNewUnitForm, setShowNewUnitForm] = useState(false);
  const [showNewListDialog, setShowNewListDialog] = useState(false);
  const [editingUnit, setEditingUnit] = useState(null);
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
    setLoading(false);
  }, []);

  // Save army lists
  const saveArmyLists = useCallback((lists) => {
    setArmyLists(lists);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
    } catch (e) { console.error("Save failed:", e); }
  }, []);

  // Save custom units
  const saveCustomUnits = useCallback((units) => {
    setCustomUnitsDB(units);
    try {
      localStorage.setItem(CUSTOM_UNITS_KEY, JSON.stringify(units));
    } catch (e) { console.error("Save failed:", e); }
  }, []);

  const notify = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2500);
  };

  const faction = factions[activeFaction];
  const allUnits = [
    ...(baseUnits[activeFaction] || []),
    ...(customUnitsDB[activeFaction] || []),
  ];

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
      activeUpgrades: [],
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
      // Calculate upgrade costs
      const upgradeDefs = unitDef.upgrades || [];
      const activeUpgrades = updated.activeUpgrades || [];
      const upgradeCost = upgradeDefs
        .filter(u => activeUpgrades.includes(u.id))
        .reduce((sum, u) => sum + (u.pts || 0), 0);
      if (unitDef.isCharacter) {
        updated.ptsCost = (unitDef.ptsCost || 0) + calcMagicItemsCost(updated.magicItems) + arrowCost + upgradeCost;
      } else {
        updated.ptsCost = ((unitDef.ptsPerModel || 0) * modelCount) + arrowCost + upgradeCost;
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
          { key: "roster", label: "Army Roster", icon: "📜" },
          { key: "units", label: "Unit Database", icon: "🗡" },
          { key: "items", label: "Items & Relics", icon: "✨" },
          { key: "rules", label: "House Rules", icon: "📖" },
          { key: "data", label: "Manage Data", icon: "⚙" },
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
          />
        )}
        {view === "units" && (
          <UnitsView
            allUnits={allUnits}
            faction={faction}
            selectedUnit={selectedUnit}
            setSelectedUnit={setSelectedUnit}
            addUnitToList={currentList ? addUnitToList : null}
          />
        )}
        {view === "items" && (
          <ItemsView allUnits={allUnits} faction={faction} magicItems={magicItems} />
        )}
        {view === "rules" && <RulesView houseRules={houseRules} />}
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
            <button
              style={{ ...styles.btn, background: faction.color }}
              onClick={() => setShowAddUnit(!showAddUnit)}
            >
              {showAddUnit ? "Close" : "+ Add Unit"}
            </button>
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
  const budget = getMagicItemBudget(unitDef);
  if (budget === 0) return null;

  const allowedSlots = getAllowedSlots(unitDef);
  if (allowedSlots.length === 0) return null;

  const equipped = entry.magicItems || {};
  const spent = calcMagicItemsCost(equipped);
  const remaining = budget - spent;

  const [openSlot, setOpenSlot] = useState(null);

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

      {Object.keys(magicItems).length > 0 && (
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

function UpgradesPanel({ entry, unitDef, faction, updateEntry }) {
  const upgrades = unitDef.upgrades || [];
  if (upgrades.length === 0) return null;

  const active = entry.activeUpgrades || [];
  const totalUpgradeCost = upgrades.filter(u => active.includes(u.id)).reduce((s, u) => s + (u.pts || 0), 0);

  const toggle = (upId) => {
    const next = active.includes(upId) ? active.filter(id => id !== upId) : [...active, upId];
    updateEntry(entry.entryId, { activeUpgrades: next });
  };

  // Group by type
  const commandUpgrades = upgrades.filter(u => u.type === "command");
  const equipUpgrades = upgrades.filter(u => u.type === "equipment");
  const specialUpgrades = upgrades.filter(u => u.type === "special");

  const renderUpgrade = (u) => {
    const isActive = active.includes(u.id);
    return (
      <button
        key={u.id}
        onClick={() => toggle(u.id)}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          padding: "5px 8px", background: isActive ? `${faction.color}22` : "transparent",
          border: `1px solid ${isActive ? faction.color + "66" : "#1f1f33"}`,
          borderRadius: 4, cursor: "pointer", textAlign: "left", transition: "all 0.15s",
        }}
      >
        <span style={{
          width: 16, height: 16, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center",
          border: `1.5px solid ${isActive ? faction.accent : "#4b5563"}`,
          background: isActive ? faction.color : "transparent", fontSize: 11, color: "#fff", flexShrink: 0,
        }}>
          {isActive ? "✓" : ""}
        </span>
        <span style={{ color: isActive ? "#e5e7eb" : "#9ca3af", fontSize: 12, flex: 1 }}>
          {u.name}
          {u.note && <span style={{ color: "#6b7280", fontSize: 10, marginLeft: 4 }}>({u.note})</span>}
        </span>
        {u.pts > 0 && (
          <span style={{ color: "#fbbf24", fontSize: 11, fontFamily: "monospace", flexShrink: 0 }}>+{u.pts}pts</span>
        )}
        {u.pts === 0 && (
          <span style={{ color: "#6b7280", fontSize: 10, fontFamily: "monospace", flexShrink: 0 }}>free</span>
        )}
      </button>
    );
  };

  return (
    <div style={{ margin: "8px 0", padding: 10, background: "#1a1a2e", borderRadius: 6, border: "1px solid #2d2d44" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "#d1d5db", fontSize: 13, fontWeight: 600 }}>⚙ Unit Upgrades</span>
        {totalUpgradeCost > 0 && (
          <span style={{ fontSize: 12, fontFamily: "monospace", padding: "2px 8px", borderRadius: 4, background: "#1f2937", color: "#fbbf24" }}>
            +{totalUpgradeCost} pts
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {commandUpgrades.length > 0 && (
          <>
            <div style={{ color: "#6b7280", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginTop: 2 }}>Command</div>
            {commandUpgrades.map(renderUpgrade)}
          </>
        )}
        {equipUpgrades.length > 0 && (
          <>
            <div style={{ color: "#6b7280", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginTop: 6 }}>Equipment</div>
            {equipUpgrades.map(renderUpgrade)}
          </>
        )}
        {specialUpgrades.length > 0 && (
          <>
            <div style={{ color: "#6b7280", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginTop: 6 }}>Special</div>
            {specialUpgrades.map(renderUpgrade)}
          </>
        )}
      </div>
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
            <strong style={{ color: "#e5e7eb" }}>{entry.unitName}</strong>
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
                {unitDef.upgrades.filter(u => entry.activeUpgrades.includes(u.id)).map(u => (
                  <span key={u.id} style={{
                    fontSize: 10, padding: "1px 5px", borderRadius: 3,
                    background: "#1e3a5f", border: "1px solid #2563eb44", color: "#93c5fd",
                  }}>
                    {u.name}{u.pts > 0 ? ` (+${u.pts})` : ""}
                  </span>
                ))}
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

          {/* Unit Upgrades */}
          {unitDef?.upgrades?.length > 0 && !entry.isCharacter && (
            <UpgradesPanel entry={entry} unitDef={unitDef} faction={faction} updateEntry={updateEntry} />
          )}

          {/* Magic Items */}
          {entry.isCharacter && (
            <MagicItemsPanel entry={entry} unitDef={unitDef} faction={faction} updateEntry={updateEntry} itemsCatalog={itemsCatalog} />
          )}

          {/* Enchanted Arrows */}
          {unitDef && canTakeEnchantedArrows(unitDef) && (
            <EnchantedArrowsPanel entry={entry} unitDef={unitDef} faction={faction} updateEntry={updateEntry} />
          )}

          {/* Stat block */}
          {unitDef?.profiles?.length > 0 && (
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
                  {unitDef.profiles.map((p, i) => (
                    <tr key={i}>
                      <td style={{ ...styles.statTd, color: faction.accent, textAlign: "left", fontWeight: 600, fontSize: 12 }}>
                        {p.name}
                      </td>
                      {["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"].map((s) => (
                        <td key={s} style={styles.statTd}>{p[s]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Special rules */}
          {unitDef?.specialRules?.length > 0 && (
            <div style={styles.rulesBlock}>
              {unitDef.specialRules.map((r, i) => (
                <div key={i} style={styles.ruleItem}>• {r}</div>
              ))}
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

function UnitsView({ allUnits, faction, selectedUnit, setSelectedUnit, addUnitToList }) {
  const [filter, setFilter] = useState("");

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
        <h2 style={styles.sectionTitle}>Unit Database</h2>
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
                }}
              >
                <span style={{ color: "#e5e7eb" }}>{u.name}</span>
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
          <UnitDetail unit={selectedUnit} faction={faction} addToList={addUnitToList} />
        ) : (
          <div style={styles.emptyState}>
            <p style={{ color: "#6b7280" }}>Select a unit to view its profile.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function UnitDetail({ unit, faction, addToList }) {
  const parsed = parseWeapons(unit.equipment);
  const { weapons, nonWeapons } = parsed.weapons !== undefined ? parsed : { weapons: [], nonWeapons: unit.equipment || [] };

  const tblStyle = { width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "'Segoe UI', sans-serif", marginBottom: 16 };
  const thStyle = { padding: "6px 10px", textAlign: "left", background: "#1a1a2e", color: "#e5e7eb", borderBottom: "2px solid #2d2d44", fontWeight: 700, fontSize: 12 };
  const tdStyle = { padding: "6px 10px", textAlign: "left", color: "#d1d5db", borderBottom: "1px solid #1f1f33" };
  const sectionGap = { marginTop: 20 };

  return (
    <div style={styles.unitDetail}>
      {/* Header */}
      <div style={styles.unitDetailHeader}>
        <div>
          <h2 style={{ color: faction.accent, margin: 0, fontSize: 22 }}>{unit.name}</h2>
          <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 4 }}>
            {unit.category}
            {unit.isCustom && <span style={styles.customBadge}>HOMEBREW</span>}
          </div>
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
          {addToList && (
            <button
              style={{ ...styles.btn, background: faction.color, marginTop: 8 }}
              onClick={() => addToList(unit)}
            >
              + Add to List
            </button>
          )}
        </div>
      </div>

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
                  {["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"].map((s) => (
                    <td key={s} style={{ ...tdStyle, textAlign: "center" }}>{p[s]}</td>
                  ))}
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
              return (
                <div key={i} style={{
                  padding: "8px 0",
                  borderBottom: i < unit.specialRules.length - 1 ? "1px solid #1f1f33" : "none",
                }}>
                  <span style={{ color: "#e5e7eb", fontWeight: 700, fontSize: 13 }}>{r.split(":")[0]}:</span>
                  <span style={{ color: "#9ca3af", fontSize: 13, marginLeft: 4 }}>
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
                <span style={{ color: "#d1d5db", fontSize: 13 }}>
                  <span style={{ color: "#6b7280", fontSize: 10, textTransform: "uppercase", marginRight: 6 }}>
                    {u.type}
                  </span>
                  {u.name}
                  {u.note && <span style={{ color: "#6b7280", fontSize: 11, marginLeft: 4 }}>({u.note})</span>}
                </span>
                <span style={{ color: u.pts > 0 ? "#fbbf24" : "#6b7280", fontSize: 12, fontFamily: "monospace" }}>
                  {u.pts > 0 ? `+${u.pts} pts` : "free"}
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

function RulesView({ houseRules }) {
  return (
    <div style={styles.rulesContainer}>
      <h2 style={styles.sectionTitle}>Campaign House Rules & Errata</h2>
      <div style={styles.rulesGrid}>
        {houseRules.map((r, i) => (
          <div key={i} style={styles.ruleCard}>
            <span style={styles.ruleFaction}>{r.faction}</span>
            <p style={{ color: "#d1d5db", margin: 0, marginTop: 8 }}>{r.rule}</p>
          </div>
        ))}
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
          <div style={styles.systemCard}>
            <h4 style={{ color: "#fbbf24", margin: "0 0 8px 0" }}>Attendance Flex</h4>
            <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>
              Absent players don't fall behind. Faction traits shared, off-screen advancement for missing sessions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DATA MANAGEMENT VIEW
// ═══════════════════════════════════════════════════════════════

function DataView({ faction, activeFaction, allUnits, baseUnits, addCustomUnit, removeCustomUnit, showNewUnitForm, setShowNewUnitForm }) {
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

      {/* Pre-loaded data summary */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{ color: "#9ca3af" }}>Pre-Loaded Data ({factions[activeFaction].name})</h3>
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

  return <ArmyBuilder data={data} />;
}
