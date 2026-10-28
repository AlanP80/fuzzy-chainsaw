// Valutazioni (stelle 0–5) ed etichette colore, compatibili con Adobe Bridge / Lightroom (XMP).
// - JPG, TIFF, DNG, PSD, PNG, HEIC…: il dato sta dentro il file (xmp:Rating, xmp:Label)
// - RAW proprietari (CR2, NEF, ARW…): il dato sta nel file .xmp affiancato (IMG_0001.xmp)
// La scrittura usa ExifTool e conserva la data di modifica dei file.
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');

// Formati in cui la valutazione si scrive dentro il file (come fa Bridge)
const EMBED_EXT = new Set([
  'jpg', 'jpeg', 'jpe', 'jfif', 'tif', 'tiff', 'dng', 'psd', 'psb', 'png',
  'heic', 'heif', 'avif', 'webp', 'gif', 'jp2', 'jxl'
]);

// Nomi delle etichette usati da Bridge (in varie lingue) e da Lightroom → colore
const LABEL_WORDS = {
  red: ['red', 'rosso', 'rossa', 'select', 'seleziona', 'selezionare', 'selezione'],
  yellow: ['yellow', 'giallo', 'gialla', 'second', 'secondo', 'seconda'],
  green: ['green', 'verde', 'approved', 'approvato', 'approvata', 'approva'],
  blue: ['blue', 'blu', 'review', 'revisione', 'rivedi', 'rivedere'],
  purple: ['purple', 'viola', 'to do', 'da fare']
};
const DEFAULT_LABEL_TEXT = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' };

function labelColor(text) {
  if (!text) return null;
  const t = String(text).trim().toLowerCase();
  for (const [color, words] of Object.entries(LABEL_WORDS)) if (words.includes(t)) return color;
  return 'other';
}

const extOf = p => path.extname(p).slice(1).toLowerCase();
const needsSidecar = p => !EMBED_EXT.has(extOf(p));
const stripExt = p => p.slice(0, p.length - path.extname(p).length);
const exists = p => fsp.access(p).then(() => true, () => false);

let log = () => {};
let exiftoolScript = null;
let perl = 'perl';

function init(opts = {}) {
  if (opts.log) log = opts.log;
  try {
    exiftoolScript = require.resolve('exiftool-vendored.pl/bin/exiftool');
    // Nell'app impacchettata ExifTool sta fuori dall'archivio asar
    exiftoolScript = exiftoolScript.split(path.sep).map(s => (s === 'app.asar' ? 'app.asar.unpacked' : s)).join(path.sep);
  } catch (err) {
    log('ExifTool non trovato', err);
  }
  if (fs.existsSync('/usr/bin/perl')) perl = '/usr/bin/perl';
}

function exiftool(args) {
  return new Promise((resolve, reject) => {
    if (!exiftoolScript) { reject(new Error('ExifTool non disponibile')); return; }
    execFile(perl, [exiftoolScript, ...args], { maxBuffer: 32 * 1024 * 1024, timeout: 120000 }, (err, stdout, stderr) => {
      if (err) { err.message += stderr ? `\n${stderr}` : ''; reject(err); return; }
      resolve({ stdout, stderr });
    });
  });
}

async function sidecarFor(p) {
  const base = stripExt(p);
  for (const c of [`${base}.xmp`, `${base}.XMP`]) if (await exists(c)) return c;
  return null;
}

// Tutti i file .xmp affiancati (per spostarli nel Cestino insieme al RAW)
async function sidecarsFor(paths) {
  const out = [];
  for (const p of paths) {
    if (!needsSidecar(p)) continue;
    const sc = await sidecarFor(p);
    if (sc && !out.includes(sc)) out.push(sc);
  }
  return out;
}

const unescapeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escapeXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseXmpText(s) {
  const r = s.match(/(?:xmp|xap):Rating\s*=\s*["'](-?\d+(?:\.\d+)?)["']|<(?:xmp|xap):Rating>\s*(-?\d+(?:\.\d+)?)\s*</);
  const l = s.match(/(?:xmp|xap):Label\s*=\s*"([^"]*)"|(?:xmp|xap):Label\s*=\s*'([^']*)'|<(?:xmp|xap):Label>([^<]*)</);
  return {
    rating: r ? Number(r[1] || r[2]) : 0,
    label: l ? unescapeXml(l[1] || l[2] || l[3] || '').trim() : ''
  };
}

function normalize(rating, label) {
  let n = Math.round(Number(rating) || 0);
  if (n < 0) n = 0; // -1 = "Rifiuta" in Bridge: qui niente stelle
  if (n > 5) n = 5;
  const text = label ? String(label).trim() : '';
  return { rating: n, label: text, color: labelColor(text) };
}

let exifr = null;
async function readEmbedded(p) {
  exifr = exifr || require('exifr');
  const t = await exifr.parse(p, {
    tiff: false, exif: false, gps: false, ifd1: false, xmp: true, icc: false, iptc: false, jfif: false, mergeOutput: true
  });
  return normalize(t && t.Rating, t && t.Label);
}

async function readOne(p) {
  if (needsSidecar(p)) {
    const sc = await sidecarFor(p);
    if (sc) {
      const text = await fsp.readFile(sc, 'utf8');
      const r = parseXmpText(text);
      return normalize(r.rating, r.label);
    }
  }
  return readEmbedded(p);
}

// Legge molti file: veloce con exifr, ExifTool come riserva per i formati che exifr non conosce
async function readMany(paths) {
  const out = {};
  const fallback = [];
  let i = 0;
  const worker = async () => {
    while (i < paths.length) {
      const p = paths[i++];
      try { out[p] = await readOne(p); } catch { fallback.push(p); }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (fallback.length) {
    try {
      const { stdout } = await exiftool(['-j', '-q', '-m', '-charset', 'filename=utf8', '-XMP-xmp:Rating', '-XMP-xmp:Label', ...fallback]);
      for (const row of JSON.parse(stdout || '[]')) out[row.SourceFile] = normalize(row.Rating, row.Label);
    } catch (err) {
      log('lettura valutazioni (ExifTool)', err);
    }
    for (const p of fallback) if (!out[p]) out[p] = normalize(0, '');
  }
  return out;
}

function sidecarTemplate(rating, label) {
  const attrs = [];
  if (rating > 0) attrs.push(`   xmp:Rating="${rating}"`);
  if (label) attrs.push(`   xmp:Label="${escapeXml(label)}"`);
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="AP PhotoViewer">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
${attrs.join('\n')}/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`;
}

// Le scritture vanno una alla volta
let chain = Promise.resolve();
function serial(fn) {
  const job = chain.then(fn, fn);
  chain = job.catch(() => {});
  return job;
}

// change: { rating?: 0..5, label?: string ('' = togli etichetta) }
function write(paths, change) {
  return serial(async () => {
    const targets = [];
    for (const p of paths) {
      if (!needsSidecar(p)) { targets.push(p); continue; }
      const sc = await sidecarFor(p);
      if (sc) { targets.push(sc); continue; }
      // Nessun .xmp ancora: lo creo direttamente con i nuovi valori
      const rating = change.rating !== undefined ? change.rating : 0;
      const label = change.label !== undefined ? change.label : '';
      if (rating > 0 || label) await fsp.writeFile(`${stripExt(p)}.xmp`, sidecarTemplate(rating, label), 'utf8');
    }
    if (targets.length) {
      const args = ['-q', '-m', '-P', '-overwrite_original_in_place', '-charset', 'filename=utf8'];
      if (change.rating !== undefined) args.push(change.rating > 0 ? `-XMP-xmp:Rating=${change.rating}` : '-XMP-xmp:Rating=');
      if (change.label !== undefined) args.push(change.label ? `-XMP-xmp:Label=${change.label}` : '-XMP-xmp:Label=');
      await exiftool([...args, ...targets]);
    }
    // Rilegge per conferma e restituisce dimensione/data aggiornate
    const meta = await readMany(paths);
    const stats = {};
    for (const p of paths) {
      try { const st = await fsp.stat(p); stats[p] = { size: st.size, mtime: st.mtimeMs }; } catch { /* ignorato */ }
    }
    return { meta, stats };
  });
}

module.exports = { init, readMany, write, sidecarsFor, labelColor, DEFAULT_LABEL_TEXT, EMBED_EXT, parseXmpText };
