import { useState, useRef, useEffect, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// MAP VIEW — Campaign Territory Map
// ═══════════════════════════════════════════════════════════════

const MAP_STORAGE_KEY = "tow-campaign-maps-v2";

// ── Pre-configured maps ──────────────────────────────────────────
// Place map-world.webp and map-border-princes.jpg in /public/
const PRESET_MAPS = [
  {
    id: "world",
    label: "The Old World",
    icon: "🌍",
    description: "Full world overview",
    src: "/map-world.webp",
    width: 1000,
    height: 684,
    readOnly: true, // World map is reference-only, no region drawing
  },
  {
    id: "border-princes",
    label: "Border Princes",
    icon: "⚔️",
    description: "Campaign territory map",
    src: "/map-border-princes.jpg",
    width: 1080,
    height: 764,
    readOnly: false,
  },
];

// ── Helpers ──────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
  if (!hex || hex.length < 7) return `rgba(107,114,128,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function pointsToStr(points, W, H) {
  return points.map(p => `${(p.x / 100) * W},${(p.y / 100) * H}`).join(" ");
}

function centroid(points, W, H) {
  const cx = points.reduce((s, p) => s + (p.x / 100) * W, 0) / points.length;
  const cy = points.reduce((s, p) => s + (p.y / 100) * H, 0) / points.length;
  return { cx, cy };
}

function ptDist(ax, ay, bx, by) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

// ── Battle History ───────────────────────────────────────────────

function BattleHistoryPanel({ region, onAddBattle, onDeleteBattle }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: "", attacker: "", defender: "", result: "Victory", notes: "" });

  const handleAdd = () => {
    if (!form.attacker || !form.defender) return;
    onAddBattle({ ...form, id: `b_${Date.now()}` });
    setForm({ date: "", attacker: "", defender: "", result: "Victory", notes: "" });
    setShowForm(false);
  };

  const battles = region.battleHistory || [];
  const RC = { Victory: "#4ade80", Defeat: "#f87171", Draw: "#fbbf24", "Pyrrhic Victory": "#fb923c" };

  return (
    <div style={s.section}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={s.sectionLabel}>⚔ Battle History</span>
        <button style={s.smallBtn} onClick={() => setShowForm(v => !v)}>
          {showForm ? "Cancel" : "+ Log Battle"}
        </button>
      </div>

      {showForm && (
        <div style={{ padding: 10, background: "#12121f", border: "1px solid #2d2d44", borderRadius: 6, marginBottom: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
            <label style={s.fieldWrap}>
              <span style={s.fieldLabel}>Date / Turn</span>
              <input style={s.input} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} placeholder="e.g. Turn 3" />
            </label>
            <label style={s.fieldWrap}>
              <span style={s.fieldLabel}>Result</span>
              <select style={s.input} value={form.result} onChange={e => setForm({ ...form, result: e.target.value })}>
                {["Victory", "Defeat", "Draw", "Pyrrhic Victory"].map(r => <option key={r}>{r}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
            <label style={s.fieldWrap}>
              <span style={s.fieldLabel}>Attacker</span>
              <input style={s.input} value={form.attacker} onChange={e => setForm({ ...form, attacker: e.target.value })} placeholder="Army / faction" />
            </label>
            <label style={s.fieldWrap}>
              <span style={s.fieldLabel}>Defender</span>
              <input style={s.input} value={form.defender} onChange={e => setForm({ ...form, defender: e.target.value })} placeholder="Army / faction" />
            </label>
          </div>
          <label style={{ ...s.fieldWrap, marginBottom: 8 }}>
            <span style={s.fieldLabel}>Notes</span>
            <textarea style={{ ...s.input, height: 50, resize: "vertical" }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Brief account..." />
          </label>
          <button style={{ ...s.smallBtn, background: "#1d4ed8", color: "#bfdbfe", width: "100%", padding: "6px" }} onClick={handleAdd}>
            Save Battle
          </button>
        </div>
      )}

      {battles.length === 0 && !showForm && (
        <p style={{ color: "#374151", fontSize: 12, fontStyle: "italic", margin: 0 }}>No battles recorded yet.</p>
      )}

      {battles.map((b, i) => (
        <div key={b.id || i} style={{ padding: "8px 10px", background: "#12121f", border: "1px solid #1f1f33", borderRadius: 6, marginBottom: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              {b.date && <span style={{ color: "#6b7280", fontSize: 11, marginRight: 6 }}>{b.date}</span>}
              <span style={{ color: RC[b.result] || "#9ca3af", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>{b.result}</span>
            </div>
            <button onClick={() => onDeleteBattle(b.id || i)} style={{ background: "none", border: "none", color: "#4b5563", cursor: "pointer", fontSize: 11, padding: 0 }}>✕</button>
          </div>
          <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 2 }}>
            {b.attacker} <span style={{ color: "#374151" }}> vs </span> {b.defender}
          </div>
          {b.notes && <p style={{ color: "#6b7280", fontSize: 11, margin: "3px 0 0", fontStyle: "italic", lineHeight: 1.5 }}>{b.notes}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Region Detail Panel ──────────────────────────────────────────

function RegionDetailPanel({ region, factions, onUpdate, onDelete, onClose }) {
  const [name, setName] = useState(region.name);
  const [lore, setLore] = useState(region.loreNotes || "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setName(region.name);
    setLore(region.loreNotes || "");
    setDirty(false);
  }, [region.id]);

  const faction = region.factionId ? factions[region.factionId] : null;

  const save = () => {
    onUpdate({ name: name.trim() || "Unnamed Region", loreNotes: lore });
    setDirty(false);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          {faction && <span style={{ fontSize: 18, flexShrink: 0 }}>{faction.icon}</span>}
          <input
            style={{ ...s.input, fontSize: 14, fontWeight: 700, color: "#f3f4f6" }}
            value={name}
            onChange={e => { setName(e.target.value); setDirty(true); }}
          />
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#4b5563", cursor: "pointer", fontSize: 16, marginLeft: 8, flexShrink: 0 }}>✕</button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <span style={s.sectionLabel}>Controlled by</span>
        <div style={{
          marginTop: 5, display: "inline-flex", alignItems: "center", gap: 7,
          padding: "5px 12px", borderRadius: 6,
          background: faction ? hexToRgba(faction.color, 0.18) : "#1a1a2e",
          border: `1px solid ${faction ? faction.color + "55" : "#2d2d44"}`,
        }}>
          <span style={{ fontSize: 15 }}>{faction ? faction.icon : "🏳"}</span>
          <span style={{ color: faction ? faction.accent : "#6b7280", fontSize: 13, fontWeight: 600 }}>
            {faction ? faction.name.split("–")[0].trim() : "Uncontrolled"}
          </span>
        </div>
        <p style={{ color: "#374151", fontSize: 11, margin: "5px 0 0", fontStyle: "italic" }}>
          Double-click the region on the map to assign the active faction.
        </p>
      </div>

      <div style={s.section}>
        <label style={s.fieldWrap}>
          <span style={s.sectionLabel}>📜 Lore Notes</span>
          <textarea
            style={{ ...s.input, height: 90, resize: "vertical", marginTop: 5, lineHeight: 1.6 }}
            value={lore}
            onChange={e => { setLore(e.target.value); setDirty(true); }}
            placeholder="History, strategic value, notable features..."
          />
        </label>
        {dirty && (
          <button style={{ ...s.smallBtn, background: "#1d4ed8", color: "#bfdbfe", marginTop: 6, width: "100%", padding: "6px" }} onClick={save}>
            Save Changes
          </button>
        )}
      </div>

      <BattleHistoryPanel
        region={region}
        onAddBattle={(b) => onUpdate({ battleHistory: [...(region.battleHistory || []), b] })}
        onDeleteBattle={(idOrIdx) => {
          const battles = region.battleHistory || [];
          const updated = typeof idOrIdx === "string"
            ? battles.filter(b => b.id !== idOrIdx)
            : battles.filter((_, i) => i !== idOrIdx);
          onUpdate({ battleHistory: updated });
        }}
      />

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #1a1a2e" }}>
        <button
          style={{ ...s.smallBtn, background: "#450a0a", color: "#fca5a5", border: "1px solid #7f1d1d", width: "100%", padding: "6px" }}
          onClick={() => { if (confirm(`Delete "${region.name}"?`)) onDelete(); }}
        >
          🗑 Delete Region
        </button>
      </div>
    </div>
  );
}

// ── Territory Stats Bar ──────────────────────────────────────────

function TerritoryStats({ regions, factions, activeMapId }) {
  if (regions.length === 0) return null;

  const counts = {};
  regions.forEach(r => {
    const key = r.factionId || "__neutral__";
    counts[key] = (counts[key] || 0) + 1;
  });

  const total = regions.length;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return (
    <div style={s.statsBar}>
      <span style={{ color: "#374151", fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700, marginRight: 10, flexShrink: 0 }}>
        Territory
      </span>
      <div style={{ display: "flex", gap: 3, flex: 1, height: 8, borderRadius: 4, overflow: "hidden" }}>
        {entries.map(([key, count]) => {
          const f = key !== "__neutral__" ? factions[key] : null;
          return (
            <div key={key} style={{ flex: count, background: f ? f.color : "#374151", transition: "flex 0.4s" }} title={`${f ? f.name.split("–")[0].trim() : "Uncontrolled"}: ${count}`} />
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginLeft: 12, flexShrink: 0 }}>
        {entries.map(([key, count]) => {
          const f = key !== "__neutral__" ? factions[key] : null;
          return (
            <span key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: f ? f.color : "#374151", display: "inline-block", flexShrink: 0 }} />
              <span style={{ color: f ? f.accent : "#6b7280" }}>{f ? f.name.split("–")[0].trim() : "—"}</span>
              <span style={{ color: "#4b5563" }}>{count}/{total}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Main MapView ─────────────────────────────────────────────────

export default function MapView({ factions }) {
  // All map data keyed by mapId
  const [allMapData, setAllMapData] = useState(() => {
    try {
      const raw = localStorage.getItem(MAP_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });

  const [activeMapId, setActiveMapId] = useState("border-princes");
  const [mode, setMode] = useState("select");
  const [selectedFactionId, setSelectedFactionId] = useState(() => Object.keys(factions)[0] || null);
  const [selectedRegionId, setSelectedRegionId] = useState(null);
  const [drawingPoints, setDrawingPoints] = useState([]);
  const [hoverPt, setHoverPt] = useState(null);
  const [customImageSrc, setCustomImageSrc] = useState(null); // for user-uploaded overrides
  const [customImgSize, setCustomImgSize] = useState(null);

  const svgRef = useRef(null);
  const imgInputRef = useRef(null);

  // Current map config
  const mapConfig = PRESET_MAPS.find(m => m.id === activeMapId) || PRESET_MAPS[0];
  const imgSrc = customImageSrc || mapConfig.src;
  const imgSize = customImgSize || { w: mapConfig.width, h: mapConfig.height };
  const isReadOnly = mapConfig.readOnly && !customImageSrc;

  // Current map's region data
  const mapData = allMapData[activeMapId] || { regions: [] };
  const regions = mapData.regions || [];

  const persist = useCallback((mapId, data) => {
    setAllMapData(prev => {
      const next = { ...prev, [mapId]: data };
      try { localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const saveRegions = (newRegions) => persist(activeMapId, { ...mapData, regions: newRegions });

  // Reset drawing when switching maps
  useEffect(() => {
    setDrawingPoints([]);
    setHoverPt(null);
    setSelectedRegionId(null);
    setMode("select");
    setCustomImageSrc(null);
    setCustomImgSize(null);
  }, [activeMapId]);

  // ── SVG helpers ────────────────────────────────────────────────
  const getSVGPt = (e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };

  const toPct = ({ x, y }) => ({ x: (x / imgSize.w) * 100, y: (y / imgSize.h) * 100 });
  const fromPct = ({ x, y }) => ({ x: (x / 100) * imgSize.w, y: (y / 100) * imgSize.h });

  // ── Custom image upload ────────────────────────────────────────
  const handleImgUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        setCustomImgSize({ w: img.naturalWidth, h: img.naturalHeight });
        setCustomImageSrc(ev.target.result);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  // ── Drawing ────────────────────────────────────────────────────
  const handleSVGClick = (e) => {
    if (mode !== "draw" || isReadOnly) return;
    const tag = e.target.tagName;
    if (tag !== "svg" && tag !== "image" && tag !== "rect") return;

    const raw = getSVGPt(e);
    const pct = toPct(raw);

    if (drawingPoints.length >= 3) {
      const first = fromPct(drawingPoints[0]);
      if (ptDist(raw.x, raw.y, first.x, first.y) < 14) {
        finishRegion();
        return;
      }
    }
    setDrawingPoints(prev => [...prev, pct]);
  };

  const handleMouseMove = (e) => {
    if (mode !== "draw") return;
    setHoverPt(getSVGPt(e));
  };

  const finishRegion = () => {
    if (drawingPoints.length < 3) return;
    const nr = {
      id: `r_${Date.now()}`,
      name: "New Region",
      points: drawingPoints,
      factionId: selectedFactionId,
      loreNotes: "",
      battleHistory: [],
    };
    saveRegions([...regions, nr]);
    setDrawingPoints([]);
    setHoverPt(null);
    setSelectedRegionId(nr.id);
    setMode("select");
  };

  const cancelDraw = () => { setDrawingPoints([]); setHoverPt(null); setMode("select"); };

  // ── Region ops ─────────────────────────────────────────────────
  const updateRegion = (id, changes) => saveRegions(regions.map(r => r.id === id ? { ...r, ...changes } : r));
  const deleteRegion = (id) => { saveRegions(regions.filter(r => r.id !== id)); setSelectedRegionId(null); };
  const assignFaction = (id) => updateRegion(id, { factionId: selectedFactionId });

  const selectedRegion = regions.find(r => r.id === selectedRegionId) || null;
  const labelSize = Math.max(10, Math.min(16, imgSize.w / 70));
  const subSize = Math.max(8, Math.min(12, imgSize.w / 100));
  const activeFaction = selectedFactionId ? factions[selectedFactionId] : null;

  const previewPts = hoverPt && drawingPoints.length > 0
    ? [...drawingPoints.map(p => fromPct(p)), hoverPt]
    : null;

  return (
    <div style={s.root}>

      {/* ── Left sidebar ─── */}
      <div style={s.sidebar}>

        {/* Map switcher */}
        <div style={s.sideBlock}>
          <p style={s.sideLabel}>Map</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {PRESET_MAPS.map(m => (
              <button
                key={m.id}
                onClick={() => setActiveMapId(m.id)}
                style={{
                  ...s.mapBtn,
                  ...(activeMapId === m.id ? { background: "#1f2937", border: "1px solid #374151", color: "#e5e7eb" } : {}),
                }}
              >
                <span style={{ fontSize: 15 }}>{m.icon}</span>
                <div style={{ textAlign: "left", flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{m.label}</div>
                  <div style={{ fontSize: 9, color: "#4b5563", marginTop: 1 }}>{m.description}</div>
                </div>
                {activeMapId === m.id && <span style={{ fontSize: 8, color: "#60a5fa" }}>●</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Faction selector */}
        {!isReadOnly && (
          <div style={s.sideBlock}>
            <p style={s.sideLabel}>Active Faction</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {Object.entries(factions).map(([key, f]) => (
                <button
                  key={key}
                  onClick={() => setSelectedFactionId(key)}
                  style={{
                    ...s.factionBtn,
                    ...(selectedFactionId === key ? { background: hexToRgba(f.color, 0.25), border: `1px solid ${f.color}`, color: f.accent } : {}),
                  }}
                >
                  <span style={{ fontSize: 14 }}>{f.icon}</span>
                  <span style={{ flex: 1, textAlign: "left", fontSize: 11 }}>{f.name.split("–")[0].trim()}</span>
                  {selectedFactionId === key && <span style={{ fontSize: 8, opacity: 0.6 }}>ACTIVE</span>}
                </button>
              ))}
              <button
                onClick={() => setSelectedFactionId(null)}
                style={{ ...s.factionBtn, ...(selectedFactionId === null ? { background: "#1f2937", border: "1px solid #4b5563", color: "#e5e7eb" } : {}) }}
              >
                <span style={{ fontSize: 14 }}>🏳</span>
                <span style={{ flex: 1, textAlign: "left", fontSize: 11 }}>Uncontrolled</span>
              </button>
            </div>
          </div>
        )}

        {/* Tool */}
        {!isReadOnly && (
          <div style={s.sideBlock}>
            <p style={s.sideLabel}>Tool</p>
            <div style={{ display: "flex", gap: 5 }}>
              <button style={{ ...s.modeBtn, ...(mode === "select" ? s.modeBtnOn : {}) }} onClick={() => { cancelDraw(); setMode("select"); }}>
                ↖ Select
              </button>
              <button
                style={{ ...s.modeBtn, ...(mode === "draw" ? { ...s.modeBtnOn, background: "#172554", borderColor: "#3b82f6", color: "#93c5fd" } : {}) }}
                onClick={() => setMode("draw")}
              >
                ✏ Draw
              </button>
            </div>
            {mode === "draw" && (
              <div style={{ marginTop: 8 }}>
                <p style={{ color: "#3b82f6", fontSize: 11, margin: "0 0 6px", lineHeight: 1.5 }}>
                  Click to place points. Click the <strong style={{ color: "#fbbf24" }}>first point</strong> to close.
                </p>
                {drawingPoints.length > 0 && (
                  <div style={{ display: "flex", gap: 5 }}>
                    {drawingPoints.length >= 3 && (
                      <button style={{ ...s.smallBtn, background: "#14532d", color: "#86efac", flex: 1 }} onClick={finishRegion}>
                        ✓ Finish
                      </button>
                    )}
                    <button style={{ ...s.smallBtn, background: "#450a0a", color: "#fca5a5", flex: 1 }} onClick={cancelDraw}>
                      ✕ Cancel
                    </button>
                  </div>
                )}
                <p style={{ color: "#374151", fontSize: 10, margin: "4px 0 0" }}>{drawingPoints.length} point{drawingPoints.length !== 1 ? "s" : ""}</p>
              </div>
            )}
          </div>
        )}

        {/* Regions list */}
        <div style={{ ...s.sideBlock, flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", borderBottom: "none", marginBottom: 0, paddingBottom: 0 }}>
          <p style={s.sideLabel}>
            {isReadOnly ? "Reference Map" : `Regions (${regions.length})`}
          </p>
          {isReadOnly ? (
            <p style={{ color: "#374151", fontSize: 11, fontStyle: "italic", lineHeight: 1.6 }}>
              This is a world overview map.<br />Switch to Border Princes to manage territories.
            </p>
          ) : (
            <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
              {regions.length === 0 && (
                <p style={{ color: "#374151", fontSize: 11, fontStyle: "italic" }}>No regions yet. Use Draw mode.</p>
              )}
              {regions.map(r => {
                const f = r.factionId ? factions[r.factionId] : null;
                const isSelected = selectedRegionId === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => { setSelectedRegionId(r.id); setMode("select"); }}
                    style={{
                      ...s.regionItem,
                      background: isSelected ? (f ? hexToRgba(f.color, 0.22) : "#1f2937") : "#0f0f1a",
                      border: `1px solid ${isSelected ? (f ? f.color + "77" : "#374151") : "#1a1a2e"}`,
                    }}
                  >
                    <span style={{ fontSize: 12 }}>{f ? f.icon : "🏳"}</span>
                    <span style={{ flex: 1, textAlign: "left", color: isSelected ? "#f3f4f6" : "#9ca3af", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.name}
                    </span>
                    {r.battleHistory?.length > 0 && (
                      <span style={{ fontSize: 9, color: "#4b5563" }}>⚔{r.battleHistory.length}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Center column: territory bar + canvas ─── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Territory stats bar */}
        {!isReadOnly && regions.length > 0 && (
          <TerritoryStats regions={regions} factions={factions} activeMapId={activeMapId} />
        )}

        {/* Map header for read-only */}
        {isReadOnly && (
          <div style={{ padding: "8px 16px", background: "#090910", borderBottom: "1px solid #18181f", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>{mapConfig.icon}</span>
            <div>
              <span style={{ color: "#9ca3af", fontSize: 13, fontWeight: 600 }}>{mapConfig.label}</span>
              <span style={{ color: "#374151", fontSize: 11, marginLeft: 10 }}>Reference — zoom/pan to explore</span>
            </div>
          </div>
        )}

        {/* SVG canvas */}
        <div style={{ flex: 1, background: "#06060c", overflow: "hidden", position: "relative" }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: "100%", height: "100%", display: "block", cursor: mode === "draw" && !isReadOnly ? "crosshair" : "default" }}
            onClick={handleSVGClick}
            onMouseMove={handleMouseMove}
          >
            <image href={imgSrc} x="0" y="0" width={imgSize.w} height={imgSize.h} />

            {/* Regions */}
            {regions.map(r => {
              const f = r.factionId ? factions[r.factionId] : null;
              const fill = f ? hexToRgba(f.color, 0.32) : "rgba(107,114,128,0.2)";
              const stroke = f ? f.color : "#6b7280";
              const isSelected = selectedRegionId === r.id;
              const pts = pointsToStr(r.points, imgSize.w, imgSize.h);
              const { cx, cy } = centroid(r.points, imgSize.w, imgSize.h);

              return (
                <g key={r.id} style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); if (mode === "select") setSelectedRegionId(r.id); }}
                  onDoubleClick={(e) => { e.stopPropagation(); assignFaction(r.id); }}
                >
                  <polygon
                    points={pts}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    style={{ filter: isSelected ? `drop-shadow(0 0 6px ${stroke})` : "none", transition: "all 0.15s" }}
                  />
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                    style={{ fontSize: labelSize, fontFamily: "'Segoe UI',sans-serif", fontWeight: isSelected ? 700 : 600,
                      fill: "#fff", paintOrder: "stroke", stroke: "#000", strokeWidth: 3, strokeLinejoin: "round", pointerEvents: "none" }}>
                    {r.name}
                  </text>
                  {f && (
                    <text x={cx} y={cy + labelSize * 1.6} textAnchor="middle" dominantBaseline="middle"
                      style={{ fontSize: subSize, fontFamily: "'Segoe UI',sans-serif", fill: f.accent,
                        paintOrder: "stroke", stroke: "#00000099", strokeWidth: 2, pointerEvents: "none" }}>
                      {f.icon} {f.name.split("–")[0].trim()}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Drawing preview */}
            {mode === "draw" && drawingPoints.length > 0 && (
              <g>
                {previewPts && previewPts.length >= 3 && (
                  <polygon
                    points={previewPts.map(p => `${p.x},${p.y}`).join(" ")}
                    fill={activeFaction ? hexToRgba(activeFaction.color, 0.18) : "rgba(107,114,128,0.15)"}
                    stroke={activeFaction ? activeFaction.color : "#6b7280"}
                    strokeWidth={1.5} strokeDasharray="6,3"
                  />
                )}
                {hoverPt && (() => {
                  const last = fromPct(drawingPoints[drawingPoints.length - 1]);
                  return <line x1={last.x} y1={last.y} x2={hoverPt.x} y2={hoverPt.y}
                    stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.7} />;
                })()}
                {drawingPoints.map((p, i) => {
                  const { x, y } = fromPct(p);
                  const isFirst = i === 0;
                  return (
                    <g key={i}>
                      <circle cx={x} cy={y} r={isFirst ? 7 : 4} fill={isFirst ? "#fbbf24" : "#3b82f6"} stroke="#fff" strokeWidth={2} />
                      {isFirst && drawingPoints.length >= 3 && (
                        <circle cx={x} cy={y} r={13} fill="none" stroke="#fbbf24" strokeWidth={1} strokeDasharray="3,2" opacity={0.6} />
                      )}
                    </g>
                  );
                })}
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* ── Right detail panel ─── */}
      {selectedRegion && (
        <div style={s.detailPanel}>
          <RegionDetailPanel
            region={selectedRegion}
            factions={factions}
            onUpdate={(ch) => updateRegion(selectedRegion.id, ch)}
            onDelete={() => deleteRegion(selectedRegion.id)}
            onClose={() => setSelectedRegionId(null)}
          />
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const s = {
  root: { display: "flex", height: "calc(100vh - 130px)", overflow: "hidden", fontFamily: "'Segoe UI', sans-serif" },
  sidebar: { width: 210, flexShrink: 0, background: "#090910", borderRight: "1px solid #18181f", display: "flex", flexDirection: "column", overflowY: "auto", padding: "10px 9px" },
  sideBlock: { marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid #18181f" },
  sideLabel: { color: "#374151", fontSize: 9, textTransform: "uppercase", letterSpacing: 2, margin: "0 0 7px", fontWeight: 700 },
  mapBtn: { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 9px", background: "#0d0d18", border: "1px solid #18181f", borderRadius: 6, color: "#6b7280", cursor: "pointer", transition: "all 0.12s", textAlign: "left" },
  factionBtn: { display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "6px 9px", background: "transparent", border: "1px solid #18181f", borderRadius: 5, color: "#6b7280", cursor: "pointer", transition: "all 0.12s" },
  modeBtn: { flex: 1, padding: "6px 0", background: "#12121f", border: "1px solid #1f2937", borderRadius: 5, color: "#4b5563", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  modeBtnOn: { background: "#1f2937", border: "1px solid #374151", color: "#d1d5db" },
  regionItem: { display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "5px 7px", borderRadius: 4, cursor: "pointer", transition: "all 0.1s" },
  detailPanel: { width: 275, flexShrink: 0, background: "#090910", borderLeft: "1px solid #18181f", overflowY: "auto", padding: "12px 11px" },
  section: { marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid #18181f" },
  sectionLabel: { color: "#374151", fontSize: 9, textTransform: "uppercase", letterSpacing: 2, fontWeight: 700, display: "block" },
  fieldWrap: { display: "block" },
  fieldLabel: { color: "#374151", fontSize: 9, textTransform: "uppercase", letterSpacing: 1.5, display: "block", marginBottom: 3 },
  input: { width: "100%", background: "#12121f", border: "1px solid #1f2937", borderRadius: 4, padding: "5px 7px", color: "#d1d5db", fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "'Segoe UI',sans-serif" },
  smallBtn: { padding: "4px 10px", background: "#12121f", border: "1px solid #1f2937", borderRadius: 4, color: "#9ca3af", cursor: "pointer", fontSize: 11, fontFamily: "'Segoe UI',sans-serif" },
  statsBar: { display: "flex", alignItems: "center", padding: "7px 14px", background: "#090910", borderBottom: "1px solid #18181f", gap: 0, flexShrink: 0 },
};
