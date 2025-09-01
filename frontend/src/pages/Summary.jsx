import React, { useState, useEffect } from "react";
import api from "../api";

// -----------------------------------------------------------------------------
// Helper: resolve image URL served by backend (unchanged)
// -----------------------------------------------------------------------------
const imgURL = (id) => `${api.defaults.baseURL}/uploads/${encodeURIComponent(id)}`;

// -----------------------------------------------------------------------------
// Small UI atoms shared across sections
// -----------------------------------------------------------------------------
const SectionHeader = ({ id, title, subtitle, right }) => (
  <div id={id} className="px-5 py-4 border-b bg-gray-50/60 rounded-t-xl flex items-center justify-between">
    <div>
      <h2 className="font-semibold text-gray-900">{title}</h2>
      {subtitle ? <p className="text-sm text-gray-500">{subtitle}</p> : null}
    </div>
    {right}
  </div>
);

const Card = ({ children, className = "" }) => (
  <div className={`rounded-xl border bg-white shadow-sm ${className}`}>{children}</div>
);

const Input = ({ label, ...props }) => (
  <label className="block">
    <span className="text-xs font-medium text-gray-600">{label}</span>
    <input
      {...props}
      className={`mt-1 w-full border rounded-lg p-2 bg-white text-gray-900 placeholder-gray-400 ${props.className || ""}`}
    />
  </label>
);

const TextArea = ({ label, rows = 4, ...props }) => (
  <label className="block">
    <span className="text-xs font-medium text-gray-600">{label}</span>
    <textarea
      rows={rows}
      {...props}
      className={`mt-1 w-full border rounded-lg p-2 bg-white text-gray-900 placeholder-gray-400 ${props.className || ""}`}
    />
  </label>
);

const Badge = ({ children, tone = "slate" }) => {
  const tones = {
    slate: "bg-slate-50 text-slate-700 border-slate-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
  };
  return <span className={`text-xs px-2 py-1 rounded-full border ${tones[tone]}`}>{children}</span>;
};

const KeyMetric = ({ label, value, tone = "slate" }) => (
  <div className="rounded-xl border bg-white shadow-sm p-4">
    <div className="text-xs text-gray-500">{label}</div>
    <div className={`text-3xl font-semibold mt-1 ${tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-gray-900"}`}>
      {value}
    </div>
  </div>
);

// -----------------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------------
export default function Summary() {
  // Pull results (unchanged base)
  // Modal photo selection state
  const [selectedPhoto, setSelectedPhoto] = React.useState(null);
  const stored = JSON.parse(localStorage.getItem("iship_results") || "{}");
  const results = stored?.results || {};
  const perImage = Array.isArray(results?.per_image) ? results.per_image : [];
  const counts =
    results?.batch_summary || {
      fire_hazard_count: 0,
      trip_fall_count: 0,
      none_count: 0,
    };

  // ---- AI summary generation state ----
  const [genBusy, setGenBusy] = React.useState(false);

  // Build a compact payload for AI summary
  const buildSummaryPayload = () => {
    const clean = JSON.parse(localStorage.getItem("iship_results") || "{}");
    const res = clean.results || results || {};
    const per = Array.isArray(res.per_image) ? res.per_image : [];
    const hazards = per.map((it) => ({
      id: it.id,
      location: it.location || "",
      condition: it.condition,
      tags: it.tags || {},
      comment: it.comment || "",
      recs: (it.recommendations_high_severity_only || []).join("; "),
    }));
    return {
      meta: {
        vesselName: meta.vesselName,
        date: meta.date,
        location: meta.location,
        inspector: meta.inspector,
      },
      counts: results?.batch_summary || {},
      hazards,
    };
  };

  // Fallback local summary generator (if backend AI route is missing)
  const localHeuristicSummary = () => {
    const c = results?.batch_summary || { fire_hazard_count: 0, trip_fall_count: 0, none_count: 0 };
    // find top 2 locations mentioned
    const locCounts = {};
    perImage.forEach((it) => {
      const key = it.location || "unspecified area";
      locCounts[key] = (locCounts[key] || 0) + 1;
    });
    const topLocs = Object.entries(locCounts).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([k])=>k).join(" & ");
    const parts = [];
    parts.push(`The inspection on ${meta.date || "the stated date"} at ${meta.location || "the reported location"} covered ${perImage.length} photos across ${Object.keys(locCounts).length} area(s).`);
    if (c.fire_hazard_count) parts.push(`${c.fire_hazard_count} fire hazard${c.fire_hazard_count>1?"s":""} were flagged.`);
    if (c.trip_fall_count) parts.push(`${c.trip_fall_count} trip/fall issue${c.trip_fall_count>1?"s":""} noted.`);
    if (!c.fire_hazard_count && !c.trip_fall_count) parts.push("No critical hazards were detected in the sampled set.");
    parts.push(`Most photos came from ${topLocs || "varied areas"}.`);
    return parts.join(" ");
  };

  // Main generate function
  const generateSummary = async () => {
    setGenBusy(true);
    try {
      // Try backend AI endpoint (optional)
      const payload = buildSummaryPayload();
      let text = "";
      try {
        const { data } = await api.post("/api/summarize", payload);
        text = data?.summary || "";
        if (data?.overallRating) {
          setMeta((m) => ({ ...m, overallRating: data.overallRating }));
        }
      } catch {
        // If /api/summarize is not implemented, use local heuristic
        text = localHeuristicSummary();
      }
      setMeta((m) => ({ ...m, summaryBlurb: text || m.summaryBlurb }));
    } finally {
      setGenBusy(false);
    }
  };

  // Auto‑generate once if empty/placeholder
  useEffect(() => {
    const t = (meta.summaryBlurb || "").trim();
    if (!t || t.length < 20) {
      generateSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Form meta (extends your original meta; keeps same keys you had)
  // ---------------------------------------------------------------------------
  const [meta, setMeta] = React.useState({
    // Original fields
    date: new Date().toISOString().slice(0, 10),
    vesselName: "",
    imo: "",
    flag: "",
    callSign: "",
    location: "",
    inspector: "",
    reportRef: "",

    // Added to match a proper report
    vesselType: "",
    yearBuilt: "",
    classSociety: "",
    owner: "",
    operator: "",
    tonnageGross: "",
    lengthOverall: "",
    beam: "",
    draft: "",
    mainEngine: "",
    propulsion: "",
    fuelType: "",
    crewTotal: "",
    officers: "",
    ratings: "",
    weather: "",
    scope: "General safety walk‑through of accessible areas; visual-only.",
    methodology: "Visual inspection, photo tagging via computer vision, rule-based hazard checks.",
    limitations: "No confined space entry; no dismantling of machinery; weather & access permitting.",
    overallRating: "Satisfactory",
    summaryBlurb:
      "The vessel presents generally good housekeeping. One fire hazard was identified near machinery due to oil residue. No trip/fall issues were found in sampled areas.",
  });

  // Persist per-row (unchanged function, used by Observations section)
  const persistRow = (rowIndex, updater) => {
    const copy = JSON.parse(localStorage.getItem("iship_results") || "{}");
    const list = copy?.results?.per_image || [];
    if (!list[rowIndex]) return;
    const next = { ...list[rowIndex], ...updater };
    if (typeof next.recommendations_high_severity_only === "string") {
      next.recommendations_high_severity_only = next.recommendations_high_severity_only
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    list[rowIndex] = next;
    copy.results.per_image = list;
    localStorage.setItem("iship_results", JSON.stringify(copy));
  };

  // ---------------------------------------------------------------------------
  // Defects table: persistent editable overrides (area/assignee/deadline/combined)
  // ---------------------------------------------------------------------------
  const DEFECTS_KEY = "iship_defects_v1";
  const [defects, setDefects] = React.useState(() => {
    try {
      return JSON.parse(localStorage.getItem(DEFECTS_KEY) || "{}");
    } catch {
      return {};
    }
  });
  const getDefect = (id) => defects[id] || {};
  const updateDefect = (id, patch) => {
    setDefects((prev) => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      localStorage.setItem(DEFECTS_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Report download (stream or {url} response supported)
  const download = async () => {
    const clean = JSON.parse(localStorage.getItem("iship_results") || "{}");
    const payload = { meta, results: clean.results || results };

    try {
      // Prefer a direct file stream from the server
      const blobRes = await api.post("/api/report", payload, { responseType: "blob" });

      const contentType = (blobRes.headers?.["content-type"] || "").toLowerCase();
      const looksJson = contentType.includes("application/json");

      if (!looksJson) {
        // We received a real .docx file
        const blob = new Blob(
          [blobRes.data],
          { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
        );
        const fname = `${(meta.vesselName || "Vessel").trim() || "Vessel"}-Inspection-Report.docx`;

        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        return;
      }

      // If server responded with JSON, parse and expect a { url } field
      const text = await blobToText(blobRes.data);
      const data = JSON.parse(text);
      const url = data?.url;
      if (url) {
        const base = (api.defaults.baseURL || "").replace(/\/$/, "");
        const absolute = url.startsWith("http") ? url : `${base}${url}`;
        window.open(absolute, "_blank");
        return;
      }

      alert("Report API returned JSON but no 'url' field.");
    } catch (err) {
      console.error("Report download failed:", err);
      alert("Could not download report. Please check server logs for /api/report.");
    }
  };

  async function blobToText(blob) {
    if (typeof blob.text === "function") return blob.text();
    return new Response(blob).text();
  }

  // ---------------------------------------------------------------------------
  // Derived helpers and computed views
  // ---------------------------------------------------------------------------
  const hazardRows = React.useMemo(() => {
    // Build a flattened "defects/non-conformities" table based on your perImage
    return perImage
      .map((it, i) => {
        const hasRecs = (it.recommendations_high_severity_only || []).length > 0;
        const rust = !!it.tags?.rust_stains;
        const effectiveCondition =
          it.condition === "none" && rust
            ? "rust"
            : it.condition === "none" && hasRecs
            ? "attention"
            : it.condition;

        if (effectiveCondition === "none" && !hasRecs) return null;

        const recs =
          (it.recommendations_high_severity_only || []).join("; ") ||
          (hasRecs ? "" : "");

        const baseRow = {
          id: it.id,
          index: i + 1,
          area: it.location || "—",
          condition: effectiveCondition, // fire_hazard | trip_fall | rust | attention
          comment: it.comment || "",
          recommendations: recs,
        };
        const overrides = getDefect(it.id);
        return { ...baseRow, ...overrides };
      })
      .filter(Boolean);
  }, [perImage, defects]);

  const countsDerived = React.useMemo(() => {
    const fire = hazardRows.filter((r) => r.condition === "fire_hazard").length;
    const trip = hazardRows.filter((r) => r.condition === "trip_fall").length;
    const rust = hazardRows.filter((r) => r.condition === "rust").length;
    const attention = hazardRows.filter((r) => r.condition === "attention").length;
    return { fire, trip, rust, attention };
  }, [hazardRows]);

  // ---------------------------------------------------------------------------
  // Printing helpers
  // ---------------------------------------------------------------------------
  const onPrint = () => window.print();

  // ---------------------------------------------------------------------------
  // Tag component for Observations (kept unchanged behavior)
  // ---------------------------------------------------------------------------
  const Tag = ({ value }) => {
    const labelMap = {
      fire_hazard: "Fire hazard",
      trip_fall: "Trip/Fall",
      none: "No issues",
      rust: "Rust",
      attention: "Attention",
    };
    const color =
      value === "fire_hazard"
        ? "bg-red-50 text-red-700 border-red-200"
        : value === "trip_fall"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : value === "rust"
        ? "bg-orange-50 text-orange-800 border-orange-200"
        : value === "attention"
        ? "bg-sky-50 text-sky-800 border-sky-200"
        : "bg-emerald-50 text-emerald-800 border-emerald-200";
    return <span className={`text-xs px-2 py-1 rounded-full border ${color}`}>{labelMap[value] || value}</span>;
  };

  // ---------------------------------------------------------------------------
  // Early return if no data yet
  // ---------------------------------------------------------------------------
  if (!results || perImage.length === 0) {
    return (
      <div className="max-w-6xl mx-auto py-10 text-gray-700">
        No results yet. Please upload and analyze photos first.
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Page layout
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-6xl mx-auto py-10 print:py-0">
      {/* Print styles and helpers */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 14mm; }
          nav, .no-print { display: none !important; }
          .print\\:show { display: block !important; }
          .print\\:break-before-page { break-before: page; page-break-before: always; }
          .shadow-sm, .shadow, .shadow-md, .shadow-lg { box-shadow: none !important; }
          .border { border-color: #e5e7eb !important; }
        }
      `}</style>

      {/* Cover / Meta Section */}
      <Card className="mb-6">
        <SectionHeader
          id="cover"
          title="Vessel Inspection Report"
          subtitle="Generated by iShip Inspection AI — review, edit, and export."
          right={
            <div className="flex gap-2 no-print">
              <button
                onClick={onPrint}
                className="px-4 py-2 rounded-lg border text-gray-700 hover:bg-gray-50"
                title="Print or Save as PDF"
              >
                Print
              </button>
              <button
                type="button"
                disabled
                className="px-4 py-2 rounded-lg bg-gray-300 text-gray-500 cursor-not-allowed"
                title="Download disabled for testing"
              >
                Download .docx (disabled)
              </button>
            </div>
          }
        />
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Vessel name" placeholder="Vessel name" value={meta.vesselName} onChange={(e) => setMeta({ ...meta, vesselName: e.target.value })} />
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Report reference</span>
            <select
              className="mt-1 w-full border rounded-lg p-2 bg-white text-gray-900"
              value={meta.reportRef}
              onChange={(e) => setMeta({ ...meta, reportRef: e.target.value })}
            >
              <option value="">Select report type…</option>
              <option value="Superintendent Routine Audit">Superintendent Routine Audit</option>
              <option value="Internal Audit">Internal Audit</option>
              <option value="External Audit">External Audit</option>
              <option value="Follow-up Inspection">Follow-up Inspection</option>
              <option value="Pre-Purchase">Pre-Purchase</option>
              <option value="Vessel Takeover Inspection">Vessel Takeover Inspection</option>
              <option value="PSC">PSC</option>
              <option value="Vessel Takeover">Vessel Takeover</option>
            </select>
          </label>
          <Input
            label="Inspection date"
            type="date"
            value={meta.date}
            onChange={(e) => setMeta({ ...meta, date: e.target.value })}
          />
          <Input label="Location / Port" placeholder="Location / Port" value={meta.location} onChange={(e) => setMeta({ ...meta, location: e.target.value })} />
          <Input label="Inspector" placeholder="Inspector name" value={meta.inspector} onChange={(e) => setMeta({ ...meta, inspector: e.target.value })} />
          <Input label="Weather" placeholder="Weather during inspection" value={meta.weather} onChange={(e) => setMeta({ ...meta, weather: e.target.value })} />
          <Input label="IMO" placeholder="IMO number" value={meta.imo} onChange={(e) => setMeta({ ...meta, imo: e.target.value })} />
          <Input label="Flag" placeholder="Flag state" value={meta.flag} onChange={(e) => setMeta({ ...meta, flag: e.target.value })} />
          <Input label="Call sign" placeholder="Call sign" value={meta.callSign} onChange={(e) => setMeta({ ...meta, callSign: e.target.value })} />
        </div>
      </Card>

      {/* Executive Summary */}
      <Card className="mb-6">
        <SectionHeader
          id="executive"
          title="Executive summary"
          subtitle="One‑paragraph overview for busy readers."
          right={
            <button
              onClick={generateSummary}
              disabled={genBusy}
              className="px-3 py-2 rounded-lg border text-gray-700 hover:bg-gray-50 disabled:opacity-50 no-print"
              title="Auto-generate from findings"
            >
              {genBusy ? "Generating…" : "Auto‑generate"}
            </button>
          }
        />
        <div className="p-5">
          <div className="grid md:grid-cols-3 gap-4">
            <KeyMetric label="Fire hazards" value={counts.fire_hazard_count} tone={counts.fire_hazard_count > 0 ? "red" : "green"} />
            <KeyMetric label="Trip / fall" value={counts.trip_fall_count} tone={counts.trip_fall_count > 0 ? "amber" : "green"} />
            <KeyMetric label="No issues" value={counts.none_count} tone="green" />
          </div>
          <TextArea
            label="Summary"
            className="mt-4"
            rows={4}
            value={meta.summaryBlurb}
            onChange={(e) => setMeta({ ...meta, summaryBlurb: e.target.value })}
          />
          <div className="mt-4 flex gap-3">
            <label className="text-xs font-medium text-gray-600">Overall rating</label>
            <div className="flex items-center gap-2">
              {["Excellent", "Good", "Satisfactory", "Fair", "Poor"].map((opt) => (
                <label key={opt} className="inline-flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name="overallRating"
                    value={opt}
                    checked={meta.overallRating === opt}
                    onChange={(e) => setMeta({ ...meta, overallRating: e.target.value })}
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Inspection Details */}
      <Card className="mb-6">
        <SectionHeader id="details" title="Inspection details" />
        <div className="p-5 grid md:grid-cols-2 gap-4">
          <TextArea label="Scope" rows={3} value={meta.scope} onChange={(e) => setMeta({ ...meta, scope: e.target.value })} />
          <TextArea label="Methodology" rows={3} value={meta.methodology} onChange={(e) => setMeta({ ...meta, methodology: e.target.value })} />
          <TextArea label="Limitations" rows={3} value={meta.limitations} onChange={(e) => setMeta({ ...meta, limitations: e.target.value })} />
        </div>
      </Card>

      {/* Vessel Particulars */}
      <Card className="mb-6">
        <SectionHeader id="particulars" title="Vessel particulars" />
        <div className="p-5 grid md:grid-cols-2 gap-4">
          <Input label="Vessel type" value={meta.vesselType} onChange={(e) => setMeta({ ...meta, vesselType: e.target.value })} placeholder="e.g., Oil/Chemical Tanker" />
          <Input label="Year built" value={meta.yearBuilt} onChange={(e) => setMeta({ ...meta, yearBuilt: e.target.value })} placeholder="e.g., 2014" />
          <Input label="Class society" value={meta.classSociety} onChange={(e) => setMeta({ ...meta, classSociety: e.target.value })} placeholder="e.g., DNV / LR / ABS" />
          <Input label="Owner" value={meta.owner} onChange={(e) => setMeta({ ...meta, owner: e.target.value })} />
          <Input label="Operator" value={meta.operator} onChange={(e) => setMeta({ ...meta, operator: e.target.value })} />
          <Input label="Gross tonnage" value={meta.tonnageGross} onChange={(e) => setMeta({ ...meta, tonnageGross: e.target.value })} />
          <Input label="Length overall (LOA)" value={meta.lengthOverall} onChange={(e) => setMeta({ ...meta, lengthOverall: e.target.value })} />
          <Input label="Beam" value={meta.beam} onChange={(e) => setMeta({ ...meta, beam: e.target.value })} />
          <Input label="Draft" value={meta.draft} onChange={(e) => setMeta({ ...meta, draft: e.target.value })} />
          <Input label="Main engine" value={meta.mainEngine} onChange={(e) => setMeta({ ...meta, mainEngine: e.target.value })} placeholder="make/model/power" />
          <Input label="Propulsion" value={meta.propulsion} onChange={(e) => setMeta({ ...meta, propulsion: e.target.value })} placeholder="e.g., CPP / FPP" />
          <Input label="Fuel type" value={meta.fuelType} onChange={(e) => setMeta({ ...meta, fuelType: e.target.value })} placeholder="e.g., VLSFO, MGO" />
        </div>
      </Card>

      {/* Crew & Manning */}
      <Card className="mb-6">
        <SectionHeader id="crew" title="Crew & manning" />
        <div className="p-5 grid md:grid-cols-3 gap-4">
          <Input label="Total crew" value={meta.crewTotal} onChange={(e) => setMeta({ ...meta, crewTotal: e.target.value })} />
          <Input label="Officers" value={meta.officers} onChange={(e) => setMeta({ ...meta, officers: e.target.value })} />
          <Input label="Ratings" value={meta.ratings} onChange={(e) => setMeta({ ...meta, ratings: e.target.value })} />
        </div>
      </Card>

      {/* Observations summary KPIs (before full table) */}
      <Card className="mb-6">
        <SectionHeader id="kpis" title="Findings at a glance" />
        <div className="p-5 grid md:grid-cols-4 gap-4">
          <KeyMetric label="Fire hazards" value={countsDerived.fire} tone={countsDerived.fire ? "red" : "green"} />
          <KeyMetric label="Trip / fall" value={countsDerived.trip} tone={countsDerived.trip ? "amber" : "green"} />
          <KeyMetric label="Rust" value={countsDerived.rust} tone={countsDerived.rust ? "amber" : "green"} />
          <KeyMetric label="Attention" value={countsDerived.attention} tone={countsDerived.attention ? "blue" : "green"} />
        </div>
      </Card>

      {/* --------------------------------------------------------------------- */}
      {/* OBSERVATIONS TABLE (UNTOUCHED)                                        */}
      {/* --------------------------------------------------------------------- */}
      <Card className="mb-6">
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Observations</h2>
          <p className="text-sm text-gray-500">
            Edit comments and recommendations inline.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 border-b">
              <tr>
                <th className="text-left font-medium px-5 py-3 w-40">Photo</th>
                <th className="text-left font-medium px-3 py-3">File</th>
                <th className="text-left font-medium px-3 py-3">Condition</th>
                <th className="text-left font-medium px-3 py-3 w-[40%]">Comment</th>
                <th className="text-left font-medium px-3 py-3 w-[30%]">
                  Recommendations
                </th>
              </tr>
            </thead>
            <tbody>
              {perImage.map((it, idx) => {
                const initialComment = it.comment || "";
                const initialRecs = (it.recommendations_high_severity_only || []).join("; ");

                const onBlurComment = (e) => {
                  persistRow(idx, { comment: e.target.value });
                };
                const onBlurRecs = (e) => {
                  persistRow(idx, {
                    recommendations_high_severity_only: e.target.value,
                  });
                };

                return (
                  <tr key={it.id} className="border-b align-top">
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        className="w-32 h-24 rounded-lg border bg-gray-100 overflow-hidden p-0 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        onClick={() => setSelectedPhoto({ ...it, source: "obs" })}
                        title="Click to enlarge and view details"
                      >
                        <img
                          src={imgURL(it.id)}
                          alt={it.id}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.src = "/placeholder.png";
                            e.currentTarget.onerror = null;
                          }}
                        />
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-gray-900">{it.id}</div>
                      {it.location ? (
                        <div className="text-xs text-gray-500 mt-1">
                          Location: {it.location}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <Tag value={(it.condition === "none" && !!it.tags?.rust_stains) ? "rust" : (it.condition === "none" && (it.recommendations_high_severity_only || []).length > 0) ? "attention" : it.condition} />
                    </td>
                    <td className="px-3 py-3">
                      <textarea
                        className="w-full border rounded-lg p-2 bg-white text-gray-900 min-h-[72px]"
                        defaultValue={initialComment}
                        onBlur={onBlurComment}
                      />
                    </td>
                    <td className="px-3 py-3">
                      {(it.recommendations_high_severity_only?.length > 0 ||
                        initialRecs) ? (
                        <textarea
                          className="w-full border rounded-lg p-2 bg-white text-gray-900 min-h-[72px]"
                          placeholder="Use ; between items"
                          defaultValue={initialRecs}
                          onBlur={onBlurRecs}
                        />
                      ) : (
                        <div className="text-xs text-gray-400">—</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Defects / Non‑conformities (auto-prepared from observations) */}
      <Card className="mb-6 print:break-before-page">
        <SectionHeader id="defects" title="Defects & non‑conformities" subtitle="Auto-prepared from observations. You can edit inline." />
        <div className="p-5 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 border-b">
              <tr>
                <th className="text-left font-medium px-3 py-2 w-10">#</th>
                <th className="text-left font-medium px-3 py-2 w-28">Photo</th>
                <th className="text-left font-medium px-3 py-2 w-32">Area</th>
                <th className="text-left font-medium px-3 py-2 w-40">Assigned to / Responsible</th>
                <th className="text-left font-medium px-3 py-2 w-32">Category</th>
                <th className="text-left font-medium px-3 py-2 w-[38%]">Description &amp; Recommendations</th>
                <th className="text-left font-medium px-3 py-2 w-32">Targeted Deadline</th>
              </tr>
            </thead>
            <tbody>
              {hazardRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">No defects / non‑conformities derived from observations.</td>
                </tr>
              ) : (
                hazardRows.map((row, idx) => (
                  <tr key={row.id} className="border-b align-top">
                    {/* Serial number */}
                    <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                    {/* Photo thumbnail */}
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="w-20 h-16 rounded-lg border bg-gray-100 overflow-hidden p-0 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        onClick={() => setSelectedPhoto({ ...row, source: "defect" })}
                        title="Click to enlarge and view details"
                      >
                        <img
                          src={imgURL(row.id)}
                          alt={row.id}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.src = "/placeholder.png";
                            e.currentTarget.onerror = null;
                          }}
                        />
                      </button>
                    </td>
                    {/* Area input */}
                    <td className="px-3 py-2">
                      <input
                        value={row.area || ""}
                        onChange={(e) => updateDefect(row.id, { area: e.target.value })}
                        className="w-full border rounded-lg p-2 bg-white"
                        placeholder="e.g., Engine room / Deck"
                      />
                    </td>
                    {/* Assigned to / Responsible input */}
                    <td className="px-3 py-2">
                      <input
                        value={row.assignedTo || ""}
                        onChange={(e) => updateDefect(row.id, { assignedTo: e.target.value })}
                        className="w-full border rounded-lg p-2 bg-white"
                        placeholder="Name or dept."
                      />
                    </td>
                    {/* Category badge */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={row.condition === "fire_hazard" ? "red" : row.condition === "trip_fall" ? "amber" : row.condition === "rust" ? "amber" : "blue"}>
                          {row.condition === "fire_hazard"
                            ? "Fire hazard"
                            : row.condition === "trip_fall"
                            ? "Trip/Fall"
                            : row.condition === "rust"
                            ? "Rust"
                            : "Attention"}
                        </Badge>
                      </div>
                    </td>
                    {/* Description & Recommendations textarea */}
                    <td className="px-3 py-2">
                      <textarea
                        value={
                          typeof row.combined === "string"
                            ? row.combined
                            : (row.comment || "") +
                              (row.recommendations ? " — Recs: " + row.recommendations : "")
                        }
                        onChange={(e) => updateDefect(row.id, { combined: e.target.value })}
                        className="w-full border rounded-lg p-2 bg-white min-h-[72px]"
                      />
                    </td>
                    {/* Targeted Deadline input */}
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        value={row.deadline || ""}
                        onChange={(e) => updateDefect(row.id, { deadline: e.target.value })}
                        className="w-full border rounded-lg p-2 bg-white"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Conclusion & Recommendations summary */}
      <Card className="mb-6">
        <SectionHeader id="conclusion" title="Conclusion & recommendations" />
        <div className="p-5 grid md:grid-cols-2 gap-4">
          <TextArea
            label="Conclusion"
            rows={5}
            value={
              meta.conclusion ||
              `Based on the scope and visual checks performed, the vessel is assessed as "${meta.overallRating}". Outstanding items should be rectified at the earliest opportunity, and routine housekeeping standards should be maintained.`
            }
            onChange={(e) => setMeta({ ...meta, conclusion: e.target.value })}
          />
          <TextArea
            label="General recommendations"
            rows={5}
            value={
              meta.generalRecs ||
              "1) Address identified fire hazard(s) by cleaning oil residue and securing sources. 2) Maintain walkways clear, verify signage and fire-fighting readiness. 3) Continue routine planned maintenance and periodic housekeeping audits."
            }
            onChange={(e) => setMeta({ ...meta, generalRecs: e.target.value })}
          />
        </div>
      </Card>

      {/* Declarations */}
      <Card className="mb-6">
        <SectionHeader id="declaration" title="Inspector’s declaration & acknowledgements" />
        <div className="p-5 grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-sm font-medium text-gray-800 mb-2">Inspector’s declaration</div>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" defaultChecked />
                <span>This report reflects the conditions observed during the inspection date and scope stated.</span>
              </li>
              <li className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" defaultChecked />
                <span>No dismantling was performed; findings are based on visual inspection only.</span>
              </li>
              <li className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" />
                <span>Photographs have been appended to support key observations.</span>
              </li>
            </ul>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <Input label="Inspector name" value={meta.inspector} onChange={(e) => setMeta({ ...meta, inspector: e.target.value })} />
              <Input label="Date" type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} />
            </div>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-800 mb-2">Master / owner acknowledgement</div>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" />
                <span>The Master/owner representative has reviewed the findings and recommendations.</span>
              </li>
              <li className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" />
                <span>Action will be taken to address the listed items within appropriate timeframes.</span>
              </li>
            </ul>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <Input label="Acknowledged by" value={meta.ackBy || ""} onChange={(e) => setMeta({ ...meta, ackBy: e.target.value })} />
              <Input label="Title / role" value={meta.ackRole || ""} onChange={(e) => setMeta({ ...meta, ackRole: e.target.value })} />
            </div>
          </div>
        </div>
      </Card>

      {/* Footer actions */}
      <div className="mt-6 flex items-center gap-3 no-print">
        <button onClick={onPrint} className="px-5 py-3 rounded-lg border text-gray-700 hover:bg-gray-50">
          Print / Save PDF
        </button>
        <button
          type="button"
          disabled
          className="px-5 py-3 rounded-lg bg-gray-300 text-gray-500 cursor-not-allowed"
          title="Download disabled for testing"
        >
          Download .docx report (disabled)
        </button>
      </div>

      {/* Modal for enlarged photo and details */}
      {selectedPhoto && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full relative">
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-2 right-2 text-gray-600 hover:text-gray-900"
              aria-label="Close"
            >
              ✕
            </button>
            {(() => {
              // derive display fields based on source
              const isObs = selectedPhoto.source === "obs";
              const categoryValue = isObs
                ? (selectedPhoto.condition === "none" && !!selectedPhoto.tags?.rust_stains)
                    ? "rust"
                    : (selectedPhoto.condition === "none" && (selectedPhoto.recommendations_high_severity_only || []).length > 0)
                      ? "attention"
                      : selectedPhoto.condition
                : selectedPhoto.condition;
              const categoryLabelMap = {
                fire_hazard: "Fire hazard",
                trip_fall: "Trip / fall",
                none: "No issues",
                rust: "Rust",
                attention: "Attention",
              };
              const idToShow = selectedPhoto.id;
              const areaToShow = isObs ? (selectedPhoto.location || "") : (selectedPhoto.area || "");
              const descToShow = isObs ? (selectedPhoto.comment || "") : (selectedPhoto.combined || selectedPhoto.comment || "");
              const recsToShow = isObs
                ? (selectedPhoto.recommendations_high_severity_only || []).join("; ")
                : (selectedPhoto.recommendations || "");
              const assignedToShow = !isObs ? (selectedPhoto.assignedTo || "") : "";
              const deadlineToShow = !isObs ? (selectedPhoto.deadline || "") : "";
              return (
                <>
                  <img
                    src={imgURL(selectedPhoto.id)}
                    alt={selectedPhoto.id}
                    className="w-full h-64 object-contain rounded border mb-4"
                    onError={(e) => {
                      e.currentTarget.src = "/placeholder.png";
                      e.currentTarget.onerror = null;
                    }}
                  />
                  <div className="space-y-2 text-sm">
                    {idToShow ? (
                      <div><strong>ID:</strong> {idToShow}</div>
                    ) : null}
                    {areaToShow ? (
                      <div><strong>Area:</strong> {areaToShow}</div>
                    ) : null}
                    {categoryValue ? (
                      <div><strong>Category:</strong> {categoryLabelMap[categoryValue] || categoryValue}</div>
                    ) : null}
                    {descToShow ? (
                      <div><strong>Description:</strong> {descToShow}</div>
                    ) : null}
                    {recsToShow ? (
                      <div><strong>Recommendations:</strong> {recsToShow}</div>
                    ) : null}
                    {!isObs && assignedToShow ? (
                      <div><strong>Assigned to:</strong> {assignedToShow}</div>
                    ) : null}
                    {!isObs && deadlineToShow ? (
                      <div><strong>Deadline:</strong> {deadlineToShow}</div>
                    ) : null}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}