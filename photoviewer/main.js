// AP PhotoViewer — processo principale: file, miniature, RAW, EXIF, menu
const {
  app, BrowserWindow, Menu, shell, ipcMain, dialog, protocol, net, nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const meta = require('./meta');

const APP_NAME = 'AP PhotoViewer';
app.setName(APP_NAME);

const isMac = process.platform === 'darwin';

// ---------- Formati ----------
const RAW_EXT = new Set([
  'dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf',
  'rw2', 'pef', 'raw', 'rwl', '3fr', 'erf', 'kdc', 'mrw', 'srw', 'x3f', 'iiq'
]);
// Formati che Chromium mostra da solo
const WEB_EXT = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'gif', 'webp', 'bmp', 'avif', 'ico']);
// Formati che decodifica macOS (come Anteprima)
const OTHER_EXT = new Set(['tif', 'tiff', 'heic', 'heif', 'psd', 'psb', 'jp2', 'jxl']);
const extOf = p => path.extname(p).slice(1).toLowerCase();
const isImage = ext => RAW_EXT.has(ext) || WEB_EXT.has(ext) || OTHER_EXT.has(ext);
const kindOf = ext => (RAW_EXT.has(ext) ? 'raw' : WEB_EXT.has(ext) ? 'web' : 'other');

// Cartelle "pacchetto" da non mostrare come cartelle normali
const BUNDLE_EXT = new Set(['app', 'photoslibrary', 'bundle', 'lrdata', 'fcpbundle', 'aplibrary', 'framework', 'plugin']);

// ---------- Cache ----------
const THUMB_SIZE = 512;
let cacheDir, thumbsDir, previewsDir, settingsFile;

function initPaths() {
  // Non dentro userData: lì Chromium ha la sua cartella «Cache» e su macOS
  // (che non distingue maiuscole e minuscole) «cache» sarebbe la stessa cartella.
  cacheDir = path.join(app.getPath('cache'), 'AP PhotoViewer', 'Anteprime');
  thumbsDir = path.join(cacheDir, 'thumbs');
  previewsDir = path.join(cacheDir, 'previews');
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  fs.mkdirSync(thumbsDir, { recursive: true });
  fs.mkdirSync(previewsDir, { recursive: true });
}

// ---------- Registro errori (Libreria/Logs/AP PhotoViewer/main.log) ----------
let logFile = null;
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map(x => (x instanceof Error ? (x.stack || x.message) : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  if (process.env.APV_LOG_STDOUT) process.stdout.write(line);
  try {
    if (!logFile) {
      const dir = app.getPath('logs');
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, 'main.log');
      try { if (fs.statSync(logFile).size > 2 * 1024 * 1024) fs.renameSync(logFile, logFile + '.old'); } catch { /* nuovo */ }
    }
    fs.appendFileSync(logFile, line);
  } catch { /* niente registro */ }
}

const exists = p => fsp.access(p).then(() => true, () => false);
const cacheKey = (p, st) =>
  crypto.createHash('sha1').update(`${p}|${Math.round(st.mtimeMs)}|v2`).digest('hex');

// Coda con un numero massimo di lavori in parallelo.
// lifo = true: prima le richieste più recenti (utile mentre si scorre la griglia)
function makeQueue(limit, lifo) {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < limit && queue.length) {
      const job = lifo ? queue.pop() : queue.shift();
      active++;
      job.fn().then(job.resolve, job.reject).finally(() => { active--; next(); });
    }
  };
  return (fn, urgent) => new Promise((resolve, reject) => {
    const job = { fn, resolve, reject };
    if (urgent) (lifo ? queue.push(job) : queue.unshift(job)); else (lifo ? queue.unshift(job) : queue.push(job));
    next();
  });
}
const thumbQueue = makeQueue(4, true);
const previewQueue = makeQueue(2, false);
const inflight = new Map();

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

const tmpName = out => `${out}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;

async function writeAtomic(out, buf) {
  const tmp = tmpName(out);
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, out);
}

async function sipsToJpeg(src, out, maxSize) {
  const tmp = tmpName(out) + '.jpg';
  await fsp.mkdir(path.dirname(out), { recursive: true });
  const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', maxSize ? '82' : '92'];
  if (maxSize) args.push('-Z', String(maxSize));
  args.push(src, '--out', tmp);
  try {
    await run('/usr/bin/sips', args);
    await fsp.rename(tmp, out);
  } catch (err) {
    fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

function fitSize(w, h, max) {
  const r = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * r)), height: Math.max(1, Math.round(h * r)) };
}

// Miniatura: Quick Look di macOS (legge anche i RAW), poi sips, poi Electron
async function makeThumb(p) {
  const st = await fsp.stat(p);
  const out = path.join(thumbsDir, cacheKey(p, st) + '.jpg');
  if (await exists(out)) return out;
  if (inflight.has(out)) return inflight.get(out);
  const job = thumbQueue(async () => {
    const ext = extOf(p);
    let img = null;
    if (isMac || process.platform === 'win32') {
      try { img = await nativeImage.createThumbnailFromPath(p, { width: THUMB_SIZE, height: THUMB_SIZE }); } catch (err) { log('Quick Look:', p, err); img = null; }
    }
    if (img && !img.isEmpty()) {
      await writeAtomic(out, img.toJPEG(84));
      return out;
    }
    if (isMac) {
      try { await sipsToJpeg(p, out, THUMB_SIZE); return out; } catch (err) { log('sips miniatura:', p, err); }
    }
    if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
      const full = nativeImage.createFromPath(p);
      if (!full.isEmpty()) {
        const s = full.getSize();
        await writeAtomic(out, full.resize({ ...fitSize(s.width, s.height, THUMB_SIZE), quality: 'good' }).toJPEG(84));
        return out;
      }
    }
    return null;
  }).finally(() => inflight.delete(out));
  inflight.set(out, job);
  return job;
}

// Immagine a piena risoluzione per il viewer. RAW, TIFF, HEIC, PSD… diventano JPEG (in cache)
async function makePreview(p, urgent) {
  const ext = extOf(p);
  if (WEB_EXT.has(ext)) return p;
  const st = await fsp.stat(p);
  const out = path.join(previewsDir, cacheKey(p, st) + '.jpg');
  if (await exists(out)) {
    const now = new Date();
    fsp.utimes(out, now, now).catch(() => {});
    return out;
  }
  if (inflight.has(out)) return inflight.get(out);
  const job = previewQueue(async () => {
    if (await exists(out)) return out;
    if (isMac) {
      await sipsToJpeg(p, out, 0);
      return out;
    }
    return makeThumb(p); // fuori da macOS: solo anteprima ridotta
  }, urgent).finally(() => inflight.delete(out));
  inflight.set(out, job);
  return job;
}

// Tiene la cache entro un limite, togliendo i file meno usati
async function trimDir(dir, maxBytes, targetBytes) {
  try {
    const names = await fsp.readdir(dir);
    const files = [];
    let total = 0;
    for (const n of names) {
      try {
        const st = await fsp.stat(path.join(dir, n));
        files.push({ p: path.join(dir, n), size: st.size, t: st.mtimeMs });
        total += st.size;
      } catch { /* ignorato */ }
    }
    if (total <= maxBytes) return;
    files.sort((a, b) => a.t - b.t);
    for (const f of files) {
      if (total <= targetBytes) break;
      await fsp.unlink(f.p).catch(() => {});
      total -= f.size;
    }
  } catch { /* ignorato */ }
}
const GB = 1024 ** 3;

// ---------- Impostazioni ----------
let settings = {};
function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) || {}; } catch { settings = {}; }
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeAtomic(settingsFile, JSON.stringify(settings, null, 2)).catch(() => {});
  }, 300);
}

// ---------- Posizioni (barra laterale) ----------
const home = os.homedir();
const ICLOUD = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
const CLOUD_STORAGE = path.join(home, 'Library', 'CloudStorage');

function cloudName(dirName) {
  const [service, ...rest] = dirName.split('-');
  const label = { GoogleDrive: 'Google Drive', OneDrive: 'OneDrive', Dropbox: 'Dropbox', Box: 'Box', pCloud: 'pCloud' }[service] || service;
  const extra = rest.join('-');
  return extra && !extra.includes('@') && extra !== 'Personal' ? `${label} (${extra})` : label;
}

async function cloudRoots() {
  const roots = [];
  if (await exists(ICLOUD)) roots.push({ name: 'iCloud Drive', path: ICLOUD, icon: 'cloud' });
  try {
    for (const d of await fsp.readdir(CLOUD_STORAGE, { withFileTypes: true })) {
      if (d.name.startsWith('.')) continue;
      roots.push({ name: cloudName(d.name), path: path.join(CLOUD_STORAGE, d.name), icon: 'cloud' });
    }
  } catch { /* nessuna cartella cloud */ }
  // Dropbox "classico" nella cartella Inizio
  const legacyDropbox = path.join(home, 'Dropbox');
  if (!roots.some(r => r.name.startsWith('Dropbox')) && await exists(legacyDropbox)) {
    roots.push({ name: 'Dropbox', path: legacyDropbox, icon: 'cloud' });
  }
  return roots;
}

async function volumes() {
  if (!isMac) return [];
  const out = [];
  try {
    for (const d of await fsp.readdir('/Volumes', { withFileTypes: true })) {
      if (d.name.startsWith('.')) continue;
      const p = path.join('/Volumes', d.name);
      try { if ((await fsp.realpath(p)) === '/') continue; } catch { continue; }
      out.push({ name: d.name, path: p, icon: 'disk' });
    }
  } catch { /* ignorato */ }
  return out;
}

async function locations() {
  const user = os.userInfo().username;
  const places = [
    { name: 'Immagini', path: path.join(home, 'Pictures'), icon: 'photo' },
    { name: 'Scrivania', path: path.join(home, 'Desktop'), icon: 'desktop' },
    { name: 'Download', path: path.join(home, 'Downloads'), icon: 'download' },
    { name: 'Documenti', path: path.join(home, 'Documents'), icon: 'doc' },
    { name: user, path: home, icon: 'home' }
  ];
  const existing = [];
  for (const p of places) if (await exists(p.path)) existing.push(p);
  return { places: existing, cloud: await cloudRoots(), volumes: await volumes(), home };
}

// Percorso "a briciole" con nomi leggibili (iCloud Drive, Google Drive…)
async function crumbs(dir) {
  const roots = [...(await cloudRoots()), ...(await volumes())];
  roots.push({ name: os.userInfo().username, path: home });
  let root = null;
  for (const r of roots) {
    if ((dir === r.path || dir.startsWith(r.path + path.sep)) && (!root || r.path.length > root.path.length)) root = r;
  }
  const list = [];
  let rest;
  if (root) { list.push({ name: root.name, path: root.path }); rest = path.relative(root.path, dir); } else {
    list.push({ name: isMac ? 'Macintosh HD' : '/', path: path.parse(dir).root });
    rest = path.relative(path.parse(dir).root, dir);
  }
  let acc = list[0].path;
  for (const part of rest.split(path.sep).filter(Boolean)) {
    acc = path.join(acc, part);
    list.push({ name: part, path: acc });
  }
  return list;
}

async function listDir(dir) {
  dir = path.resolve(dir);
  const st = await fsp.stat(dir);
  if (!st.isDirectory()) throw new Error('Non è una cartella');
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const folders = [];
  const files = [];
  await Promise.all(entries.map(async d => {
    if (d.name.startsWith('.') || d.name === 'Icon\r') return;
    const p = path.join(dir, d.name);
    let isDir = d.isDirectory();
    let isFile = d.isFile();
    if (d.isSymbolicLink()) {
      try { const s = await fsp.stat(p); isDir = s.isDirectory(); isFile = s.isFile(); } catch { return; }
    }
    if (isDir) {
      if (BUNDLE_EXT.has(extOf(d.name))) return;
      if (dir === home && (d.name === 'Library' || d.name === 'Applications')) return;
      folders.push({ name: d.name, path: p });
      return;
    }
    if (!isFile) return;
    const ext = extOf(d.name);
    if (!isImage(ext)) return;
    try {
      const s = await fsp.stat(p);
      files.push({ name: d.name, path: p, ext, kind: kindOf(ext), size: s.size, mtime: s.mtimeMs });
    } catch { /* file sparito */ }
  }));
  const parent = path.dirname(dir) === dir ? null : path.dirname(dir);
  return { path: dir, name: path.basename(dir) || dir, parent, mtime: st.mtimeMs, folders, files, crumbs: await crumbs(dir) };
}

// ---------- EXIF ----------
let exifr = null;
// Alcuni file salvano le frazioni come coppie [numeratore, denominatore]
function toNum(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return v;
  if (v.length === 2 && typeof v[0] === 'number') return v[1] ? v[0] / v[1] : undefined;
  if (v.length === 1) return Number(v[0]);
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function readExif(p) {
  const info = {};
  try {
    exifr = exifr || require('exifr');
    const t = await exifr.parse(p, {
      tiff: true, exif: true, gps: true, ifd1: false, xmp: false, icc: false, iptc: false, jfif: false,
      translateValues: true, reviveValues: true, mergeOutput: true
    });
    if (t) {
      Object.assign(info, {
        make: t.Make, model: t.Model, lens: t.LensModel || t.Lens,
        iso: t.ISO || (Array.isArray(t.ISOSpeedRatings) ? t.ISOSpeedRatings[0] : t.ISOSpeedRatings),
        exposure: t.ExposureTime, fnumber: t.FNumber, focal: t.FocalLength, focal35: t.FocalLengthIn35mmFormat,
        bias: t.ExposureCompensation, flash: t.Flash, program: t.ExposureProgram, metering: t.MeteringMode,
        whiteBalance: t.WhiteBalance, software: t.Software, artist: t.Artist,
        date: t.DateTimeOriginal || t.CreateDate || t.ModifyDate,
        lat: t.latitude, lon: t.longitude
      });
    }
  } catch { /* formato non letto da exifr */ }
  if (isMac && (!info.model || !info.exposure)) {
    try {
      const out = await run('/usr/bin/mdls', [
        '-name', 'kMDItemAcquisitionMake', '-name', 'kMDItemAcquisitionModel', '-name', 'kMDItemLensModel',
        '-name', 'kMDItemISOSpeed', '-name', 'kMDItemExposureTimeSeconds', '-name', 'kMDItemFNumber',
        '-name', 'kMDItemFocalLength', '-name', 'kMDItemContentCreationDate', p
      ]);
      const md = {};
      for (const line of out.split('\n')) {
        const m = line.match(/^(\w+)\s+=\s+(.*)$/);
        if (m && m[2] !== '(null)') md[m[1]] = m[2].replace(/^"|"$/g, '');
      }
      const num = k => (md[k] !== undefined ? Number(md[k]) : undefined);
      info.make = info.make || md.kMDItemAcquisitionMake;
      info.model = info.model || md.kMDItemAcquisitionModel;
      info.lens = info.lens || md.kMDItemLensModel;
      info.iso = info.iso || num('kMDItemISOSpeed');
      info.exposure = info.exposure || num('kMDItemExposureTimeSeconds');
      info.fnumber = info.fnumber || num('kMDItemFNumber');
      info.focal = info.focal || num('kMDItemFocalLength');
      if (!info.date && md.kMDItemContentCreationDate) info.date = new Date(md.kMDItemContentCreationDate.replace(' +0000', 'Z').replace(' ', 'T'));
    } catch { /* Spotlight non disponibile */ }
  }
  for (const k of ['iso', 'exposure', 'fnumber', 'focal', 'focal35', 'bias', 'lat', 'lon']) info[k] = toNum(info[k]);
  for (const k of Object.keys(info)) if (info[k] === undefined || info[k] === null || Number.isNaN(info[k])) delete info[k];
  if (info.date instanceof Date) info.date = Number.isNaN(info.date.getTime()) ? undefined : info.date.toISOString();
  try {
    const st = await fsp.stat(p);
    info.fileSize = st.size;
    info.fileDate = new Date(st.mtimeMs).toISOString();
  } catch { /* ignorato */ }
  return info;
}

// ---------- Finestra ----------
let win = null;
let pendingOpen = null;

function sendOpenPath(p) {
  if (win && !win.webContents.isLoading()) win.webContents.send('open-path', p);
  else pendingOpen = p;
}

function createWindow() {
  const b = settings.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1360,
    height: b.height || 880,
    x: b.x, y: b.y,
    minWidth: 760,
    minHeight: 480,
    title: APP_NAME,
    backgroundColor: '#1b1c1f',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    if (pendingOpen) { win.webContents.send('open-path', pendingOpen); pendingOpen = null; }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', event => event.preventDefault());

  const sendFs = () => win.webContents.send('fullscreen', win.isFullScreen());
  win.on('enter-full-screen', sendFs);
  win.on('leave-full-screen', sendFs);
  win.on('close', () => {
    if (!win.isFullScreen() && !win.isMaximized()) { settings.bounds = win.getBounds(); saveSettings(); }
  });
  win.on('closed', () => { win = null; });
}

function menuSend(action) {
  return () => { if (win) win.webContents.send('menu', action); };
}

function buildMenu() {
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: `Informazioni su ${APP_NAME}` },
        { type: 'separator' },
        { label: 'Mostra il registro degli errori', click: () => {
          log('registro aperto dal menu');
          shell.showItemInFolder(path.join(app.getPath('logs'), 'main.log'));
        } },
        { label: 'Svuota la cache delle anteprime', click: async () => {
          await fsp.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
          initPaths();
          menuSend('refresh')();
        } },
        { type: 'separator' },
        { role: 'hide', label: `Nascondi ${APP_NAME}` },
        { role: 'hideOthers', label: 'Nascondi altre' },
        { role: 'unhide', label: 'Mostra tutte' },
        { type: 'separator' },
        { role: 'quit', label: `Esci da ${APP_NAME}` }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Apri cartella…', accelerator: 'CmdOrCtrl+O', click: menuSend('open-folder') },
        { label: 'Aggiorna', accelerator: 'CmdOrCtrl+R', click: menuSend('refresh') },
        { type: 'separator' },
        { label: 'Aggiungi ai Preferiti', accelerator: 'CmdOrCtrl+D', click: menuSend('favorite') },
        { label: 'Cancella l\'elenco Recenti', click: menuSend('clear-recents') },
        { type: 'separator' },
        { label: 'Chiudi finestra', role: 'close' }
      ]
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'undo', label: 'Annulla' },
        { role: 'redo', label: 'Ripeti' },
        { type: 'separator' },
        { role: 'cut', label: 'Taglia' },
        { role: 'copy', label: 'Copia' },
        { role: 'paste', label: 'Incolla' },
        { role: 'selectAll', label: 'Seleziona tutto' },
        { type: 'separator' },
        { label: 'Cerca', accelerator: 'CmdOrCtrl+F', click: menuSend('search') }
      ]
    },
    {
      label: 'Valutazione',
      submenu: [
        { label: 'Nessuna stella', accelerator: 'CmdOrCtrl+0', click: menuSend('rate:0') },
        { label: '★', accelerator: 'CmdOrCtrl+1', click: menuSend('rate:1') },
        { label: '★★', accelerator: 'CmdOrCtrl+2', click: menuSend('rate:2') },
        { label: '★★★', accelerator: 'CmdOrCtrl+3', click: menuSend('rate:3') },
        { label: '★★★★', accelerator: 'CmdOrCtrl+4', click: menuSend('rate:4') },
        { label: '★★★★★', accelerator: 'CmdOrCtrl+5', click: menuSend('rate:5') },
        { type: 'separator' },
        { label: 'Aumenta valutazione', accelerator: 'CmdOrCtrl+.', click: menuSend('rate:+') },
        { label: 'Diminuisci valutazione', accelerator: 'CmdOrCtrl+,', click: menuSend('rate:-') },
        { type: 'separator' },
        { label: 'Etichetta rossa', accelerator: 'CmdOrCtrl+6', click: menuSend('label:red') },
        { label: 'Etichetta gialla', accelerator: 'CmdOrCtrl+7', click: menuSend('label:yellow') },
        { label: 'Etichetta verde', accelerator: 'CmdOrCtrl+8', click: menuSend('label:green') },
        { label: 'Etichetta blu', accelerator: 'CmdOrCtrl+9', click: menuSend('label:blue') },
        { label: 'Etichetta viola', click: menuSend('label:purple') },
        { label: 'Nessuna etichetta', click: menuSend('label:none') }
      ]
    },
    {
      label: 'Vista',
      submenu: [
        { label: 'Mostra/nascondi barra laterale', accelerator: 'CmdOrCtrl+Alt+S', click: menuSend('sidebar') },
        { label: 'Informazioni immagine', click: menuSend('info') },
        { label: 'Presentazione', click: menuSend('slideshow') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
        { type: 'separator' },
        { label: 'Scorciatoie da tastiera', accelerator: 'CmdOrCtrl+/', click: menuSend('help') }
      ]
    },
    {
      label: 'Finestra',
      submenu: [
        { role: 'minimize', label: 'Riduci a icona' },
        { role: 'zoom', label: 'Ingrandisci' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Protocollo apv:// per mostrare file locali in sicurezza ----------
protocol.registerSchemesAsPrivileged([
  { scheme: 'apv', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

function registerProtocol() {
  protocol.handle('apv', async req => {
    let abs = '';
    try {
      const p = new URL(req.url).searchParams.get('p') || '';
      abs = path.resolve(p);
      if (!abs.startsWith(cacheDir + path.sep) && !isImage(extOf(abs))) {
        log('apv: non consentito', abs);
        return new Response('Non consentito', { status: 403 });
      }
      const res = await net.fetch(pathToFileURL(abs).toString());
      if (!res.ok) log('apv: risposta', res.status, abs);
      return res;
    } catch (err) {
      log('apv: errore', abs, err);
      return new Response(String(err && err.message), { status: 500 });
    }
  });
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('locations', () => locations());
  ipcMain.handle('list-dir', async (_e, dir) => {
    try { return await listDir(dir); } catch (err) {
      const code = err.code;
      const msg = code === 'EACCES' || code === 'EPERM'
        ? 'macOS non dà il permesso di leggere questa cartella. Controlla Impostazioni di Sistema → Privacy e sicurezza → File e cartelle.'
        : code === 'ENOENT' ? 'La cartella non esiste più.' : err.message;
      return { error: msg, path: dir };
    }
  });
  ipcMain.handle('dir-mtime', async (_e, dir) => {
    try { return (await fsp.stat(dir)).mtimeMs; } catch { return null; }
  });
  ipcMain.handle('thumb', async (_e, p) => {
    try {
      const r = await makeThumb(p);
      if (!r) log('miniatura non creata', p);
      return r;
    } catch (err) { log('miniatura: errore', p, err); return null; }
  });
  ipcMain.handle('preview', async (_e, p, urgent) => {
    try { return await makePreview(p, urgent); } catch (err) { log('anteprima: errore', p, err); return null; }
  });
  ipcMain.handle('log', (_e, msg) => log('interfaccia:', msg));
  ipcMain.handle('exif', (_e, p) => readExif(p));
  ipcMain.handle('meta-read', async (_e, paths) => {
    try { return await meta.readMany(paths); } catch (err) { log('valutazioni: lettura', err); return {}; }
  });
  ipcMain.handle('meta-write', async (_e, paths, change) => {
    try {
      const res = await meta.write(paths, change);
      return { ok: true, ...res };
    } catch (err) {
      log('valutazioni: scrittura', paths, change, err);
      return { ok: false, error: String((err && err.message) || err).split('\n')[0] };
    }
  });

  ipcMain.handle('open-with', async (_e, p, which) => {
    if (!isMac) { await shell.openPath(p); return true; }
    let appPath = 'Pixelmator Pro';
    if (which === 'choose') {
      const r = await dialog.showOpenDialog(win, {
        title: 'Scegli l\'applicazione', defaultPath: '/Applications', buttonLabel: 'Apri con questa app',
        properties: ['openFile'], filters: [{ name: 'Applicazioni', extensions: ['app'] }]
      });
      if (r.canceled || !r.filePaths[0]) return false;
      appPath = r.filePaths[0];
    }
    try { await run('/usr/bin/open', ['-a', appPath, p]); return true; } catch {
      await dialog.showMessageBox(win, {
        type: 'warning', message: which === 'choose' ? 'Non riesco ad aprire il file con questa app.' : 'Pixelmator Pro non è installato',
        detail: which === 'choose' ? '' : 'Installa Pixelmator Pro dal Mac App Store oppure usa «Apri con…».'
      });
      return false;
    }
  });
  ipcMain.handle('open-default', (_e, p) => shell.openPath(p));
  ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));

  ipcMain.handle('trash', async (_e, paths, label) => {
    if (settings.confirmTrash !== false) {
      const r = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Sposta nel Cestino', 'Annulla'],
        defaultId: 0, cancelId: 1,
        message: `Spostare nel Cestino «${label}»?`,
        detail: paths.length > 1 ? `Verranno spostati ${paths.length} file (RAW + JPG). Puoi recuperarli dal Cestino.` : 'Puoi recuperarlo dal Cestino.',
        checkboxLabel: 'Non chiedere più'
      });
      if (r.response !== 0) return { ok: false };
      if (r.checkboxChecked) { settings.confirmTrash = false; saveSettings(); }
    }
    const trashed = [];
    // I file .xmp affiancati ai RAW (stelle ed etichette) vanno nel Cestino insieme alla foto
    const sidecars = await meta.sidecarsFor(paths).catch(() => []);
    for (const sc of sidecars) { try { await shell.trashItem(sc); } catch (err) { log('cestino .xmp', sc, err); } }
    for (const p of paths) {
      try { await shell.trashItem(p); trashed.push(p); } catch (err) {
        await dialog.showMessageBox(win, { type: 'error', message: 'Non riesco a spostare il file nel Cestino', detail: `${p}\n${err.message}` });
      }
    }
    return { ok: trashed.length > 0, trashed };
  });

  ipcMain.handle('choose-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Apri cartella', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('context-menu', (_e, items) => new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const build = list => list.map(it => (it === '-' ? { type: 'separator' } : it.submenu ? {
      label: it.label, submenu: build(it.submenu)
    } : {
      label: it.label, enabled: it.enabled !== false, type: it.checked !== undefined ? 'checkbox' : 'normal',
      checked: !!it.checked, click: () => finish(it.id)
    }));
    const menu = Menu.buildFromTemplate(build(items));
    menu.popup({ window: win, callback: () => setTimeout(() => finish(null), 50) });
  }));

  ipcMain.handle('settings-get', () => settings);
  ipcMain.handle('settings-set', (_e, patch) => {
    settings = { ...settings, ...patch };
    saveSettings();
    return settings;
  });
  ipcMain.handle('fullscreen', (_e, value) => {
    if (!win) return false;
    win.setFullScreen(typeof value === 'boolean' ? value : !win.isFullScreen());
    return win.isFullScreen();
  });
  ipcMain.handle('is-fullscreen', () => (win ? win.isFullScreen() : false));
}

// ---------- Avvio ----------
// File trascinati sull'icona o aperti con «Apri con» dal Finder
app.on('open-file', (event, p) => { event.preventDefault(); sendOpenPath(p); });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    initPaths();
    meta.init({ log });
    log(`avvio ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform} ${process.arch} · ${os.release()}`);
    loadSettings();
    registerProtocol();
    registerIpc();
    buildMenu();
    createWindow();
    setTimeout(() => {
      trimDir(previewsDir, 3 * GB, 2 * GB);
      trimDir(thumbsDir, 1 * GB, 0.7 * GB);
    }, 15000);
    app.on('activate', () => { if (!win) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
