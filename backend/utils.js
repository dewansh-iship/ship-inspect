import fs from 'fs';
import path from 'path';
import { lookup as mimeLookup } from 'mime-types';

export const fileToDataUrl = (absPath) => {
  const mime = mimeLookup(absPath) || 'application/octet-stream';
  const b64 = fs.readFileSync(absPath).toString('base64');
  return `data:${mime};base64,${b64}`;
};

export const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };