import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import JSZip from "jszip";
import api from "../api";

const ts = () => new Date().toLocaleTimeString([], { hour12: false });

/* ---------------------------- Small utilities ---------------------------- */
const fmtBytes = (n) => {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const secs = (ms) => Math.max(0, Math.round(ms / 1000));
const fmtClock = (s) => {
  const ss = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(ss / 60);
  const r = ss % 60;
  return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Office helpers (DOCX/XLSX/PPTX) ---
const isOfficeDoc = (file) => {
  if (!file) return false;
  const name = (file.name || "").toLowerCase();
  return name.endsWith(".docx") || name.endsWith(".xlsx") || name.endsWith(".pptx");
};
const extToMime = (ext) => {
  const e = (ext || "").toLowerCase();
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "gif") return "image/gif";
  if (e === "bmp") return "image/bmp";
  if (e === "webp") return "image/webp";
  if (e === "tif" || e === "tiff") return "image/tiff";
  return "application/octet-stream";
};
async function extractFromOffice(file, addLogCb) {
  try {
    const zip = await JSZip.loadAsync(file);
    const mediaRoots = ["word/media/", "xl/media/", "ppt/media/"];
    const out = [];
    const keys = Object.keys(zip.files).filter((k) =>
      mediaRoots.some((root) => k.startsWith(root))
    );
    for (const k of keys) {
      const entry = zip.file(k);
      if (!entry) continue;
      const blob = await entry.async("blob");
      const basename = k.split("/").pop() || "image.bin";
      const ext = basename.includes(".") ? basename.split(".").pop() : "bin";
      const mime = extToMime(ext);
      // prefix with original doc name for clarity
      const prefix = (file.name || "document").replace(/\.[^.]+$/, "");
      const fname = `${prefix}-${basename}`;
      out.push(new File([blob], fname, { type: mime }));
    }
    addLogCb?.(`Extracted ${out.length} photo(s) from ${file.name}`);
    return out;
  } catch (e) {
    console.error("extractFromOffice error:", e);
    addLogCb?.(`Failed to extract images from ${file.name}`);
    return [];
  }
}

/* --------------------------------- View --------------------------------- */
export default function Upload() {
  const nav = useNavigate();

  // selections
  const [files, setFiles] = useState([]);      // File[]
  const [urls, setUrls] = useState([]);        // blob preview URLs

  // pipeline
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("idle");  // idle|uploading|analyzing|merging|finalizing|done|error
  const [progress, setProgress] = useState(0); // 0..100
  const [uploadPct, setUploadPct] = useState(0);
  const [analysisPct, setAnalysisPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  // activity log + stage timing
  const [logs, setLogs] = useState([]);           // [{t,msg}]
  const uploadStartRef = useRef(0);
  const analysisStartRef = useRef(0);
  const analysisEstMsRef = useRef(0);
  const addLog = (msg) => setLogs((l) => { if (l.length && l[l.length - 1].msg === msg) return l; return [...l, { t: ts(), msg }].slice(-200); });

  // telemetry
  const t0 = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState([]);  // sparkline [{t, p}]
  // countdown + dedup helpers
  const [countdownSec, setCountdownSec] = useState(0);
  const lastLoggedUploadPctRef = useRef(-5);
  const lastLoggedAnalysisPctRef = useRef(-5);
  const tickerRef = useRef(null);

  // per-file status (queued|uploading|analyzing|done)
  const [fStatus, setFStatus] = useState([]);

  // Upload telemetry (Safari can batch progress; estimate rate ourselves)
  const uploadLoadedRef = useRef(0);       // last known uploaded bytes
  const uploadLastTsRef = useRef(0);       // last timestamp we measured
  const uploadRateRef = useRef(0);         // smoothed bytes/sec

  // total size + byte offsets (to infer which files finished uploading)
  const totalBytes = useMemo(() => files.reduce((s, f) => s + (f.size || 0), 0), [files]);
  const byteOffsets = useMemo(() => {
    let acc = 0;
    return files.map((f) => {
      const start = acc;
      acc += f.size || 0;
      return { start, end: acc };
    });
  }, [files]);

  // build previews
  useEffect(() => {
    const list = files.map((f) => URL.createObjectURL(f));
    setUrls(list);
    setFStatus(files.map(() => "queued"));
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  // live elapsed + sparkline
  useEffect(() => {
    if (!busy) return;
    t0.current = Date.now();
    let raf;
    const tick = () => {
      const e = Date.now() - t0.current;
      setElapsed(e);
      setHistory((h) => {
        const next = [...h, { t: e, p: progress }];
        return next.length > 140 ? next.slice(-140) : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [busy, progress]);

  // layout helpers
  const dzRef = useRef(null);
  const onBrowse = () => !busy && dzRef.current?.click();
  const onDrop = (e) => {
    e.preventDefault();
    if (busy) return;
    const incoming = Array.from(e.dataTransfer.files || []).filter(
      (f) => (f.type && f.type.startsWith("image/")) || isOfficeDoc(f)
    );
    if (incoming.length) addFiles(incoming);
  };
  const addFiles = async (incoming) => {
    // Expand Office files into images
    let expanded = [];
    for (const f of incoming) {
      if (isOfficeDoc(f)) {
        addLog(`Parsing ${f.name}…`);
        const imgs = await extractFromOffice(f, addLog);
        expanded.push(...imgs);
      } else if (f.type?.startsWith("image/")) {
        expanded.push(f);
      }
    }
    if (expanded.length === 0) return;
    setFiles((prev) => {
      const room = Math.max(0, 100 - prev.length);
      const next = [...prev, ...expanded.slice(0, room)];
      if (expanded.length > room) addLog(`Reached limit: kept ${room} of ${expanded.length} file(s).`);
      return next;
    });
  };
  const removeAt = (idx) => {
    if (busy) return;
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // derived for display only (we still post once)
  const batchSize = 8;
  const totalBatches = Math.max(1, Math.ceil(files.length / batchSize));

  // ETA that adapts by stage
  const eta = useMemo(() => {
    if (!busy) return "—";
    if (stage === "uploading") {
      const elapsedMs = Date.now() - (uploadStartRef.current || Date.now());
      if (uploadPct < 1 || elapsedMs < 500) return "—";
      const rate = uploadPct / Math.max(1, elapsedMs); // % per ms
      const remainingMs = (100 - uploadPct) / rate;
      return `${secs(remainingMs)}s`;
    }
    if (stage === "analyzing") {
      const elapsedMs = performance.now() - (analysisStartRef.current || performance.now());
      const remainingMs = Math.max(0, (analysisEstMsRef.current || 0) - elapsedMs);
      return remainingMs ? `${secs(remainingMs)}s` : "—";
    }
    if (stage === "merging" || stage === "finalizing") {
      return "<10s";
    }
    return "—";
  }, [busy, stage, uploadPct]);

  // 1s ticker: update countdown + stage heartbeat logs
  useEffect(() => {
    if (!busy) return;
    if (tickerRef.current) clearInterval(tickerRef.current);
    const messages = {
      uploading: [
        "Negotiating TLS…", "Chunking images…", "Streaming payload…",
        "Verifying checksums…", "Server acknowledged parts…"
      ],
      analyzing: [
        "Dispatching to vision model…", "Applying safety rules…",
        "Detecting hazards…", "Scoring findings…", "Aggregating batch output…"
      ],
      merging: [
        "Compacting JSON…", "Merging batches…", "Validating schema…"
      ],
      finalizing: [
        "Generating thumbnails…", "Sealing report payload…"
      ],
    };
    let beat = 0;
    tickerRef.current = setInterval(() => {
      // countdown calc
      let left = 0;
      if (stage === "uploading") {
        // Prefer byte-based countdown so it works even when browsers batch progress events
        const loaded = uploadLoadedRef.current || 0;
        const remainingBytes = Math.max(0, totalBytes - loaded);
        // Fallback to a conservative default if we haven't measured a rate yet
        const DEFAULT_BPS = 5 * 1024 * 1024; // ~5 MB/s local/LAN feel
        const bps = uploadRateRef.current > 1024 ? uploadRateRef.current : DEFAULT_BPS;
        left = Math.round(remainingBytes / bps);
      } else if (stage === "analyzing") {
        const elapsedMs = performance.now() - (analysisStartRef.current || performance.now());
        const remMs = Math.max(0, (analysisEstMsRef.current || 0) - elapsedMs);
        left = Math.round(remMs / 1000);
      } else if (stage === "merging" || stage === "finalizing") {
        left = 10;
      } else {
        left = 0;
      }
      setCountdownSec(left);

      // heartbeat logs (varied, de-duped by addLog)
      const pool = messages[stage] || [];
      if (pool.length) {
        const msg = pool[beat % pool.length];
        addLog(msg);
        beat += 1;
      }
    }, 1000);
    return () => clearInterval(tickerRef.current);
  }, [busy, stage, uploadPct, totalBytes]);

  /* ------------------------------ Main action ------------------------------ */
  const analyze = async () => {
    if (!files.length || busy) return;

    setBusy(true);
    setStage("uploading");
    setErrorMsg("");
    setProgress(0);
    setUploadPct(0);
    setAnalysisPct(0);
    setHistory([]);
    setElapsed(0);
    setFStatus((s) => s.map(() => "uploading"));

    // Kick off a countdown immediately based on a conservative default upload rate,
    // so the timer doesn't wait for the first onUploadProgress tick.
    const DEFAULT_BPS_BOOT = 5 * 1024 * 1024; // ~5 MB/s baseline
    if (totalBytes > 0) {
      const bootSec = Math.ceil(totalBytes / DEFAULT_BPS_BOOT);
      setCountdownSec(bootSec);
    } else {
      setCountdownSec(0);
    }

    setLogs([]);
    addLog(`Queued ${files.length} image(s) totaling ${fmtBytes(totalBytes)}`);

    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("photos", f));

      uploadStartRef.current = Date.now();
      // reset upload telemetry
      uploadLoadedRef.current = 0;
      uploadLastTsRef.current = Date.now();
      uploadRateRef.current = 0;
      addLog("Starting upload → /api/analyze");

      // upload with progress
      const { data } = await api.post("/api/analyze", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (pe) => {
          if (!pe.total) return;
          // Track smoothed upload rate for better ETA/countdown (works even if Safari batches events)
          const now = Date.now();
          if (uploadLastTsRef.current === 0) uploadLastTsRef.current = now;
          const dt = Math.max(1, now - uploadLastTsRef.current);         // ms
          const dBytes = Math.max(0, pe.loaded - uploadLoadedRef.current);
          const instBps = (dBytes * 1000) / dt;                           // bytes/sec
          // Exponential moving average to smooth spikes
          uploadRateRef.current = uploadRateRef.current
            ? (uploadRateRef.current * 0.8 + instBps * 0.2)
            : instBps;
          uploadLoadedRef.current = pe.loaded;
          uploadLastTsRef.current = now;

          const pct = Math.round((pe.loaded / pe.total) * 100);
          setUploadPct(pct);

          // less spammy threshold logging
          if (pct - lastLoggedUploadPctRef.current >= 5) {
            addLog(`Upload ${pct}%`);
            lastLoggedUploadPctRef.current = pct;
          }

          setFStatus((arr) =>
            arr.map((st, i) => (st === "uploading" && pe.loaded >= byteOffsets[i].end ? "analyzing" : st))
          );

          setProgress((prev) => Math.max(prev, Math.round(0.6 * pct)));
        },
      });

      addLog("Upload complete; beginning analysis batches");

      setStage("analyzing");
      analysisStartRef.current = performance.now();
      analysisEstMsRef.current = estimateAnalysisMs(files.length, totalBatches);
      await simulateAnalysis(files.length, totalBatches, setAnalysisPct, setProgress, setFStatus, addLog);

      addLog("Analysis complete; merging JSON chunks");
      setStage("merging");
      await sleep(300);
      setProgress((p) => Math.max(p, 97));

      addLog("Generating report payload");
      setStage("finalizing");
      await sleep(250);
      setProgress(100);

      // persist & go
      localStorage.setItem("iship_results", JSON.stringify(data));
      setStage("done");
      setBusy(false);
      nav("/summary");
    } catch (err) {
      console.error(err);
      addLog(`Error: ${err?.response?.data?.error || err?.message || "Analysis failed"}`);
      setStage("error");
      setBusy(false);
      setErrorMsg(err?.response?.data?.error || err?.message || "Analysis failed");
    }
  };

  // deterministic-looking analysis ticker
  async function simulateAnalysis(count, batches, setPct, setOverall, setStatus, logCb) {
    const base = 900;         // base per-batch cost
    const perImg = 400;       // per image
    const est = count * perImg + batches * base;
    const start = performance.now();

    for (let b = 1; b <= batches; b++) {
      const stepStart = performance.now();
      const inBatch = Math.min(batchSize, count - (b - 1) * batchSize);
      const stepDur = base + inBatch * perImg;

      if (logCb) logCb(`Batch ${b}/${batches}: analyzing ${inBatch} image(s)`);

      // mark batch analyzing
      setStatus((arr) =>
        arr.map((st, idx) => {
          const i0 = (b - 1) * batchSize;
          const i1 = Math.min(count, b * batchSize);
          if (idx >= i0 && idx < i1 && st !== "done") return "analyzing";
          return st;
        })
      );

      // tick “engine” %. Overall maps 60→96
      while (performance.now() - stepStart < stepDur) {
        const elapsed = performance.now() - start;
        const enginePct = clamp((elapsed / est) * 100, 0, 100);
        const pctInt = Math.round(enginePct);
        setPct(pctInt);
        if (pctInt - lastLoggedAnalysisPctRef.current >= 5) {
          addLog(`Analysis ${pctInt}%`);
          lastLoggedAnalysisPctRef.current = pctInt;
        }
        setOverall(Math.round(60 + (enginePct * 36) / 100));
        await sleep(45);
      }

      // batch completes
      setStatus((arr) => {
        const i0 = (b - 1) * batchSize;
        const i1 = Math.min(count, b * batchSize);
        return arr.map((st, i) => (i >= i0 && i < i1 ? "done" : st));
      });
      if (logCb) logCb(`Batch ${b}/${batches}: complete`);
    }
  }

  function estimateAnalysisMs(count, batches) {
    const base = 900;
    const perImg = 400;
    return batches * base + count * perImg;
  }

  /* -------------------------------- Render -------------------------------- */
  return (
    <section className="min-h-[calc(100vh-5rem)] bg-gradient-to-b from-white via-[#eef5fb] to-[#eef5fb] py-10">
      <div className="max-w-7xl mx-auto px-4 lg:px-6 grid lg:grid-cols-[380px,1fr] gap-6">
        {/* LEFT: Guidelines + stage stepper */}
        <aside className="space-y-6">
          <div className="rounded-3xl bg-white/70 backdrop-blur-2xl border border-slate-200/70 shadow-[0_10px_40px_-10px_rgba(2,6,23,0.08)] p-6">
            <h1 className="text-2xl font-semibold text-slate-900">Upload & Analyze</h1>
            <p className="text-sm text-slate-600 mt-1">
              Add up to <strong>100</strong> images. We’ll batch them behind the scenes, run
              analysis, and compile a structured report for editing and export.
            </p>
            <ul className="mt-4 space-y-3 text-sm text-slate-700">
              <li className="flex items-center gap-2">
                <Dot className="text-[#2f6da3]" /> JPEG, PNG, HEIC supported
              </li>
              <li className="flex items-center gap-2">
                <Dot className="text-[#2f6da3]" /> Large sets are chunked automatically
              </li>
              <li className="flex items-center gap-2">
                <Dot className="text-[#2f6da3]" /> Remove is disabled once analysis starts
              </li>
            </ul>
          </div>

          <StagePanel
            stage={stage}
            progress={progress}
            uploadPct={uploadPct}
            analysisPct={analysisPct}
            batches={totalBatches}
            elapsed={secs(elapsed)}
            eta={eta}
            logs={logs}
            errorMsg={errorMsg}
          />
        </aside>

        {/* RIGHT: Dropzone + controls + gallery */}
        <main className="space-y-6">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="rounded-3xl bg-white/70 backdrop-blur-2xl border border-slate-200/70 shadow-[0_10px_40px_-10px_rgba(2,6,23,0.08)] p-6 md:p-8"
          >
            <div className="rounded-2xl border-2 border-dashed border-slate-300/70 bg-white/60 p-8 text-center">
              <input
                ref={dzRef}
                type="file"
                accept="image/*,.docx,.xlsx,.pptx"
                multiple
                hidden
                onChange={(e) => addFiles(Array.from(e.target.files || []))}
              />
              <div className="flex flex-col items-center">
                <Cloud />
                <p className="mt-3 text-slate-700 font-medium">
                  Drag & drop images here
                </p>
                <p className="text-xs text-slate-500">or</p>
                <button
                  onClick={onBrowse}
                  disabled={busy}
                  className="mt-3 inline-flex items-center rounded-xl px-4 py-2 text-white bg-gradient-to-r from-[#2f6da3] to-[#1f5c93] shadow transition hover:shadow-md disabled:opacity-50"
                >
                  Browse files
                </button>
              </div>
            </div>

            {/* Controls */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={analyze}
                disabled={!files.length || busy}
                className="rounded-xl bg-slate-900 text-white px-5 py-2.5 font-semibold shadow hover:bg-slate-800 disabled:opacity-40"
              >
                {busy ? "Analyzing…" : "Analyze"}
              </button>
              <button
                onClick={() => setFiles([])}
                disabled={busy || !files.length}
                className="rounded-xl border border-slate-300/70 bg-white/50 px-5 py-2.5 text-slate-800 hover:bg-white disabled:opacity-40"
              >
                Clear
              </button>
              {!!files.length && (
                <span className="ml-auto text-xs text-slate-600">
                  {files.length} selected • {fmtBytes(totalBytes)}
                </span>
              )}
            </div>
          </div>

          {/* File Gallery */}
          {files.length > 0 && (
            <div className="rounded-3xl bg-white/70 backdrop-blur-2xl border border-slate-200/70 shadow-[0_10px_40px_-10px_rgba(2,6,23,0.08)] p-4 md:p-6">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Queue</h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {files.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                  >
                    {/* image */}
                    <div className="h-40 w-full bg-slate-100">
                      <img
                        src={urls[i]}
                        alt={f.name}
                        className="h-full w-full object-cover"
                        onError={(e) => (e.currentTarget.style.display = "none")}
                      />
                    </div>

                    {/* meta */}
                    <div className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-slate-900 truncate pr-2">
                          {i + 1}. {f.name}
                        </div>
                        <StatusPill value={fStatus[i]} />
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{fmtBytes(f.size)}</div>
                    </div>

                    {/* remove */}
                    {!busy && (
                      <button
                        onClick={() => removeAt(i)}
                        className="absolute top-2 right-2 text-xs px-2.5 py-1.5 rounded-lg bg-white/90 text-slate-900 border border-slate-200 shadow-sm hover:bg-white"
                      >
                        Remove
                      </button>
                    )}
                    {busy && fStatus[i] !== "done" && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-sky-200">
                        <div className="h-1 bg-indigo-500/90 transition-all" style={{ width: fStatus[i] === "analyzing" ? "70%" : "35%" }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* page-level styles */}
      <style>{`
        @keyframes barSlide { from { width: 0% } to { width: 100% } }
      `}</style>
    </section>
  );
}

/* --------------------------------- Parts -------------------------------- */
function Dot({ className = "" }) {
  return (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${className}`} />
  );
}

function Cloud() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" className="text-slate-400">
      <path
        fill="currentColor"
        d="M6 14a4 4 0 0 1 .88-2.5a4.5 4.5 0 1 1 8.52-2A3.5 3.5 0 1 1 18.5 17H7a3 3 0 0 1-1-5.83A4 4 0 0 1 6 14Z"
        opacity=".45"
      />
      <path
        fill="currentColor"
        d="M12 7v6m0 0l-2-2m2 2l2-2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusPill({ value }) {
  const map = {
    queued:    { label: "Queued",     cls: "bg-slate-100 text-slate-700 border-slate-200" },
    uploading: { label: "Uploading",  cls: "bg-[#e8f2fb] text-[#2f6da3] border-[#cfe2f6]" },
    analyzing: { label: "Analyzing",  cls: "bg-[#edf1ff] text-[#3b5ccc] border-[#d9e0ff]" },
    done:      { label: "Ready",      cls: "bg-[#e7f0ff] text-[#255a87] border-[#cfe2ff]" },
  };
  const m = map[value] || map.queued;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full border ${m.cls}`}>
      {m.label}
    </span>
  );
}

function StagePanel({ stage, progress, uploadPct, analysisPct, batches, elapsed, eta, logs, errorMsg }) {
  const logRef = useRef(null);
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [logs]);
  const stages = [
    { key: "uploading",  label: "Queued → Uploading" },
    { key: "analyzing",  label: "Analyzing" },
    { key: "merging",    label: "Merging" },
    { key: "finalizing", label: "Finalizing" },
  ];
  const activeIdx = Math.max(0, stages.findIndex(s => s.key === stage));

  return (
    <div className="rounded-3xl bg-white/70 backdrop-blur-2xl border border-slate-200/70 shadow-[0_10px_40px_-10px_rgba(2,6,23,0.08)] p-6">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">Pipeline</h3>

      {/* Stepper */}
      <ol className="flex flex-wrap gap-2">
        {stages.map((s, i) => {
          const active = i <= activeIdx || stage === "done";
          return (
            <li key={s.key}
              className={`px-3 py-1 rounded-full text-xs border transition 
                ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300 text-slate-700"}`}>
              {s.label}
            </li>
          );
        })}
      </ol>

      {/* Overall bar */}
      <div className="mt-4">
        <div className="h-3 w-full rounded-full bg-slate-200 overflow-hidden">
          <div
            className="h-3 bg-gradient-to-r from-[#2f6da3] to-[#1f5c93] transition-[width] duration-300 ease-out"
            style={{ width: `${clamp(progress, 0, 100)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
          <span>{stage === "uploading" ? `Uploading payload (${uploadPct}%)` :
                 stage === "analyzing" ? `Analysis engine (${analysisPct}%)` :
                 stage === "merging" ? "Merging results" :
                 stage === "finalizing" ? "Finalizing artifacts" :
                 stage === "done" ? "Complete" : "Idle"}</span>
          <span>Elapsed {elapsed}s • ETA {eta}</span>
        </div>
      </div>

      {/* Sub-bars */}
      <div className="mt-3 space-y-2">
        <Subbar label="Uploading" value={uploadPct} />
        <Subbar label={`Analysis (${batches} batch${batches>1?"es":""})`} value={analysisPct} light />
      </div>

      {/* Activity log */}
      <div className="mt-3">
        <div className="text-xs font-medium text-slate-700 mb-1">Activity</div>
        <div ref={logRef} className="h-28 overflow-auto rounded-lg border border-slate-200 bg-white/80 p-2 text-[11px] font-mono text-slate-700">
          {logs.length === 0 ? (
            <div className="text-slate-400">Awaiting actions…</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="whitespace-nowrap">
                <span className="text-slate-400">[{l.t}]</span> {l.msg}
              </div>
            ))
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="mt-3 text-sm text-rose-600">{errorMsg}</div>
      )}
    </div>
  );
}

function Subbar({ label, value, light = false }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
        <span>{label}</span>
        <span>{Math.round(value)}%</span>
      </div>
      <div className={`h-2 rounded-full ${light ? "bg-slate-100" : "bg-slate-200"} overflow-hidden`}>
        <div
          className={`h-2 ${light ? "bg-[#79a8d8]" : "bg-[#2f6da3]"} transition-[width] duration-300 ease-out`}
          style={{ width: `${clamp(value, 0, 100)}%` }}
        />
      </div>
    </div>
  );
}
