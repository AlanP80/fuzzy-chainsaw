'use strict';
// AP PhotoViewer — interfaccia
// window.api arriva da preload.js
const $ = sel => document.querySelector(sel);

const RAW_EXT = new Set(['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'raw', 'rwl', '3fr', 'erf', 'kdc', 'mrw', 'srw', 'x3f', 'iiq']);
const IMG_EXT = new Set([...RAW_EXT, 'jpg', 'jpeg', 'jpe', 'jfif', 'png', 'gif', 'webp', 'bmp', 'avif', 'ico', 'tif', 'tiff', 'heic', 'heif', 'psd', 'psb', 'jp2', 'jxl']);
const WEB_EXT = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'gif', 'webp', 'bmp', 'avif', 'ico']);
const isJpg = f => f.ext === 'jpg' || f.ext === 'jpeg';
const isTiff = f => f.ext === 'tif' || f.ext === 'tiff';
const extOfPath = p => { const n = p.split('/').pop(); const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
const dirname = p => p.slice(0, p.lastIndexOf('/')) || '/';
const baseName = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
const collator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DEFAULTS = {
  thumbSize: 180, sort: 'name', sortDir: 1, filter: 'all', pairRaw: true,
  favorites: [], recents: [], lastDir: null, sidebar: true, showInfo: false, slideshowSec: 4
};

const S = {
  settings: { ...DEFAULTS },
  loc: null,
  listing: null,
  items: [],
  view: [],
  sel: -1,
  history: [],
  hpos: -1,
  search: '',
  fullscreen: false,
  thumbJobs: new Map(),   // chiave → Promise<url|null>
  thumbDone: new Map(),   // chiave → url già pronto
  previewDone: new Map(), // chiave → url a piena risoluzione già pronto
  exif: new Map()
};

const ICONS = {
  photo: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/></svg>',
  desktop: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="12" rx="1.8"/><path d="M9 20h6M12 16.5V20"/></svg>',
  download: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v8M8.5 12.5l3.5 3.5 3.5-3.5"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M4 11l8-6.5 8 6.5M6 9.5V19.5h12V9.5"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M7 18.5a4.5 4.5 0 01-.6-9 6 6 0 0111.5 1.7 3.7 3.7 0 01-.4 7.3z"/></svg>',
  disk: '<svg viewBox="0 0 24 24"><rect x="3.5" y="7" width="17" height="10" rx="2"/><path d="M16.5 12h.01"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M2.5 6.5a2 2 0 012-2h5l2 2.2h8a2 2 0 012 2V18a2 2 0 01-2 2h-15a2 2 0 01-2-2z"/></svg>',
  emptyImg: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.2"/></svg>'
};

// Errori dell'interfaccia → registro
window.addEventListener('error', e => api.log(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => api.log(`promessa: ${e.reason && (e.reason.stack || e.reason.message || e.reason)}`));

// ---------- Elementi ----------
const gridWrap = $('#grid-wrap');
const grid = $('#grid');
const emptyEl = $('#empty');
const viewer = $('#viewer');
const stage = $('#stage');
const vimg = $('#vimg');

// ---------- Impostazioni ----------
function saveSetting(patch) {
  Object.assign(S.settings, patch);
  api.setSettings(patch);
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- Barra laterale ----------
function sideItem(entry, icon, kind) {
  const active = S.listing && S.listing.path === entry.path;
  return `<div class="side-item${active ? ' active' : ''}" data-path="${esc(entry.path)}" data-kind="${kind}" title="${esc(entry.path)}">${ICONS[icon] || ICONS.folder}<span>${esc(entry.name)}</span></div>`;
}

function renderSidebar() {
  if (!S.loc) return;
  const favs = S.settings.favorites || [];
  const known = new Set([...favs.map(f => f.path), ...S.loc.places.map(p => p.path), ...S.loc.cloud.map(c => c.path), ...S.loc.volumes.map(v => v.path)]);
  const recents = (S.settings.recents || []).filter(p => !known.has(p)).slice(0, 6);
  let html = '<div class="side-title">Preferiti</div>';
  html += favs.length ? favs.map(f => sideItem(f, 'star', 'fav')).join('') : '<div class="side-empty">Premi ★ per aggiungere la cartella aperta</div>';
  html += '<div class="side-title">Posizioni</div>' + S.loc.places.map(p => sideItem(p, p.icon, 'place')).join('');
  html += '<div class="side-title">Cloud</div>';
  html += S.loc.cloud.length ? S.loc.cloud.map(c => sideItem(c, 'cloud', 'cloud')).join('') : '<div class="side-empty">Nessuna cartella cloud trovata</div>';
  if (S.loc.volumes.length) html += '<div class="side-title">Dischi</div>' + S.loc.volumes.map(v => sideItem(v, 'disk', 'disk')).join('');
  if (recents.length) html += '<div class="side-title">Recenti</div>' + recents.map(p => sideItem({ path: p, name: p.split('/').pop() || p }, 'clock', 'recent')).join('');
  $('#side-content').innerHTML = html;
}

$('#side-content').addEventListener('click', e => {
  const it = e.target.closest('.side-item');
  if (it) navigate(it.dataset.path);
});
$('#side-content').addEventListener('contextmenu', async e => {
  const it = e.target.closest('.side-item');
  if (!it) return;
  e.preventDefault();
  const p = it.dataset.path;
  const isFav = (S.settings.favorites || []).some(f => f.path === p);
  const choice = await api.contextMenu([
    { id: 'open', label: 'Apri' },
    isFav ? { id: 'unfav', label: 'Rimuovi dai Preferiti' } : { id: 'fav', label: 'Aggiungi ai Preferiti' },
    { id: 'finder', label: 'Mostra nel Finder' }
  ]);
  if (choice === 'open') navigate(p);
  if (choice === 'fav' || choice === 'unfav') toggleFavorite(p);
  if (choice === 'finder') api.reveal(p);
});

function toggleFavorite(p = S.listing && S.listing.path) {
  if (!p) return;
  let favs = [...(S.settings.favorites || [])];
  if (favs.some(f => f.path === p)) {
    favs = favs.filter(f => f.path !== p);
    toast('Rimossa dai Preferiti');
  } else {
    favs.push({ path: p, name: p.split('/').pop() || p });
    toast('Aggiunta ai Preferiti');
  }
  saveSetting({ favorites: favs });
  renderSidebar();
  updateFavButton();
}

function updateFavButton() {
  const on = !!(S.listing && (S.settings.favorites || []).some(f => f.path === S.listing.path));
  $('#btn-fav').classList.toggle('on', on);
  $('#btn-fav').title = on ? 'Rimuovi dai Preferiti (⌘D)' : 'Aggiungi ai Preferiti (⌘D)';
}

// ---------- Navigazione ----------
let navToken = 0;

async function navigate(dir, opts = {}) {
  const { push = true, keepScroll = false, focusPath = null, openViewer: openAfter = false, fallback = null } = opts;
  const token = ++navToken;
  const res = await api.listDir(dir);
  if (token !== navToken) return;
  if (res.error) {
    if (fallback) return navigate(fallback, { push });
    S.listing = { path: dir, error: res.error, folders: [], files: [], crumbs: [{ name: dir.split('/').pop() || dir, path: dir }] };
    S.items = [];
    S.view = [];
    renderAll();
    return;
  }
  const changedDir = !S.listing || S.listing.path !== res.path;
  S.listing = res;
  if (push && changedDir) {
    S.history = S.history.slice(0, S.hpos + 1);
    S.history.push(res.path);
    S.hpos = S.history.length - 1;
  }
  if (changedDir) {
    S.sel = -1;
    const recents = [res.path, ...(S.settings.recents || []).filter(p => p !== res.path)].slice(0, 12);
    saveSetting({ lastDir: res.path, recents });
  }
  buildItems();
  computeView();
  renderAll();
  if (!keepScroll) gridWrap.scrollTop = 0;
  if (focusPath) {
    const i = S.view.findIndex(it => it.files.some(f => f.path === focusPath));
    if (i >= 0) { setSel(i); if (openAfter) openViewer(i); }
  }
}

async function reload() {
  if (!S.listing) return;
  const key = V.open && V.item ? V.item.key : null;
  const scroll = gridWrap.scrollTop;
  await navigate(S.listing.path, { push: false, keepScroll: true });
  gridWrap.scrollTop = scroll;
  if (V.open) {
    const i = key ? S.view.findIndex(it => it.key === key) : -1;
    if (!S.view.length) closeViewer();
    else if (i >= 0) { V.idx = i; V.item = S.view[i]; updateViewerBar(); } else showImage(Math.min(V.idx, S.view.length - 1));
  }
}

function goHistory(delta) {
  const n = S.hpos + delta;
  if (n < 0 || n >= S.history.length) return;
  S.hpos = n;
  navigate(S.history[n], { push: false });
}

function goUp() {
  if (S.listing && S.listing.parent) {
    const from = S.listing.path;
    navigate(S.listing.parent).then(() => {
      const el = grid.querySelector(`.tile.folder[data-path="${CSS.escape(from)}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
  }
}

function updateNavButtons() {
  $('#btn-back').disabled = S.hpos <= 0;
  $('#btn-forward').disabled = S.hpos >= S.history.length - 1;
  $('#btn-up').disabled = !(S.listing && S.listing.parent);
}

function renderCrumbs() {
  const c = (S.listing && S.listing.crumbs) || [];
  $('#crumbs').innerHTML = c.map((x, i) =>
    (i ? '<svg class="chev" viewBox="0 0 24 24" width="12" height="12"><path d="M9 6l6 6-6 6"/></svg>' : '') +
    `<a data-path="${esc(x.path)}" title="${esc(x.path)}">${esc(x.name)}</a>`).join('');
  document.title = S.listing ? `${S.listing.name || ''} — AP PhotoViewer` : 'AP PhotoViewer';
}
$('#crumbs').addEventListener('click', e => {
  const a = e.target.closest('a');
  if (a) navigate(a.dataset.path);
});

// ---------- Elementi della griglia ----------
function makeItem(files, display, raw) {
  const pair = files.length > 1;
  return {
    files, display, raw, pair,
    key: display.path,
    name: pair ? baseName(display.name) : display.name,
    mtime: Math.max(...files.map(f => f.mtime)),
    size: files.reduce((a, f) => a + f.size, 0),
    badge: pair ? 'RAW+JPG' : (isJpg(display) ? '' : display.ext.toUpperCase()),
    badgeClass: pair ? 'pair' : (raw ? 'raw' : '')
  };
}

function buildItems() {
  const files = (S.listing && S.listing.files) || [];
  const items = [];
  const single = f => makeItem([f], f, f.kind === 'raw' ? f : null);
  if (S.settings.pairRaw) {
    const groups = new Map();
    for (const f of files) {
      const k = baseName(f.name).toLowerCase();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }
    for (const g of groups.values()) {
      const raw = g.find(f => f.kind === 'raw');
      const jpg = g.find(isJpg);
      if (raw && jpg) {
        items.push(makeItem([jpg, raw], jpg, raw));
        for (const f of g) if (f !== raw && f !== jpg) items.push(single(f));
      } else {
        for (const f of g) items.push(single(f));
      }
    }
  } else {
    for (const f of files) items.push(single(f));
  }
  S.items = items;
}

function computeView() {
  const { filter, sort, sortDir } = S.settings;
  const q = S.search;
  const keepKey = S.sel >= 0 && S.view[S.sel] ? S.view[S.sel].key : null;
  let v = S.items.filter(it => {
    if (q && !it.files.some(f => f.name.toLowerCase().includes(q))) return false;
    switch (filter) {
      case 'raw': return !!it.raw;
      case 'jpg': return it.files.some(isJpg);
      case 'tiff': return it.files.some(isTiff);
      case 'other': return !it.raw && !it.files.some(f => isJpg(f) || isTiff(f));
      default: return true;
    }
  });
  const byName = (a, b) => collator.compare(a.name, b.name);
  const cmp = {
    name: byName,
    date: (a, b) => a.mtime - b.mtime || byName(a, b),
    type: (a, b) => collator.compare(a.badge || 'JPG', b.badge || 'JPG') || byName(a, b),
    size: (a, b) => a.size - b.size || byName(a, b)
  }[sort] || byName;
  v.sort((a, b) => cmp(a, b) * sortDir);
  S.view = v;
  S.sel = keepKey ? v.findIndex(it => it.key === keepKey) : -1;
}

// ---------- Miniature ----------
const thumbKey = f => `${f.path}|${f.mtime}|${f.size}`;

function getThumb(f) {
  const k = thumbKey(f);
  if (!S.thumbJobs.has(k)) {
    S.thumbJobs.set(k, api.thumb(f.path).then(p => {
      const url = p ? api.fileUrl(p) : null;
      if (url) S.thumbDone.set(k, url); else S.thumbJobs.delete(k);
      return url;
    }, () => { S.thumbJobs.delete(k); return null; }));
  }
  return S.thumbJobs.get(k);
}

let renderToken = 0;
const observer = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    observer.unobserve(e.target);
    loadTileThumb(e.target);
  }
}, { root: gridWrap, rootMargin: '700px 0px' });

async function loadTileThumb(tile) {
  const it = tile._item;
  if (!it) return;
  const token = renderToken;
  let url = await getThumb(it.display);
  if (!url && it.pair) url = await getThumb(it.raw);
  if (token !== renderToken || !url) return;
  setTileImg(tile, url);
}

function setTileImg(tile, url) {
  const img = tile.querySelector('img');
  img.onload = () => { img.classList.add('ok'); tile.querySelector('.ph').classList.add('gone'); };
  img.src = url;
}

function renderGrid() {
  renderToken++;
  observer.disconnect();
  grid.textContent = '';
  const listing = S.listing;
  const q = S.search;
  const frag = document.createDocumentFragment();
  const folders = listing && !listing.error
    ? listing.folders.filter(f => !q || f.name.toLowerCase().includes(q)).sort((a, b) => collator.compare(a.name, b.name))
    : [];
  for (const f of folders) {
    const t = document.createElement('div');
    t.className = 'tile folder';
    t.dataset.path = f.path;
    t.title = f.name;
    t.innerHTML = `<div class="thumb">${ICONS.folder}</div><div class="name">${esc(f.name)}</div>`;
    frag.appendChild(t);
  }
  S.view.forEach((it, i) => {
    const t = document.createElement('div');
    t.className = 'tile img' + (i === S.sel ? ' sel' : '');
    t.dataset.i = i;
    t.title = it.pair ? it.files.map(f => f.name).join(' + ') : it.name;
    t._item = it;
    const label = (it.badge || it.display.ext.toUpperCase());
    t.innerHTML = `<div class="thumb"><div class="ph">${esc(label)}</div><img alt="" draggable="false">${it.badge ? `<span class="badge ${it.badgeClass}">${esc(it.badge)}</span>` : ''}</div><div class="name">${esc(it.name)}</div>`;
    frag.appendChild(t);
    const done = S.thumbDone.get(thumbKey(it.display));
    if (done) setTileImg(t, done); else observer.observe(t);
  });
  grid.appendChild(frag);

  // Messaggi per cartelle vuote o non leggibili
  if (listing && listing.error) {
    emptyEl.innerHTML = `${ICONS.warn}<b>Non riesco ad aprire la cartella</b><span>${esc(listing.error)}</span>`;
    emptyEl.hidden = false;
  } else if (!folders.length && !S.view.length) {
    const filtered = S.items.length > 0 || q;
    emptyEl.innerHTML = `${ICONS.emptyImg}<b>${filtered ? 'Nessuna immagine corrisponde' : 'Nessuna immagine in questa cartella'}</b>` +
      (filtered ? '<span>Prova a cambiare il filtro o la ricerca.</span>' : '<span>Scegli un\'altra cartella dalla barra laterale o trascinala qui.</span>');
    emptyEl.hidden = false;
  } else {
    emptyEl.hidden = true;
  }

  const n = S.view.length;
  const tot = S.items.length;
  let txt = `${n} ${n === 1 ? 'immagine' : 'immagini'}`;
  if (n !== tot) txt += ` di ${tot}`;
  if (folders.length) txt += ` · ${folders.length} ${folders.length === 1 ? 'cartella' : 'cartelle'}`;
  $('#count').textContent = listing && !listing.error ? txt : '';
}

function renderAll() {
  renderGrid();
  renderCrumbs();
  renderSidebar();
  updateNavButtons();
  updateFavButton();
}

function setSel(i, scroll = true) {
  const prev = grid.querySelector('.tile.sel');
  if (prev) prev.classList.remove('sel');
  S.sel = i;
  const t = grid.querySelector(`.tile.img[data-i="${i}"]`);
  if (t) {
    t.classList.add('sel');
    if (scroll) t.scrollIntoView({ block: 'nearest' });
  }
}

function gridCols() {
  return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
}

grid.addEventListener('click', e => {
  const t = e.target.closest('.tile');
  if (!t) return;
  if (t.classList.contains('folder')) { navigate(t.dataset.path); return; }
  const i = +t.dataset.i;
  setSel(i, false);
  openViewer(i);
});

grid.addEventListener('contextmenu', async e => {
  const t = e.target.closest('.tile');
  if (!t) return;
  e.preventDefault();
  if (t.classList.contains('folder')) {
    const p = t.dataset.path;
    const isFav = (S.settings.favorites || []).some(f => f.path === p);
    const c = await api.contextMenu([
      { id: 'open', label: 'Apri' },
      isFav ? { id: 'fav', label: 'Rimuovi dai Preferiti' } : { id: 'fav', label: 'Aggiungi ai Preferiti' },
      { id: 'finder', label: 'Mostra nel Finder' }
    ]);
    if (c === 'open') navigate(p);
    if (c === 'fav') toggleFavorite(p);
    if (c === 'finder') api.reveal(p);
    return;
  }
  const i = +t.dataset.i;
  setSel(i, false);
  const it = S.view[i];
  const c = await api.contextMenu(itemMenu(it, true));
  runItemAction(c, it, i);
});

function itemMenu(it, withOpen) {
  const m = [];
  if (withOpen) m.push({ id: 'view', label: 'Apri nel viewer' }, '-');
  if (it.pair) {
    m.push({ id: 'pix-jpg', label: 'Apri il JPG in Pixelmator Pro' }, { id: 'pix-raw', label: 'Apri il RAW in Pixelmator Pro' });
  } else {
    m.push({ id: 'pix', label: 'Apri in Pixelmator Pro' });
  }
  m.push({ id: 'choose', label: 'Apri con un\'altra app…' }, { id: 'default', label: 'Apri con l\'app predefinita' }, '-',
    { id: 'finder', label: 'Mostra nel Finder' }, '-',
    { id: 'trash', label: it.pair ? 'Sposta nel Cestino (RAW + JPG)' : 'Sposta nel Cestino' });
  return m;
}

function runItemAction(c, it, i, shownPath) {
  const p = shownPath || it.display.path;
  switch (c) {
    case 'view': openViewer(i); break;
    case 'pix': api.openWith(p, 'pixelmator'); break;
    case 'pix-jpg': api.openWith(it.display.path, 'pixelmator'); break;
    case 'pix-raw': api.openWith(it.raw.path, 'pixelmator'); break;
    case 'choose': api.openWith(p, 'choose'); break;
    case 'default': api.openDefault(p); break;
    case 'finder': api.reveal(p); break;
    case 'trash': trashItem(it); break;
    default: break;
  }
}

async function trashItem(it) {
  if (!it) return;
  const label = it.pair ? `${it.name} (RAW + JPG)` : it.name;
  const res = await api.trash(it.files.map(f => f.path), label);
  if (!res || !res.ok) return;
  const gone = new Set(res.trashed);
  const idx = S.view.indexOf(it);
  S.listing.files = S.listing.files.filter(f => !gone.has(f.path));
  buildItems();
  computeView();
  renderGrid();
  toast(gone.size > 1 ? `${gone.size} file spostati nel Cestino` : 'Spostato nel Cestino');
  const next = Math.min(Math.max(idx, 0), S.view.length - 1);
  if (V.open) {
    if (!S.view.length) closeViewer(); else showImage(next);
  } else if (next >= 0) {
    setSel(next);
  }
}

// ---------- Barra opzioni ----------
function applyThumbSize(v) {
  document.documentElement.style.setProperty('--thumb', `${v}px`);
  $('#thumbsize').value = v;
}
let sizeTimer = null;
function setThumbSize(v) {
  v = clamp(Math.round(v / 10) * 10, 100, 380);
  applyThumbSize(v);
  S.settings.thumbSize = v;
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(() => saveSetting({ thumbSize: v }), 300);
}

$('#thumbsize').addEventListener('input', e => setThumbSize(+e.target.value));
$('#filter').addEventListener('change', e => { saveSetting({ filter: e.target.value }); computeView(); renderGrid(); });
$('#sort').addEventListener('change', e => { saveSetting({ sort: e.target.value }); computeView(); renderGrid(); });
$('#btn-sortdir').addEventListener('click', () => {
  saveSetting({ sortDir: -S.settings.sortDir });
  $('#btn-sortdir').classList.toggle('desc', S.settings.sortDir < 0);
  computeView();
  renderGrid();
});
$('#pair').addEventListener('change', e => { saveSetting({ pairRaw: e.target.checked }); buildItems(); computeView(); renderGrid(); });
$('#search').addEventListener('input', e => { S.search = e.target.value.trim().toLowerCase(); computeView(); renderGrid(); gridWrap.scrollTop = 0; });

$('#btn-back').addEventListener('click', () => goHistory(-1));
$('#btn-forward').addEventListener('click', () => goHistory(1));
$('#btn-up').addEventListener('click', goUp);
$('#btn-fav').addEventListener('click', () => toggleFavorite());
$('#btn-sidebar').addEventListener('click', toggleSidebar);

function toggleSidebar() {
  saveSetting({ sidebar: !S.settings.sidebar });
  document.body.classList.toggle('no-sidebar', !S.settings.sidebar);
}

// ---------- Viewer ----------
const V = {
  open: false, idx: 0, item: null, showRaw: false,
  scale: 1, x: 0, y: 0, bw: 1, bh: 1, natW: 0, natH: 0,
  full: false, fitMode: true, shown: null, token: 0,
  playing: false, timer: null, idleTimer: null
};
const BAR_H = 52;
const INFO_W = 300;

function shownPath(it = V.item) {
  if (!it) return null;
  return it.pair && V.showRaw ? it.raw.path : it.display.path;
}
function shownFile(it = V.item) {
  if (!it) return null;
  return it.pair && V.showRaw ? it.raw : it.display;
}

function openViewer(i) {
  if (!S.view.length) return;
  V.open = true;
  viewer.hidden = false;
  viewer.classList.toggle('with-info', !!S.settings.showInfo);
  $('#info').hidden = !S.settings.showInfo;
  $('#v-info').classList.toggle('on', !!S.settings.showInfo);
  V.item = null;
  showImage(i);
  pokeIdle();
}

function closeViewer() {
  stopPlay();
  V.open = false;
  V.token++;
  viewer.hidden = true;
  vimg.removeAttribute('src');
  V.shown = null;
  $('#vspinner').hidden = true;
  if (V.idx < S.view.length) setSel(V.idx);
  gridWrap.focus();
}

function area() {
  const w = window.innerWidth - (S.settings.showInfo ? INFO_W : 0);
  return { x0: 0, y0: BAR_H, w, h: window.innerHeight - BAR_H };
}

function fitScale() {
  const a = area();
  let s = Math.min((a.w - 16) / V.bw, (a.h - 16) / V.bh);
  if (V.full) s = Math.min(s, 1);
  return s > 0 ? s : 1;
}

function applyTransform() {
  vimg.style.width = `${V.bw * V.scale}px`;
  vimg.style.height = `${V.bh * V.scale}px`;
  vimg.style.transform = `translate3d(${V.x}px, ${V.y}px, 0)`;
  const pct = V.scale * window.devicePixelRatio * 100;
  $('#v-zoom').textContent = V.full ? `${Math.round(pct)}%` : '…';
  $('#v-zoom').title = V.fitMode ? 'Adattata alla finestra · clic per 100% (1)' : 'Clic per adattare alla finestra (0)';
  stage.classList.toggle('fit', V.fitMode);
  vimg.style.imageRendering = V.full && pct >= 300 ? 'pixelated' : 'auto';
}

function clampPan() {
  const a = area();
  const sw = V.bw * V.scale;
  const sh = V.bh * V.scale;
  V.x = sw <= a.w ? a.x0 + (a.w - sw) / 2 : clamp(V.x, a.x0 + a.w - sw, a.x0);
  V.y = sh <= a.h ? a.y0 + (a.h - sh) / 2 : clamp(V.y, a.y0 + a.h - sh, a.y0);
}

function fit() {
  V.scale = fitScale();
  V.fitMode = true;
  clampPan();
  applyTransform();
}

function zoomTo(newScale, cx, cy) {
  const a = area();
  if (cx === undefined) { cx = a.x0 + a.w / 2; cy = a.y0 + a.h / 2; }
  const fs = fitScale();
  const max = V.full ? 16 / window.devicePixelRatio : fs * 8;
  newScale = Math.min(newScale, Math.max(max, fs));
  if (newScale <= fs * 1.001) { fit(); return; }
  const k = newScale / V.scale;
  V.x = cx - (cx - V.x) * k;
  V.y = cy - (cy - V.y) * k;
  V.scale = newScale;
  V.fitMode = false;
  clampPan();
  applyTransform();
}

const actualScale = () => 1 / window.devicePixelRatio;
function zoomStep(dir) { zoomTo(V.scale * (dir > 0 ? 1.25 : 0.8)); }
function zoomActual(cx, cy) {
  let s = actualScale();
  if (s <= fitScale() * 1.05) s = fitScale() * 2;
  zoomTo(s, cx, cy);
}

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(im));
    im.onerror = () => reject(new Error('load'));
    im.src = url;
  });
}

// Mostra un'immagine: prima la miniatura (subito), poi la versione a piena risoluzione
function setImage(url, im, full, path) {
  const sameImage = V.shown === path;
  const oldBw = V.bw;
  vimg.src = url;
  V.bw = im.naturalWidth || 1;
  V.bh = im.naturalHeight || 1;
  V.full = full;
  if (full) { V.natW = V.bw; V.natH = V.bh; }
  if (!sameImage || V.fitMode) { V.shown = path; fit(); } else {
    V.scale = V.scale * oldBw / V.bw;
    clampPan();
    applyTransform();
  }
}

async function fullUrl(f, urgent) {
  const k = thumbKey(f);
  if (S.previewDone.has(k)) return S.previewDone.get(k);
  let url;
  if (WEB_EXT.has(f.ext)) url = api.fileUrl(f.path);
  else {
    const p = await api.preview(f.path, urgent);
    url = p ? api.fileUrl(p) : null;
  }
  if (url) S.previewDone.set(k, url);
  return url;
}

async function showImage(i) {
  if (!S.view.length) { closeViewer(); return; }
  i = clamp(i, 0, S.view.length - 1);
  const it = S.view[i];
  if (V.item !== it) V.showRaw = false;
  V.idx = i;
  V.item = it;
  const token = ++V.token;
  const f = shownFile(it);
  updateViewerBar();
  if (S.settings.showInfo) loadInfo();

  let gotFull = false;
  const k = thumbKey(f);
  // 1) miniatura come segnaposto, se la versione piena non è già pronta
  if (!S.previewDone.has(k)) {
    getThumb(f).then(async url => {
      if (!url || gotFull || token !== V.token) return;
      try {
        const im = await loadImg(url);
        if (!gotFull && token === V.token) { V.natW = 0; setImage(url, im, false, f.path); }
      } catch { /* niente segnaposto */ }
    });
  }
  // 2) piena risoluzione
  const spinTimer = setTimeout(() => {
    if (token === V.token && !gotFull) {
      $('#vspinner span').textContent = f.kind === 'raw' ? 'Sviluppo del RAW…' : 'Caricamento…';
      $('#vspinner').hidden = false;
    }
  }, 250);
  try {
    const url = await fullUrl(f, true);
    if (token !== V.token) return;
    if (!url) throw new Error('preview');
    const im = await loadImg(url);
    if (token !== V.token) return;
    gotFull = true;
    setImage(url, im, true, f.path);
    if (S.settings.showInfo) renderInfo();
  } catch {
    if (token === V.token) toast('Non riesco a mostrare questa immagine a piena risoluzione');
  } finally {
    clearTimeout(spinTimer);
    if (token === V.token) $('#vspinner').hidden = true;
  }
  if (token === V.token) prefetch(i);
}

// Prepara in anticipo le immagini vicine (i RAW richiedono qualche istante)
function prefetch(i) {
  for (const d of [1, 2, -1]) {
    const it = S.view[i + d];
    if (!it) continue;
    const f = it.display;
    fullUrl(f, false).then(url => {
      if (url && WEB_EXT.has(f.ext) && d === 1) { const im = new Image(); im.src = url; }
    });
    getThumb(f);
  }
}

function updateViewerBar() {
  const it = V.item;
  if (!it) return;
  const f = shownFile(it);
  $('#v-name').textContent = it.pair ? f.name : it.name;
  const badge = $('#v-badge');
  badge.textContent = it.badge;
  badge.className = 'badge ' + it.badgeClass;
  badge.hidden = !it.badge;
  $('#v-pos').textContent = `${V.idx + 1} di ${S.view.length}`;
  $('#v-prev').disabled = V.idx <= 0;
  $('#v-next').disabled = V.idx >= S.view.length - 1;
  const rj = $('#v-rawjpg');
  rj.hidden = !it.pair;
  rj.textContent = V.showRaw ? 'RAW' : 'JPG';
  rj.classList.toggle('on', V.showRaw);
  $('#v-edit').title = `Apri ${it.pair ? (V.showRaw ? 'il RAW' : 'il JPG') + ' ' : ''}in Pixelmator Pro (⌘E)`;
}

function go(delta) {
  if (!S.view.length) return;
  const n = V.idx + delta;
  if (n < 0 || n >= S.view.length) return;
  showImage(n);
  if (V.playing) schedulePlay();
}

function toggleRaw() {
  if (!V.item || !V.item.pair) return;
  V.showRaw = !V.showRaw;
  showImage(V.idx);
}

// ---------- Informazioni EXIF ----------
function toggleInfo() {
  saveSetting({ showInfo: !S.settings.showInfo });
  $('#info').hidden = !S.settings.showInfo;
  viewer.classList.toggle('with-info', S.settings.showInfo);
  $('#v-info').classList.toggle('on', S.settings.showInfo);
  if (V.fitMode) fit(); else { clampPan(); applyTransform(); }
  if (S.settings.showInfo) loadInfo();
}

async function loadInfo() {
  const p = shownPath();
  if (!p) return;
  if (!S.exif.has(p)) {
    $('#info-body').innerHTML = '<p class="muted">Lettura dei dati…</p>';
    S.exif.set(p, api.exif(p));
  }
  await S.exif.get(p);
  if (shownPath() === p) renderInfo();
}

const fmt = {
  exposure: t => (t >= 1 ? `${Math.round(t * 10) / 10}″` : `1/${Math.round(1 / t)}`),
  fnumber: f => `f/${Math.round(f * 10) / 10}`,
  focal: f => `${Math.round(f)} mm`,
  bias: b => `${b > 0 ? '+' : ''}${Math.round(b * 100) / 100} EV`,
  size: b => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`),
  date: s => new Date(s).toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
};

async function renderInfo() {
  const p = shownPath();
  const job = S.exif.get(p);
  if (!job) return;
  const x = await job;
  if (shownPath() !== p) return;
  const f = shownFile();
  let cam = x.model || '';
  if (x.make && cam && !cam.toLowerCase().startsWith(x.make.split(' ')[0].toLowerCase())) cam = `${x.make} ${cam}`;
  if (!cam && x.make) cam = x.make;
  const expo = [
    x.exposure ? [fmt.exposure(x.exposure), 'tempo'] : null,
    x.fnumber ? [fmt.fnumber(x.fnumber), 'diaframma'] : null,
    x.iso ? [x.iso, 'ISO'] : null,
    x.focal ? [fmt.focal(x.focal), 'focale'] : null
  ].filter(Boolean);
  let html = '';
  if (cam || expo.length) {
    html += '<div class="info-hero">';
    if (cam) html += `<div class="cam">${esc(cam)}</div>`;
    if (x.lens) html += `<div class="lens">${esc(x.lens)}</div>`;
    if (expo.length) html += `<div class="expo">${expo.map(([v, l]) => `<div>${esc(v)}<small>${l}</small></div>`).join('')}</div>`;
    html += '</div>';
  }
  const rows = [];
  if (x.date) rows.push(['Scattata', fmt.date(x.date)]);
  if (x.bias !== undefined && x.bias !== 0) rows.push(['Compensazione', fmt.bias(x.bias)]);
  if (x.focal35 && x.focal && Math.round(x.focal35) !== Math.round(x.focal)) rows.push(['Focale eq. 35mm', `${Math.round(x.focal35)} mm`]);
  if (x.program) rows.push(['Programma', x.program]);
  if (x.metering) rows.push(['Esposimetro', x.metering]);
  if (x.whiteBalance) rows.push(['Bil. bianco', x.whiteBalance]);
  if (x.flash) rows.push(['Flash', x.flash]);
  if (V.full && V.natW && V.shown === p) {
    const mp = (V.natW * V.natH / 1e6).toFixed(1).replace('.', ',');
    rows.push(['Dimensioni', `${V.natW} × ${V.natH} px (${mp} MP)`]);
  }
  rows.push(['Formato', f.ext.toUpperCase() + (V.item.pair ? ` (coppia RAW + JPG)` : '')]);
  if (x.fileSize) rows.push(['Peso', fmt.size(x.fileSize)]);
  if (x.fileDate) rows.push(['Modificato', fmt.date(x.fileDate)]);
  if (x.software) rows.push(['Software', x.software]);
  if (x.artist) rows.push(['Autore', x.artist]);
  if (typeof x.lat === 'number' && typeof x.lon === 'number') {
    const ll = `${x.lat.toFixed(5)},${x.lon.toFixed(5)}`;
    rows.push(['Posizione', `<a href="https://maps.apple.com/?ll=${ll}&q=${encodeURIComponent(f.name)}" target="_blank">${ll} ↗</a>`, true]);
  }
  rows.push(['Nome file', f.name]);
  rows.push(['Cartella', dirname(f.path)]);
  html += '<dl>' + rows.map(([k, v, raw]) => `<dt>${k}</dt><dd>${raw ? v : esc(v)}</dd>`).join('') + '</dl>';
  if (!cam && !expo.length) html = '<p class="muted">Nessun dato di scatto (EXIF) in questo file.</p>' + html;
  $('#info-body').innerHTML = html;
}

// ---------- Presentazione e schermo intero ----------
function schedulePlay() {
  clearTimeout(V.timer);
  V.timer = setTimeout(async () => {
    if (!V.playing || !V.open) return;
    const n = V.idx + 1 >= S.view.length ? 0 : V.idx + 1;
    await showImage(n);
    if (V.playing) schedulePlay();
  }, (S.settings.slideshowSec || 4) * 1000);
}
function togglePlay() {
  if (V.playing) { stopPlay(); toast('Presentazione in pausa'); return; }
  V.playing = true;
  viewer.classList.add('playing');
  toast(`Presentazione · un'immagine ogni ${S.settings.slideshowSec || 4} secondi`);
  schedulePlay();
  pokeIdle();
}
function stopPlay() {
  V.playing = false;
  clearTimeout(V.timer);
  viewer.classList.remove('playing');
  viewer.classList.remove('idle');
}

function pokeIdle() {
  viewer.classList.remove('idle');
  clearTimeout(V.idleTimer);
  V.idleTimer = setTimeout(() => {
    if (V.open && (V.playing || S.fullscreen)) viewer.classList.add('idle');
  }, 2500);
}
viewer.addEventListener('mousemove', pokeIdle);

// ---------- Mouse e trackpad nel viewer ----------
stage.addEventListener('wheel', e => {
  e.preventDefault();
  pokeIdle();
  const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && e.wheelDeltaY && Math.abs(e.wheelDeltaY) >= 120 && e.wheelDeltaY % 120 === 0);
  if (mouseWheel) {
    const steps = e.deltaMode !== 0 ? Math.sign(e.deltaY) : Math.round(-e.wheelDeltaY / 120);
    zoomTo(V.scale * Math.pow(1.2, -steps), e.clientX, e.clientY);
  } else if (e.ctrlKey || e.metaKey) {
    zoomTo(V.scale * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
  } else if (!V.fitMode) {
    V.x -= e.deltaX;
    V.y -= e.deltaY;
    clampPan();
    applyTransform();
  }
}, { passive: false });

let drag = null;
stage.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: V.x, y: V.y, moved: false };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', e => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.sx;
  const dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) > 3) { drag.moved = true; stage.classList.add('dragging'); }
  if (drag.moved && !V.fitMode) {
    V.x = drag.x + dx;
    V.y = drag.y + dy;
    clampPan();
    applyTransform();
  }
});
const endDrag = () => { drag = null; stage.classList.remove('dragging'); };
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('dblclick', e => {
  if (V.fitMode) zoomActual(e.clientX, e.clientY); else fit();
});
stage.addEventListener('contextmenu', async e => {
  e.preventDefault();
  if (!V.item) return;
  const it = V.item;
  const c = await api.contextMenu(itemMenu(it, false));
  if (c === 'pix') api.openWith(shownPath(it), 'pixelmator');
  else runItemAction(c, it, V.idx, shownPath(it));
});

// Pulsanti del viewer
$('#v-close').addEventListener('click', closeViewer);
$('#v-prev').addEventListener('click', () => go(-1));
$('#v-next').addEventListener('click', () => go(1));
$('#v-zoomin').addEventListener('click', () => zoomStep(1));
$('#v-zoomout').addEventListener('click', () => zoomStep(-1));
$('#v-zoom').addEventListener('click', () => (V.fitMode ? zoomActual() : fit()));
$('#v-rawjpg').addEventListener('click', toggleRaw);
$('#v-info').addEventListener('click', toggleInfo);
$('#v-play').addEventListener('click', togglePlay);
$('#v-full').addEventListener('click', () => api.setFullscreen());
$('#v-finder').addEventListener('click', () => api.reveal(shownPath()));
$('#v-edit').addEventListener('click', () => api.openWith(shownPath(), 'pixelmator'));
$('#v-trash').addEventListener('click', () => trashItem(V.item));
$('#v-more').addEventListener('click', async () => {
  const it = V.item;
  if (!it) return;
  const m = [{ id: 'choose', label: 'Apri con un\'altra app…' }, { id: 'default', label: 'Apri con l\'app predefinita' }];
  if (it.pair) m.push('-', { id: 'pix-jpg', label: 'Apri il JPG in Pixelmator Pro' }, { id: 'pix-raw', label: 'Apri il RAW in Pixelmator Pro' });
  m.push('-', { id: 'speed', label: `Durata presentazione: ${S.settings.slideshowSec || 4} s (cambia)` });
  const c = await api.contextMenu(m);
  if (c === 'speed') {
    const opts = [2, 3, 4, 6, 8, 12];
    const cur = S.settings.slideshowSec || 4;
    const pick = await api.contextMenu(opts.map(s => ({ id: String(s), label: `${s} secondi${s === cur ? '  ✓' : ''}` })));
    if (pick) { saveSetting({ slideshowSec: +pick }); if (V.playing) schedulePlay(); toast(`Presentazione: ${pick} secondi per immagine`); }
    return;
  }
  runItemAction(c, it, V.idx, shownPath(it));
});

window.addEventListener('resize', () => {
  if (!V.open) return;
  if (V.fitMode) fit(); else { clampPan(); applyTransform(); }
});

// ---------- Tastiera ----------
function helpVisible() { return !$('#help').hidden; }
function toggleHelp(force) { $('#help').hidden = force === undefined ? !$('#help').hidden : !force; }
$('#help').addEventListener('click', () => toggleHelp(false));

document.addEventListener('keydown', e => {
  const k = e.key;
  const cmd = e.metaKey || e.ctrlKey;
  if (helpVisible()) { if (k === 'Escape' || k === '?') { e.preventDefault(); toggleHelp(false); } return; }

  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT') {
    if (e.target.id === 'search' && (k === 'Escape' || k === 'Enter' || k === 'ArrowDown')) {
      e.preventDefault();
      if (k === 'Escape') { e.target.value = ''; S.search = ''; computeView(); renderGrid(); }
      gridWrap.focus();
      if (k !== 'Escape' && S.view.length && S.sel < 0) setSel(0);
    }
    if (e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (k.startsWith('Arrow')) return;
  }
  if (k === '?') { e.preventDefault(); toggleHelp(true); return; }
  if (cmd && (k === 'e' || k === 'E')) {
    e.preventDefault();
    const it = V.open ? V.item : S.view[S.sel];
    if (it) api.openWith(V.open ? shownPath(it) : it.display.path, 'pixelmator');
    return;
  }
  if ((cmd && k === 'Backspace') || k === 'Delete') {
    e.preventDefault();
    trashItem(V.open ? V.item : S.view[S.sel]);
    return;
  }

  if (V.open) {
    pokeIdle();
    switch (k) {
      case 'ArrowRight': case 'PageDown': e.preventDefault(); go(1); break;
      case 'ArrowLeft': case 'PageUp': e.preventDefault(); go(-1); break;
      case 'Home': e.preventDefault(); showImage(0); break;
      case 'End': e.preventDefault(); showImage(S.view.length - 1); break;
      case '+': case '=': e.preventDefault(); zoomStep(1); break;
      case '-': case '_': e.preventDefault(); zoomStep(-1); break;
      case '0': e.preventDefault(); fit(); break;
      case '1': e.preventDefault(); zoomTo(actualScale()); break;
      case 'i': case 'I': if (!cmd) { e.preventDefault(); toggleInfo(); } break;
      case 'r': case 'R': if (!cmd) { e.preventDefault(); toggleRaw(); } break;
      case 'f': case 'F': if (!cmd) { e.preventDefault(); api.setFullscreen(); } break;
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'Escape':
        e.preventDefault();
        if (V.playing) stopPlay();
        else if (S.fullscreen) api.setFullscreen(false);
        else closeViewer();
        break;
      default: break;
    }
    return;
  }

  // Miniature
  const n = S.view.length;
  const move = d => { e.preventDefault(); if (!n) return; setSel(S.sel < 0 ? 0 : clamp(S.sel + d, 0, n - 1)); };
  if (cmd) {
    if (k === 'ArrowUp') { e.preventDefault(); goUp(); } else if (k === 'ArrowDown') {
      e.preventDefault(); if (S.sel >= 0) openViewer(S.sel);
    } else if (k === '[') { e.preventDefault(); goHistory(-1); } else if (k === ']') { e.preventDefault(); goHistory(1); } else if (k === '+' || k === '=') { e.preventDefault(); setThumbSize(S.settings.thumbSize + 30); } else if (k === '-') { e.preventDefault(); setThumbSize(S.settings.thumbSize - 30); }
    return;
  }
  switch (k) {
    case 'ArrowRight': move(1); break;
    case 'ArrowLeft': move(-1); break;
    case 'ArrowDown': move(gridCols()); break;
    case 'ArrowUp': move(-gridCols()); break;
    case 'Home': move(-n); break;
    case 'End': move(n); break;
    case 'Enter': case ' ': e.preventDefault(); if (n) openViewer(S.sel >= 0 ? S.sel : 0); break;
    case 'Escape': if (S.fullscreen) api.setFullscreen(false); break;
    default: break;
  }
});

// ---------- Trascina una cartella o una foto nella finestra ----------
let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('drop-hint'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drop-hint'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('drop-hint');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const p = api.pathForFile(file);
  if (p) openPath(p);
});

function openPath(p) {
  S.openedExternally = true;
  if (IMG_EXT.has(extOfPath(p))) {
    if (V.open) closeViewer();
    navigate(dirname(p), { focusPath: p, openViewer: true });
  } else {
    navigate(p);
  }
}

// ---------- Eventi dal menu e dal sistema ----------
api.on('open-path', openPath);
api.on('fullscreen', fs => {
  S.fullscreen = fs;
  document.body.classList.toggle('fullscreen', fs);
  pokeIdle();
});
api.on('menu', async action => {
  switch (action) {
    case 'open-folder': {
      const p = await api.chooseFolder();
      if (p) { if (V.open) closeViewer(); navigate(p); }
      break;
    }
    case 'refresh':
      S.thumbJobs.clear(); S.thumbDone.clear(); S.previewDone.clear(); S.exif.clear();
      S.loc = await api.locations();
      reload();
      break;
    case 'favorite': toggleFavorite(); break;
    case 'search': if (V.open) closeViewer(); $('#search').focus(); $('#search').select(); break;
    case 'sidebar': toggleSidebar(); break;
    case 'info': if (V.open) toggleInfo(); break;
    case 'slideshow':
      if (!V.open && S.view.length) openViewer(S.sel >= 0 ? S.sel : 0);
      if (V.open) togglePlay();
      break;
    case 'help': toggleHelp(); break;
    default: break;
  }
});

// Quando si torna sull'app (es. dopo aver esportato da Pixelmator) aggiorna la cartella
let lastFocusCheck = 0;
window.addEventListener('focus', async () => {
  const now = Date.now();
  if (now - lastFocusCheck < 1500) return;
  lastFocusCheck = now;
  api.locations().then(loc => { S.loc = loc; renderSidebar(); });
  if (!S.listing || S.listing.error) return;
  const m = await api.dirMtime(S.listing.path);
  if (m && m !== S.listing.mtime) reload();
});

// ---------- Avvio ----------
async function init() {
  document.body.classList.toggle('mac', api.platform === 'darwin');
  S.settings = { ...DEFAULTS, ...(await api.getSettings()) };
  const st = S.settings;
  document.body.classList.toggle('no-sidebar', !st.sidebar);
  applyThumbSize(st.thumbSize);
  $('#filter').value = st.filter;
  $('#sort').value = st.sort;
  $('#pair').checked = !!st.pairRaw;
  $('#btn-sortdir').classList.toggle('desc', st.sortDir < 0);
  S.fullscreen = await api.isFullscreen();
  document.body.classList.toggle('fullscreen', S.fullscreen);
  S.loc = await api.locations();
  renderSidebar();
  const pictures = (S.loc.places.find(p => p.icon === 'photo') || {}).path || S.loc.home;
  if (!S.openedExternally) await navigate(st.lastDir || pictures, { fallback: pictures });
  gridWrap.focus();
}
init();
