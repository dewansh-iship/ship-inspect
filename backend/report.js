import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, Media, PageBreak
} from 'docx';
import fs from 'fs';

const H = (text, level=HeadingLevel.HEADING_2) =>
  new Paragraph({ text, heading: level, spacing: { after: 200 } });
const P = (text, opts={}) =>
  new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 120 } });
const Small = (text) => new Paragraph({ children: [new TextRun({ text, size: 18, color: '555555' })]});

const tcell = (text) => new TableCell({ children: [P(text)] });

export async function buildDocxReport({ meta={}, results={}, imageFiles=[], outPath }) {
  const doc = new Document({ sections: [] });
  const per = results.per_image || [];
  const counts = results.batch_summary || { fire_hazard_count:0, trip_fall_count:0, none_count:0 };

  // Helper: display condition (align with the UI rule)
  const displayCond = (it) => {
    const hasRecs = (it.recommendations_high_severity_only || []).length > 0;
    const rust = !!it.tags?.rust_stains;
    if (it.condition === 'none' && rust) return 'Rust';
    if (it.condition === 'none' && hasRecs) return 'Attention';
    if (it.condition === 'fire_hazard') return 'Fire hazard';
    if (it.condition === 'trip_fall') return 'Trip/Fall';
    return 'No issues';
  };

  // 1) Cover Page
  const cover = [
    H('Vessel Inspection Report', HeadingLevel.TITLE),
    P(`Vessel: ${meta.vesselName || ''}`),
    P(`IMO: ${meta.imo || ''}   Flag: ${meta.flag || ''}   Call sign: ${meta.callSign || ''}`),
    P(`Date of inspection: ${meta.date || ''}`),
    P(`Port/Location: ${meta.location || ''}`),
    P(`Inspector: ${meta.inspector || ''}`),
    P(`Report ref: ${meta.reportRef || ''}`)
  ];

  // 2) Executive Summary
  const keyFindings = [];
  if (counts.fire_hazard_count) keyFindings.push(`Fire hazards: ${counts.fire_hazard_count}`);
  if (counts.trip_fall_count) keyFindings.push(`Trip/Fall hazards: ${counts.trip_fall_count}`);
  const rustCount = per.filter(x => x.tags?.rust_stains).length;
  if (rustCount) keyFindings.push(`Rust observations: ${rustCount}`);
  if (counts.none_count) keyFindings.push(`No-issue photos: ${counts.none_count}`);

  const summary = [
    H('Executive Summary'),
    P(meta.summary || 'This report summarizes the visual inspection of key areas onboard.'),
    P(`Overall condition: ${meta.overall || '—'}`),
    P(`Key observations: ${keyFindings.length ? keyFindings.join(' | ') : '—'}`),
    P(`Key recommendations: ${meta.keyRecs || '—'}`)
  ];

  // 3) Inspection Details
  const details = [
    H('Inspection Details'),
    P(`Type: ${meta.type || '—'}`),
    P(`Scope/Areas inspected: Deck, Engine Room, Accommodation, Safety Equipment, Documentation (as applicable)`),
    P(`Methodology: Visual walkthrough with photo evidence. Findings reflect what is visible in supplied images.`)
  ];

  // 4) Vessel Particulars
  const particulars = [
    H('Vessel Particulars'),
    P(`Vessel name: ${meta.vesselName || '—'}`),
    P(`IMO: ${meta.imo || '—'}    Flag: ${meta.flag || '—'}    Call sign: ${meta.callSign || '—'}`),
    P(`(Additional particulars can be added here: type, year, class, DWT/GT, etc.)`)
  ];

  // 5) Defects & Non-Conformities Table
  const highFindings = per.filter(it => it.severity === 'high' || displayCond(it) !== 'No issues');
  const defectsRows = [
    new TableRow({ children: [
      tcell('No.'), tcell('Description'), tcell('Risk level'), tcell('Reference'), tcell('Recommended Action')
    ]}),
    ...highFindings.map((it, idx) => {
      const desc = it.comment || '';
      const risk = it.severity === 'high' ? 'Critical' :
                   it.condition === 'fire_hazard' || it.condition === 'trip_fall' ? 'Major' :
                   (it.tags?.rust_stains ? 'Minor' : '—');
      const ref = (it.condition === 'fire_hazard' || it.condition === 'trip_fall')
        ? 'ISM/SOLAS – safe housekeeping/clearways'
        : (it.tags?.rust_stains ? 'Coatings/maintenance' : '—');
      const rec = (it.recommendations_high_severity_only || []).join('; ') || '—';
      return new TableRow({
        children: [ tcell(String(idx+1)), tcell(desc), tcell(risk), tcell(ref), tcell(rec) ]
      });
    })
  ];
  const defects = [
    H('Defects & Non-Conformities'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: defectsRows
    })
  ];

  // 6) Photographic Evidence (2 per page style)
  const photos = [ H('Photographic Evidence') ];
  per.forEach((it, i) => {
    const f = imageFiles.find(x => x.id === it.id);
    const cap = [
      P(`File: ${it.id}`),
      Small(`Condition: ${displayCond(it)}  |  Location: ${it.location || ''}`),
      P(`Observation: ${it.comment || ''}`),
      P(`Recommendation: ${(it.recommendations_high_severity_only || []).join('; ') || '—'}`)
    ];
    if (f && fs.existsSync(f.absPath)) {
      const img = Media.addImage(new Document(), fs.readFileSync(f.absPath), 500, 320);
      photos.push(img, ...cap);
    } else {
      photos.push(...cap);
    }
    if ((i+1) % 2 === 0) photos.push(new Paragraph({ children: [], pageBreakBefore: true }));
  });

  // 7) Conclusion
  const conclusion = [
    H('Conclusion & Recommendations'),
    P(meta.conclusion || 'Overall summary of vessel condition based on visible evidence.'),
    P('Priority corrective actions should address any high-severity hazards first, followed by rust/corrosion control and routine housekeeping to maintain clearways and safe access.')
  ];

  // Assemble sections
  doc.addSection({ children: [...cover, new PageBreak(), ...summary, ...details, ...particulars, new PageBreak(), ...defects, new PageBreak(), ...photos, new PageBreak(), ...conclusion] });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}