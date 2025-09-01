import React from "react";
import { Link } from "react-router-dom";

/**
 * Full-width, white landing page.
 * - No external libraries (pure Tailwind)
 * - Subtle motion via CSS keyframes (built inline)
 * - Right preview card shows a light grid + mini KPI row
 * - Primary CTA routes to /upload
 */
export default function Landing() {
  return (
    <div className="w-full bg-white text-slate-900">
      {/* Determine a hero image: use first analyzed upload if available; otherwise fallback to a static sample in /public */}
      {(() => {})()}

      <style>{`
        :root{
          --brand-50:#e8f1f7;
          --brand-100:#d7e7f1;
          --brand-500:#3e7695;
          --brand-600:#2f6d8f;
          --brand-700:#265a75;
          --brand-grad-start:#8fb6d1;
          --brand-grad-end:#2f6d8f;
        }
        .btn-brand{ background:var(--brand-600); color:#fff;}
        .btn-brand:hover{ background:var(--brand-700);}
        .icon-brand{ color:var(--brand-600);}
        .chip-brand{ background:var(--brand-50); border:1px solid var(--brand-100);}
        /* --- shimmer + motion utilities --- */
        /* headline ink underline that supports wrapping without shifting layout */
        .ink-underline{
          /* sleeker, darker blue band; thinner so copy stays readable */
          background-image: linear-gradient(90deg, var(--brand-grad-start) 0%, var(--brand-grad-end) 100%);
          background-repeat: no-repeat;
          background-size: 100% .32em;        /* thinner underline */
          background-position: 0 88%;          /* sits under glyphs without touching */
          box-decoration-clone: clone;
          border-radius: .2em;
          padding: 0 .04em;
        }
        @media (hover:hover){
          .ink-underline:hover{ background-size: 100% .56em; }  /* subtle grow on hover */
        }

        @keyframes shimmer {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(120%); }
        }
        .shimmer {
          background: linear-gradient(90deg,#ffffff00 0%,#f5f5f5 50%,#ffffff00 100%);
          animation: shimmer 2.4s infinite linear;
        }
        @keyframes breathe { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        .breathe { animation:breathe 3.6s ease-in-out infinite; }

        /* sweeping shine overlay for the hero preview */
        .shine-sweep { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
        .shine-sweep::before {
          content: "";
          position: absolute; inset: -10%;
          background: linear-gradient(115deg, rgba(255,255,255,0) 35%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 65%);
          transform: translateX(-120%);
          animation: shimmer 3.6s infinite ease-in-out;
        }
        /* flowing wave shimmer over the hero image */
        @keyframes waveSweep {
          0%   { transform: translateX(-120%) translateY(-10%) rotate(12deg); opacity: .0; }
          15%  { opacity: .55; }
          50%  { opacity: .35; }
          100% { transform: translateX(120%) translateY(10%) rotate(12deg); opacity: 0; }
        }
        .shine-wave {
          position: absolute;
          inset: -20%;
          pointer-events: none;
          overflow: hidden;
        }
        .shine-wave::before,
        .shine-wave::after {
          content: "";
          position: absolute;
          top: 0; left: -50%;
          width: 70%;
          height: 140%;
          filter: blur(14px);
          background: linear-gradient(115deg, rgba(255,255,255,0) 35%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 65%);
          transform: translateX(-120%) rotate(12deg);
          animation: waveSweep 3.8s ease-in-out infinite;
        }
        /* stagger a second ray for a richer wave look */
        .shine-wave::after {
          top: 10%;
          left: -60%;
          width: 60%;
          height: 130%;
          opacity: .75;
          animation-delay: 1.1s;
        }
        /* --- polish: subtle float, vignette and glow helpers --- */
        @keyframes floatUp {
          0% { transform: translateY(0) }
          50% { transform: translateY(-6px) }
          100% { transform: translateY(0) }
        }
        .float { animation: floatUp 8s ease-in-out infinite }
        .card-glow { box-shadow: 0 14px 40px rgba(2,6,23,.07), 0 3px 8px rgba(2,6,23,.05); }
        .card-glow-dark { box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 6px 18px rgba(0,0,0,.35); }
        .card-glow-light { box-shadow: 0 20px 50px rgba(2,6,23,.08), 0 4px 10px rgba(2,6,23,.05); }
        .ring-soft { box-shadow: inset 0 0 0 1px rgba(2,6,23,.08); }
        .vignette::after{
          content:"";
          position:absolute; inset:0;
          background: radial-gradient(120% 120% at 50% 60%, rgba(0,0,0,0) 60%, rgba(0,0,0,.18) 100%);
          pointer-events:none;
        }
        /* animated accent underline for the hero keyword */
        .accent-underline{
          background-image: none;
        }
        @media (hover:hover){
          .accent-underline:hover{ background-position: 0 88%; background-size: 100% .75em; }
        }
        /* make grid lines slightly softer */
        .grid-soft path{ opacity:.28 }
      `}</style>

      {(() => {
        const stored = JSON.parse(localStorage.getItem("iship_results") || "{}");
        const firstId = stored?.results?.per_image?.[0]?.id;
        const uploaded = firstId ? `http://localhost:5000/uploads/${encodeURIComponent(firstId)}` : null;
        // Fallback image placed in /public (e.g., public/hero-sample.jpg). Safe if the file doesn't exist—PreviewCard will still render.
        const fallback = "/hero-sample.jpg";
        Landing.__fallbackImg = fallback;
        // Expose to JSX via a closure variable on window-less scope
        Landing.__heroImgSrc = uploaded || fallback;
        return null;
      })()}

      {/* HERO */}
      <section className="w-full pt-8 md:pt-12 lg:pt-14">
        <div className="w-full">
          <div className="mx-auto w-full max-w-7xl px-6 sm:px-10 lg:px-12">
            {/* 12-col grid for tighter alignment */}
            <div className="grid grid-cols-1 lg:grid-cols-12 items-center gap-10 lg:gap-12 py-8 lg:py-10">
              {/* Left copy */}
              <div className="relative z-10 lg:col-span-7 max-w-2xl">
                <div className="text-xs font-medium text-gray-500 tracking-wide mb-3">
                  iShip Inspection AI
                </div>

                <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.05] tracking-tight">
                  <span className="text-slate-900">Turn vessel photos into a</span>{" "}
                  <span className="ink-underline text-slate-900">structured safety report</span>{" "}
                  <span className="text-slate-900">— in minutes.</span>
                </h1>

                <p className="mt-4 max-w-2xl text-gray-600 text-sm sm:text-base">
                  Upload up to 100 images. Our vision engine flags fire and trip/fall
                  hazards with rule-based accuracy, adds inspector-style comments, and
                  generates an editable .docx report.
                </p>

                {/* quick facts */}
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <StatCard
                    label="Avg. time per 10 photos"
                    value="~90s"
                    icon={
                      <svg viewBox="0 0 24 24" className="h-5 w-5 icon-brand">
                        <path fill="currentColor" d="M12 8a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H8a1 1 0 1 1 0-2h3V9a1 1 0 0 1 1-1z"></path>
                        <path fill="currentColor" d="M12 22a10 10 0 1 0-10-10 10.01 10.01 0 0 0 10 10zm0-2a8 8 0 1 1 8-8 8.009 8.009 0 0 1-8 8z"></path>
                      </svg>
                    }
                  />
                  <StatCard
                    label="Auto-tag accuracy (rules)"
                    value="High"
                    icon={
                      <svg viewBox="0 0 24 24" className="h-5 w-5 icon-brand">
                        <path fill="currentColor" d="M9 16.17 4.83 12 3.41 13.41 9 19l12-12-1.41-1.41L9 16.17z"></path>
                      </svg>
                    }
                  />
                  <StatCard
                    label="Report format"
                    value=".docx / on-screen"
                    icon={
                      <svg viewBox="0 0 24 24" className="h-5 w-5 icon-brand">
                        <path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 2 4 4h-4z"></path>
                      </svg>
                    }
                  />
                </div>

                <div className="mt-6 flex items-center gap-3">
                  <Link
                    to="/upload"
                    className="breathe inline-flex items-center justify-center rounded-xl px-5 py-3 btn-brand transition shadow-md"
                  >
                    Upload photos →
                  </Link>
                </div>
              </div>

              {/* Right preview card */}
              <div className="lg:col-span-5 w-full max-w-[520px] mx-auto">
                <PreviewCard primarySrc={Landing.__heroImgSrc} fallbackSrc={Landing.__fallbackImg} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="w-full border-t bg-brand-50">
        <div className="mx-auto w-full px-6 sm:px-10 lg:px-16 2xl:px-24 py-10 rounded-2xl shadow-sm bg-white/70 backdrop-blur-sm">
          <h2 className="text-xl font-semibold mb-6 text-slate-800">How it works</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <Step
              n="1"
              title="Upload photos"
              body="Drag & drop up to 100 images. We chunk them automatically and start the pipeline right away."
            />
            <Step
              n="2"
              title="Auto-analysis"
              body="Vision tags hazards per image (fire / trip-fall / none), extracts ship-area hints, and drafts inspector-style comments."
            />
            <Step
              n="3"
              title="Review & export"
              body="Edit inline on the summary page, then export a clean .docx report to share or archive."
            />
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="w-full border-t border-gray-200">
        <div className="mx-auto w-full px-6 sm:px-10 lg:px-16 2xl:px-24 py-8 text-sm text-gray-600 flex items-center justify-between">
          <span>© {new Date().getFullYear()} iShip Inspection AI</span>
          <div className="flex gap-5">
            <a className="hover:text-gray-900" href="/upload">Start</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ---------- small pieces ---------- */

function StatCard({ label, value, icon }) {
  return (
    <div className="relative rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-transform duration-200 hover:-translate-y-0.5 p-5 min-h-[112px] flex items-center gap-3">
      {icon ? (
        <div className="shrink-0 h-10 w-10 rounded-xl chip-brand flex items-center justify-center">
          {icon}
        </div>
      ) : null}
      <div className="flex-1">
        <div className="text-[12px] tracking-wide text-slate-600">{label}</div>
        <div className="mt-0.5 text-xl font-semibold leading-snug tracking-tight text-slate-900">{value}</div>
      </div>
      <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-slate-200/60"></span>
    </div>
  );
}

function Step({ n, title, body }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-600)] text-white text-sm font-extrabold shadow-sm">
          {n}
        </span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="mt-3 text-gray-600 text-sm">{body}</p>
    </div>
  );
}

function PreviewCard({ primarySrc, fallbackSrc }) {
  const [src, setSrc] = React.useState(primarySrc || fallbackSrc);

  // If the prop changes (e.g., localStorage gets populated later), sync it
  React.useEffect(() => {
    setSrc(primarySrc || fallbackSrc);
  }, [primarySrc, fallbackSrc]);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white/80 backdrop-blur-sm card-glow p-5 float lg:hover:-translate-y-1 transition mx-auto">
      <div className="rounded-2xl border border-gray-200 bg-gray-50/80 overflow-hidden">
        <div className="relative aspect-[4/3] rounded-xl overflow-hidden ring-soft">
          {src ? (
            <>
              <img
                src={src}
                alt="Preview"
                className="absolute inset-0 h-full w-full object-cover"
                style={{filter:'saturate(1.05) contrast(1.05)'}}
                onError={(e) => {
                  // swap to fallback only once
                  if (src !== fallbackSrc) setSrc(fallbackSrc);
                }}
              />
              {/* soft vignette for depth */}
              <div className="absolute inset-0 vignette"></div>
              {/* subtle grid overlay to keep the product aesthetic */}
              <svg
                className="absolute inset-0 h-full w-full mix-blend-normal text-slate-700/20 grid-soft pointer-events-none"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <defs>
                  <pattern id="grid2" width="10" height="10" patternUnits="userSpaceOnUse">
                    <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth=".25" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid2)" />
              </svg>
              {/* sweeping shine */}
              <div className="shine-sweep" />
              <div className="shine-wave" />
              {/* live sample caption */}
              <div className="absolute left-3 top-3 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/85 text-slate-800 border border-white shadow-sm">
                Live sample
              </div>
            </>
          ) : (
            <>
              {/* fallback grid if no image */}
              <svg
                className="absolute inset-0 h-full w-full text-white/20 grid-soft"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <defs>
                  <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                    <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth=".28" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
            </>
          )}
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-3 text-center text-[13px] text-slate-900/90 border-t border-slate-200">
          <div className="py-3">
            <div className="text-xs text-gray-500">Fire hazards</div>
            <div className="font-semibold">1</div>
          </div>
          <div className="py-3 border-l border-gray-200">
            <div className="text-xs text-gray-500">Trip / fall</div>
            <div className="font-semibold">0</div>
          </div>
          <div className="py-3 border-l border-gray-200">
            <div className="text-xs text-gray-500">No issues</div>
            <div className="font-semibold">23</div>
          </div>
        </div>
      </div>
    </div>
  );
}