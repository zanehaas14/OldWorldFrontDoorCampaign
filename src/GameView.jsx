import { useState, useEffect, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// RULE LOOKUP MODAL
// Fetches rule definitions from tow.whfb.app via Netlify proxy
// ═══════════════════════════════════════════════════════════════

function toRuleSlug(ruleName) {
  // Strip parenthetical details: "Hatred (Warriors of Chaos)" → "hatred"
  const base = ruleName.split("(")[0].split(":")[0].trim();
  return base.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function RuleLookupModal({ ruleName, onClose }) {
  const [state, setState] = useState("loading"); // loading | found | error
  const [ruleData, setRuleData] = useState(null);

  useEffect(() => {
    if (!ruleName) return;
    setState("loading");
    const slug = toRuleSlug(ruleName);

    fetch(`/.netlify/functions/rule-lookup?rule=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setState("error");
        } else {
          setRuleData(data);
          setState("found");
        }
      })
      .catch(() => setState("error"));
  }, [ruleName]);

  return (
    <div style={gvStyles.modalOverlay} onClick={onClose}>
      <div style={gvStyles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={gvStyles.modalHeader}>
          <button style={gvStyles.modalBack} onClick={onClose}>
            ← Back
          </button>
          {ruleData?.sourceUrl && (
            <a
              href={ruleData.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={gvStyles.modalSource}
            >
              Source: Warhammer: The Old World Online Rules Index
            </a>
          )}
        </div>

        {/* Content */}
        {state === "loading" && (
          <div style={gvStyles.modalLoading}>
            <div style={gvStyles.spinner} />
            <span style={{ color: "#9ca3af", marginLeft: 10 }}>Looking up {ruleName}…</span>
          </div>
        )}

        {state === "error" && (
          <div style={{ padding: 20 }}>
            <h2 style={{ color: "#e5e7eb", marginTop: 0 }}>{ruleName}</h2>
            <p style={{ color: "#6b7280", fontStyle: "italic" }}>
              Rule definition not found on tow.whfb.app. Check the{" "}
              <a
                href={`https://tow.whfb.app/rules/special-rules/${toRuleSlug(ruleName)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#60a5fa" }}
              >
                online rules index ↗
              </a>{" "}
              directly.
            </p>
            {/* Fallback to local SPECIAL_RULES_DESC from App.jsx if parent provides it */}
            {ruleData?.localDesc && (
              <p style={{ color: "#d1d5db", lineHeight: 1.7, marginTop: 12 }}>
                {ruleData.localDesc}
              </p>
            )}
          </div>
        )}

        {state === "found" && ruleData && (
          <div style={{ padding: 20 }}>
            <h2 style={{ color: "#e5e7eb", margin: "0 0 4px" }}>{ruleData.name || ruleName}</h2>
            {ruleData.breadcrumb && (
              <div style={{ color: "#60a5fa", fontSize: 13, marginBottom: 6 }}>
                {ruleData.breadcrumb}
              </div>
            )}
            {ruleData.meta && (
              <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 12 }}>
                {ruleData.meta}
              </div>
            )}
            {ruleData.flavorText && (
              <p style={{ color: "#9ca3af", fontStyle: "italic", fontSize: 14, lineHeight: 1.7, marginBottom: 14, borderLeft: "3px solid #2d2d44", paddingLeft: 12 }}>
                {ruleData.flavorText}
              </p>
            )}
            {ruleData.body && (
              <p style={{ color: "#d1d5db", lineHeight: 1.8, fontSize: 15, margin: 0 }}>
                {ruleData.body}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CLICKABLE SPECIAL RULE TAG
// ═══════════════════════════════════════════════════════════════

function RuleTag({ rule, localDesc }) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <span
        style={gvStyles.ruleTag}
        onClick={() => setShowModal(true)}
        title="Click to view rule definition"
      >
        {rule}
      </span>
      {showModal && (
        <RuleLookupModal
          ruleName={rule}
          localDesc={localDesc}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// UNIT GAME CARD
// Displays a single roster entry in game-view format
// ═══════════════════════════════════════════════════════════════

function UnitGameCard({ entry, unitDef, faction, localRulesDesc }) {
  const [expanded, setExpanded] = useState(true);

  if (!unitDef) {
    return (
      <div style={gvStyles.unitCard}>
        <div style={gvStyles.unitCardHeader}>
          <strong style={{ color: "#e5e7eb" }}>{entry.unitName}</strong>
          <span style={{ color: "#fbbf24", fontFamily: "monospace" }}>{entry.ptsCost} pts</span>
        </div>
      </div>
    );
  }

  // Collect active equipment (base + active upgrades)
  const baseEquipment = unitDef.equipment || [];
  const activeUpgradeDefs = (unitDef.upgrades || []).filter((u) =>
    (entry.activeUpgrades || []).includes(u.id)
  );
  const upgradeEquipment = activeUpgradeDefs
    .filter((u) => u.type === "equipment" || u.type === "command")
    .map((u) => u.name);
  // Non-equipment upgrades shown as chips (special abilities, kindred, sprites, lore, mount, etc.)
  const upgradeExtras = activeUpgradeDefs
    .filter((u) => u.type !== "equipment" && u.type !== "command" && u.type !== "magic")
    .map((u) => u.pts > 0 ? `${u.name} (+${u.pts}pts)` : u.name);
  const allEquipment = [...baseEquipment, ...upgradeEquipment];

  // Collect magic items as equipment strings
  const magicItemEquip = Object.values(entry.magicItems || {})
    .filter(Boolean)
    .map((item) => `${item.name} (${item.pts}pts)`);

  const commandMagicEquip = Object.values(entry.commandMagicItems || {}).flatMap((items) =>
    Object.values(items || {})
      .filter(Boolean)
      .map((item) => `${item.name} (${item.pts}pts)`)
  );

  const arrowEquip = entry.arrows ? [`🏹 ${entry.arrows.name}`] : [];

  const displayEquipment = [
    ...allEquipment,
    ...magicItemEquip,
    ...commandMagicEquip,
    ...arrowEquip,
  ];

  const displayUpgradeExtras = upgradeExtras;

  // Special rules
  const specialRules = unitDef.specialRules || [];

  return (
    <div style={gvStyles.unitCard}>
      {/* Card Header */}
      <div
        style={gvStyles.unitCardHeader}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#6b7280", fontSize: 13, transform: expanded ? "rotate(90deg)" : "rotate(0)", display: "inline-block", transition: "transform 0.15s" }}>▸</span>
          <div>
            <strong style={{ color: "#e5e7eb", fontSize: 15 }}>{entry.unitName}</strong>
            {!entry.isCharacter && (
              <span style={{ color: "#9ca3af", fontSize: 13, marginLeft: 6 }}>
                × {entry.modelCount}
              </span>
            )}
          </div>
        </div>
        <span style={gvStyles.ptsBadge}>{entry.ptsCost} pts</span>
      </div>

      {expanded && (
        <div style={gvStyles.unitCardBody}>
          {/* Equipment row */}
          {displayEquipment.length > 0 && (
            <div style={gvStyles.equipRow}>
              {displayEquipment.map((eq, i) => (
                <span key={i} style={gvStyles.equipChip}>{eq}</span>
              ))}
            </div>
          )}

          {/* Purchased upgrades (special rules, kindred, sprites, lore, mount) */}
          {displayUpgradeExtras.length > 0 && (
            <div style={{ ...gvStyles.equipRow, marginTop: 4 }}>
              {displayUpgradeExtras.map((ex, i) => (
                <span key={i} style={{ ...gvStyles.equipChip, background: "#1a2e1a", borderColor: "#2d4a2d", color: "#86efac" }}>{ex}</span>
              ))}
            </div>
          )}

          {/* Special Rules */}
          {specialRules.length > 0 && (
            <div style={gvStyles.rulesRow}>
              <span style={gvStyles.rulesLabel}>Special Rules:</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                {specialRules.map((r, i) => (
                  <RuleTag
                    key={i}
                    rule={r}
                    localDesc={localRulesDesc?.[r] || localRulesDesc?.[r.split(":")[0].trim()]}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Stat table */}
          {unitDef.profiles?.length > 0 && (
            <div style={gvStyles.statTableWrap}>
              <table style={gvStyles.statTable}>
                <thead>
                  <tr>
                    {["", "M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"].map((h) => (
                      <th key={h} style={gvStyles.statTh}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {unitDef.profiles.map((p, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#ffffff05" }}>
                      <td style={{ ...gvStyles.statTd, color: faction.accent, textAlign: "left", fontWeight: 600, minWidth: 120 }}>
                        {p.name}
                      </td>
                      {["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"].map((s) => (
                        <td key={s} style={gvStyles.statTd}>{p[s] ?? "-"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* House rule note */}
          {unitDef._houseRuleNote && (
            <div style={{ marginTop: 8, padding: "5px 10px", background: "#422006", borderRadius: 4, fontSize: 12, color: "#fbbf24" }}>
              ⚑ {unitDef._houseRuleNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GAME VIEW — Main Component
// ═══════════════════════════════════════════════════════════════

const CATEGORY_ORDER = [
  "Named Characters", "Characters", "Lords", "Heroes",
  "Core", "Special", "Rare", "Mercenaries", "Allies", "Custom",
];

export default function GameView({ currentList, allUnits, faction, activeFaction, totalPoints, onClose, localRulesDesc }) {
  if (!currentList) return null;

  // Group entries by category
  const grouped = {};
  CATEGORY_ORDER.forEach((cat) => {
    const entries = currentList.entries.filter((e) => e.category === cat);
    if (entries.length > 0) grouped[cat] = entries;
  });

  const overLimit = totalPoints > currentList.pointsLimit;

  return (
    <div style={gvStyles.overlay}>
      {/* Header */}
      <div style={gvStyles.header}>
        <button style={gvStyles.backBtn} onClick={onClose}>
          ← Back
        </button>
        <div style={{ flex: 1, textAlign: "center" }}>
          <h1 style={gvStyles.title}>Game View</h1>
          <div style={{ color: "#9ca3af", fontSize: 13 }}>
            {faction.name} [{totalPoints} pts
            {overLimit && <span style={{ color: "#ef4444" }}> – OVER LIMIT</span>}]
          </div>
        </div>
        {/* Spacer to balance the back button */}
        <div style={{ width: 90 }} />
      </div>

      {/* Army List */}
      <div style={gvStyles.content}>
        {Object.entries(grouped).map(([cat, entries]) => (
          <div key={cat} style={{ marginBottom: 28 }}>
            {/* Category header */}
            <div style={gvStyles.categoryHeader}>
              <span style={{ color: faction.accent }}>{cat}</span>
              <span style={{ color: "#6b7280", fontSize: 12, fontFamily: "monospace" }}>
                {entries.reduce((s, e) => s + (e.ptsCost || 0), 0)} pts
              </span>
            </div>

            {entries.map((entry) => {
              const unitDef = allUnits.find((u) => u.id === entry.unitId);
              return (
                <UnitGameCard
                  key={entry.entryId}
                  entry={entry}
                  unitDef={unitDef}
                  faction={faction}
                  localRulesDesc={localRulesDesc}
                />
              );
            })}
          </div>
        ))}

        {currentList.entries.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: "#6b7280" }}>
            No units in this list.
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const gvStyles = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 500,
    background: "linear-gradient(180deg, #0c0c14 0%, #111118 100%)",
    overflowY: "auto",
    fontFamily: "'Crimson Text', 'Georgia', serif",
  },
  header: {
    display: "flex", alignItems: "center",
    padding: "14px 24px",
    background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
    borderBottom: "1px solid #2d2d44",
    position: "sticky", top: 0, zIndex: 10,
  },
  backBtn: {
    background: "transparent", border: "1px solid #2d2d44",
    color: "#9ca3af", cursor: "pointer", padding: "6px 14px",
    borderRadius: 6, fontSize: 13, fontFamily: "'Segoe UI', sans-serif",
    width: 90,
  },
  title: {
    margin: 0, fontSize: 22, color: "#fbbf24",
    fontWeight: 700, letterSpacing: 1,
  },
  content: {
    maxWidth: 900, margin: "0 auto", padding: "24px 20px",
  },
  categoryHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    borderBottom: "2px solid #2d2d44",
    paddingBottom: 6, marginBottom: 10,
    fontSize: 13, textTransform: "uppercase", letterSpacing: 2,
    fontFamily: "'Segoe UI', sans-serif", fontWeight: 700,
  },
  unitCard: {
    background: "#12121f",
    border: "1px solid #2d2d44",
    borderRadius: 8,
    marginBottom: 8,
    overflow: "hidden",
  },
  unitCardHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 16px",
    cursor: "pointer",
    background: "#16162a",
  },
  unitCardBody: {
    padding: "10px 16px 14px",
    borderTop: "1px solid #1f1f33",
  },
  ptsBadge: {
    color: "#fbbf24", fontFamily: "monospace", fontSize: 14, fontWeight: 600,
  },
  equipRow: {
    display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10,
  },
  equipChip: {
    fontSize: 12, padding: "3px 8px",
    background: "#1f2937", border: "1px solid #374151",
    borderRadius: 4, color: "#d1d5db",
    fontFamily: "'Segoe UI', sans-serif",
  },
  rulesRow: {
    marginBottom: 10,
  },
  rulesLabel: {
    color: "#6b7280", fontSize: 12, fontFamily: "'Segoe UI', sans-serif",
    fontWeight: 600, textTransform: "uppercase", letterSpacing: 1,
  },
  ruleTag: {
    color: "#60a5fa",
    fontSize: 13,
    cursor: "pointer",
    borderBottom: "1px solid #3b82f6",
    paddingBottom: 1,
    fontStyle: "italic",
    fontFamily: "'Segoe UI', sans-serif",
    transition: "color 0.15s",
  },
  statTableWrap: {
    overflowX: "auto",
    marginTop: 8,
  },
  statTable: {
    width: "100%", borderCollapse: "collapse",
    fontSize: 13, fontFamily: "'Segoe UI', sans-serif",
  },
  statTh: {
    padding: "5px 10px", textAlign: "center",
    color: "#6b7280", borderBottom: "2px solid #2d2d44",
    fontSize: 11, fontWeight: 700,
    background: "#1a1a2e",
  },
  statTd: {
    padding: "5px 10px", textAlign: "center",
    color: "#d1d5db", borderBottom: "1px solid #1f1f33",
  },

  // Modal
  modalOverlay: {
    position: "fixed", inset: 0, zIndex: 1000,
    background: "rgba(0,0,0,0.75)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 20,
  },
  modal: {
    background: "#f5f0e8", // parchment look matching the screenshot
    borderRadius: 10,
    width: "100%", maxWidth: 620,
    maxHeight: "80vh", overflowY: "auto",
    color: "#1a1a1a",
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
  },
  modalHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "12px 20px",
    borderBottom: "1px solid #d4c9b0",
  },
  modalBack: {
    background: "transparent", border: "none",
    color: "#374151", cursor: "pointer", fontSize: 13,
    fontFamily: "'Segoe UI', sans-serif", padding: 0,
  },
  modalSource: {
    fontSize: 11, color: "#374151",
    textDecoration: "none", fontFamily: "'Segoe UI', sans-serif",
  },
  modalLoading: {
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 40,
  },
  spinner: {
    width: 24, height: 24,
    border: "3px solid #d4c9b0",
    borderTop: "3px solid #374151",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
};
