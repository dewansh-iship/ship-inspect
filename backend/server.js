import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import cookieParser from 'cookie-parser';
import { azureClient } from './azureClient.js';
import { SYSTEM_PROMPT, CHECK_PROMPT } from './prompt.js';
import { fileToDataUrl, ensureDir } from './utils.js';
import { buildDocxReport } from './report.js';
import { jsonrepair } from 'jsonrepair';
import { magicAuthRouter, requireSession } from './magicAuth.js';



function enforceRulesOnItem(it) {
  const fh = it.tags?.fire_hazard || {};
  const tf = it.tags?.trip_fall || {};
  const anyFire = !!(fh.combustibles || fh.open_wiring || fh.oil_leak || fh.uninsulated_hot_surface);
  const anyTrip = !!(tf.obstructed_walkway || tf.blocked_passage || tf.broken_railing || tf.unmarked_pipeline || tf.slippery_surface);
  const rust = it.tags?.rust_stains === true;

  // Decide condition
  if (anyFire) it.condition = 'fire_hazard';
  else if (anyTrip) it.condition = 'trip_fall';
  else it.condition = 'none';

  // Severity logic
  if (it.condition === 'fire_hazard') {
    if (fh.open_wiring || fh.oil_leak || fh.uninsulated_hot_surface) it.severity = 'high';
    else it.severity = 'medium';
  } else if (it.condition === 'trip_fall') {
    it.severity = it.severity === 'high' ? 'high' : 'medium';
  } else if (rust) {
    it.severity = 'low'; // rust alone isn’t a hazard but worth noting
  } else {
    it.severity = 'low';
  }

  // Reset recommendations (only if hazard exists)
  it.recommendations_high_severity_only = [];

  // Fire hazard recs
  if (anyFire) {
    if (fh.combustibles) it.recommendations_high_severity_only.push('Remove combustibles or garbage from area.');
    if (fh.open_wiring) it.recommendations_high_severity_only.push('Repair exposed wiring and restore insulation.');
    if (fh.oil_leak) it.recommendations_high_severity_only.push('Stop oil leak, clean spill, and repair source.');
    if (fh.uninsulated_hot_surface) it.recommendations_high_severity_only.push('Install or repair insulation on hot surfaces.');
  }

  // Trip/fall hazard recs
  if (anyTrip) {
    if (tf.obstructed_walkway) it.recommendations_high_severity_only.push('Remove obstruction to clear walkway.');
    if (tf.blocked_passage) it.recommendations_high_severity_only.push('Unblock passage to ensure safe access.');
    if (tf.broken_railing) it.recommendations_high_severity_only.push('Repair or replace broken railing.');
    if (tf.unmarked_pipeline) it.recommendations_high_severity_only.push('Mark pipelines crossing walkway.');
    if (tf.slippery_surface) it.recommendations_high_severity_only.push('Clean or treat slippery surface.');
  }

  // Rust rec
  if (rust) {
    it.recommendations_high_severity_only.push('Clean rust using chemicals or derusting tools (hydroblaster, pneumatic).');
  }

  // Ensure comment isn’t blank or generic
  if (!it.comment || /appears orderly|no observable/i.test(it.comment)) {
    if (anyFire) it.comment = 'Fire hazard noted – check and correct as per safety rules.';
    else if (anyTrip) it.comment = 'Trip/fall hazard noted – remove obstruction or repair railing.';
    else if (rust) it.comment = 'Rust observed – schedule cleaning or derusting.';
    else it.comment = 'Area appears tidy with clear walk path and safe stowage.';
  }

  return it;
}

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001; // <-- 5001
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const BACKEND_BASE = process.env.BACKEND_BASE || `http://localhost:${PORT}`;

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));

// Static serve uploads and reports
const UPLOAD_DIR = path.join(process.cwd(), 'backend', 'uploads');
ensureDir(UPLOAD_DIR);
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/reports', express.static(UPLOAD_DIR));

// Multer: allow up to 100 files, no explicit size limit (depends on disk)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const name = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { files: 100 } });

// Batch to respect Azure vision limit (10 images per request)
const chunk = (arr, size) => arr.reduce((acc, _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), []);

// --- helpers to make model JSON reliable ---
function stripCodeFences(s = "") {
  return s.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/,"");
}
function safeParseJson(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(jsonrepair(text));
    } catch {
      return fallback;
    }
  }
}
function timeoutPromise(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms));
}

app.use(
  '/auth',
  magicAuthRouter({
    jwtSecret: process.env.JWT_SECRET,
    frontendOrigin: FRONTEND_ORIGIN, // REQUIRED by your magicAuth.js
    backendBaseUrl: BACKEND_BASE,       // for building http://localhost:5001/auth/magic?token=...
  })
);

app.post('/api/analyze', requireSession(process.env.JWT_SECRET), upload.array('photos', 100), async (req, res) => {
  try {
    const files = (req.files || []).map(f => ({ id: f.filename, absPath: f.path }));
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    const batches = chunk(files, 8); // Azure vision: max 10 images per request
    const merged = { batch_summary: { fire_hazard_count: 0, trip_fall_count: 0, none_count: 0 }, per_image: [] };

    for (const batch of batches) {
      const userContent = [];
      userContent.push({ type: 'text', text: 'Inspect each image independently and return JSON strictly matching the given schema. Use the provided filename as id.' });
      for (const f of batch) {
        userContent.push({ type: 'text', text: `id: ${f.id}` });
        userContent.push({ type: 'image_url', image_url: { url: fileToDataUrl(f.absPath), detail: 'high' } });
      }

      // ---------- First pass (descriptive + schema) ----------
      const timeoutMs = 60000;
      let response;
      try {
        response = await Promise.race([
          azureClient.chat.completions.create({
            model: process.env.AZURE_OPENAI_DEPLOYMENT,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userContent }
            ],
            temperature: 0,
            top_p: 0.05,
            max_tokens: 2500
          }),
          timeoutPromise(timeoutMs)
        ]);
      } catch (e) {
        console.error('Azure call (first pass) failed:', e);
        throw e;
      }

      const raw = response?.choices?.[0]?.message?.content || "{}";
      console.log('[pass1] raw:', raw.slice(0, 500));
      const firstObj = safeParseJson(stripCodeFences(raw), { per_image: [], batch_summary: { fire_hazard_count: 0, trip_fall_count: 0, none_count: 0 } });
      const firstPass = Array.isArray(firstObj.per_image) ? firstObj.per_image : [];

      // ---------- Second pass (boolean checker only) ----------
      const checkUserContent = [];
      checkUserContent.push({ type: 'text', text: 'Return ONLY the JSON described. Use the given id for each image.' });
      for (const f of batch) {
        checkUserContent.push({ type: 'text', text: `id: ${f.id}` });
        checkUserContent.push({ type: 'image_url', image_url: { url: fileToDataUrl(f.absPath), detail: 'high' } });
      }

      let checkResp;
      try {
        checkResp = await Promise.race([
          azureClient.chat.completions.create({
            model: process.env.AZURE_OPENAI_DEPLOYMENT,
            messages: [
              { role: 'system', content: CHECK_PROMPT },
              { role: 'user', content: checkUserContent }
            ],
            temperature: 0,
            top_p: 0.05,
            max_tokens: 800
          }),
          timeoutPromise(timeoutMs)
        ]);
      } catch (e) {
        console.error('Azure call (second pass) failed:', e);
        throw e;
      }

      const checkRaw = checkResp?.choices?.[0]?.message?.content || "{}";
      console.log('[pass2] raw:', checkRaw.slice(0, 500));
      const checkObj = safeParseJson(stripCodeFences(checkRaw), { per_image: [] });
      const checkMap = new Map((checkObj.per_image || []).map(x => [x.id, x.tags || {}]));

      // ---------- Merge booleans (checker overrides niceness) ----------
      const mergedItems = firstPass.map(item => {
        const copy = { ...item, tags: { ...item.tags } };
        const chk = checkMap.get(item.id);

        if (chk) {
          copy.tags = copy.tags || {};
          copy.tags.fire_hazard = {
            combustibles: !!(copy.tags?.fire_hazard?.combustibles || chk.fire_hazard?.combustibles),
            open_wiring: !!(copy.tags?.fire_hazard?.open_wiring || chk.fire_hazard?.open_wiring),
            oil_leak: !!(copy.tags?.fire_hazard?.oil_leak || chk.fire_hazard?.oil_leak),
            uninsulated_hot_surface: !!(copy.tags?.fire_hazard?.uninsulated_hot_surface || chk.fire_hazard?.uninsulated_hot_surface)
          };
          copy.tags.trip_fall = {
            obstructed_walkway: !!(copy.tags?.trip_fall?.obstructed_walkway || chk.trip_fall?.obstructed_walkway),
            blocked_passage: !!(copy.tags?.trip_fall?.blocked_passage || chk.trip_fall?.blocked_passage),
            broken_railing: !!(copy.tags?.trip_fall?.broken_railing || chk.trip_fall?.broken_railing),
            unmarked_pipeline: !!(copy.tags?.trip_fall?.unmarked_pipeline || chk.trip_fall?.unmarked_pipeline),
            slippery_surface: !!(copy.tags?.trip_fall?.slippery_surface || chk.trip_fall?.slippery_surface)
          };
          // === RUST (strict): require BOTH passes to agree AND textual evidence of corrosion ===
          let rustFlag = (copy.tags?.rust_stains === true) && (chk?.rust_stains === true);
          if (rustFlag) {
            const evidenceText = ((item.comment || "") + " " + (item.description || "")).toLowerCase();
            if (!/\b(rust|corrosion|oxidation|corroded|rusted)\b/.test(evidenceText)) {
              rustFlag = false;
            }
          }
          copy.tags.rust_stains = rustFlag;
        }

        // final enforcement (your existing logic)
        return enforceRulesOnItem(copy);
      });

      // ---------- Merge into batch totals ----------
      merged.per_image.push(...mergedItems);
      merged.batch_summary.fire_hazard_count += mergedItems.filter(x => x.condition === 'fire_hazard').length;
      merged.batch_summary.trip_fall_count += mergedItems.filter(x => x.condition === 'trip_fall').length;
      merged.batch_summary.none_count += mergedItems.filter(x => x.condition === 'none').length;
    }

    res.json({ ok: true, files, results: merged });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

app.post('/api/report', requireSession(process.env.JWT_SECRET), express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const { meta, results } = req.body; // results from /api/analyze
    const imageFiles = (results.per_image || []).map(it => ({ id: it.id, absPath: path.join(UPLOAD_DIR, it.id) }))
      .filter(x => fs.existsSync(x.absPath));

    const outPath = path.join(UPLOAD_DIR, `Vessel_Inspection_Report_${Date.now()}.docx`);
    await buildDocxReport({ meta, results, imageFiles, outPath });
    res.json({ ok: true, url: `/reports/${path.basename(outPath)}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Report generation failed' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));