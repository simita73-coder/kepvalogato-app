import { Capacitor, registerPlugin } from '@capacitor/core';

// Saját plugin (android-extra/AllFilesPlugin.java): java.io.File a "minden fájl kezelése" engedéllyel.
// A __MOCK_ALLFILES__ csak az automatikus tesztekhez van.
const AllFiles = window.__MOCK_ALLFILES__ || registerPlugin('AllFiles');

const VERSION = 'v2.0';
const $ = id => document.getElementById(id);
const IMG_EXT = /\.(jpe?g|jfif|pjpe?g|pjp|png|webp|gif|bmp|avif|heic|heif)$/i;
const ZOOM = 2.5;
const HIST_MAX = 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

$('ver').textContent = VERSION;
document.title = 'Képválogató ' + VERSION;

// ---------------------------------------------------------------- tárolás (csak ezen az eszközön)
const K = { src: 'kv2_src', dst: 'kv2_dst', rec: 'kv2_rec', hide: 'kv2_hide', btn: 'kv_btn', hist: 'kv2_hist' };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let cfg = { src: '', dst: '', rec: false, hide: [] };   // hide: a nem gombként használt almappák nevei
let btn = { h: 68, w: 0 };
let ROOT = '/storage/emulated/0';
let granted = false;

// ---------------------------------------------------------------- segédek
const errText = e => (e && (e.message || e.errorMessage)) || String(e);
const cleanPath = p => String(p || '').trim().replace(/^\/+|\/+$/g, '');
const join = (a, b) => (a && b) ? a + '/' + b : (a || b || '');
const baseName = p => p.slice(p.lastIndexOf('/') + 1);
const dirName = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const enc = p => p.split('/').map(encodeURIComponent).join('/');
const srcFor = rel => Capacitor.convertFileSrc('file://' + ROOT + '/' + enc(rel));
const isEmptyPath = p => p === '' || p == null;

function toast(t, ms = 1500) {
  const el = $('toast'); el.textContent = t; el.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => el.style.display = 'none', ms);
}

async function ls(path) { return (await AllFiles.list({ path })).files || []; }

/** A kép (és a mappanevek) listázása; rec=true esetén az almappákkal együtt. */
async function scanImages(src, rec, skipDir) {
  const out = [];
  const stack = [src];
  while (stack.length) {
    const d = stack.pop();
    if (skipDir && d === skipDir) continue;      // a célmappa nem lehet forrás is
    let items;
    try { items = await ls(d); } catch (e) { if (d === src) throw e; continue; }
    for (const f of items) {
      if (f.name.startsWith('.')) continue;
      if (f.dir) { if (rec) stack.push(join(d, f.name)); }
      else if (IMG_EXT.test(f.name)) out.push({ dir: d, name: f.name });
    }
  }
  out.sort((a, b) => a.dir === b.dir ? coll.compare(a.name, b.name) : coll.compare(a.dir, b.dir));
  return out;
}

async function subDirs(path) {
  return (await ls(path)).filter(f => f.dir && !f.name.startsWith('.')).map(f => f.name).sort(coll.compare);
}

/** Áthelyezés; ha a célban már van ilyen nevű fájl, "név (1).jpg" lesz. Visszaadja a végső útvonalat. */
async function moveUnique(from, toDir, name) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 0; n < 200; n++) {
    const to = join(toDir, n ? `${stem} (${n})${ext}` : name);
    try { await AllFiles.move({ from, to }); return to; }
    catch (e) { if (!/A cél már létezik/.test(errText(e))) throw e; }
  }
  throw new Error('Nem találtam szabad fájlnevet: ' + name);
}

// ---------------------------------------------------------------- Android "vissza" gomb kezelése
let layer = null;                       // 'work' | 'browse' | null
function openLayer(kind) { layer = kind; history.pushState({ k: kind }, ''); }
function closeLayer() { history.back(); }
window.addEventListener('popstate', () => {
  const l = layer; layer = null;
  if (l === 'work') leaveWork();
  else if (l === 'browse') leaveBrowse();
});

// ---------------------------------------------------------------- engedély
async function refreshPerm() {
  const box = $('perm');
  try {
    const i = await AllFiles.info();
    ROOT = i.root || ROOT; granted = !!i.granted;
    box.className = 'box ' + (granted ? 'ok' : 'no');
    box.textContent = granted ? 'Fájlkezelési engedély: megvan ✔' : 'A „minden fájl kezelése" engedély hiányzik ✘';
  } catch (e) {
    granted = false;
    box.className = 'box no';
    box.textContent = 'Az engedély állapota nem kérdezhető le: ' + errText(e);
  }
  $('permBtn').style.display = granted ? 'none' : '';
  return granted;
}
$('permBtn').onclick = async () => {
  try { await AllFiles.openSettings(); toast('Kapcsold be az engedélyt, majd lépj vissza ide.', 4000); }
  catch (e) { toast('A beállítások nem nyithatók meg: ' + errText(e), 4000); }
};
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || layer) return;
  if (await refreshPerm()) refreshSetup();
});

// ---------------------------------------------------------------- beállító képernyő
function saveCfg() { lsSet(K.src, cfg.src); lsSet(K.dst, cfg.dst); lsSet(K.rec, cfg.rec); lsSet(K.hide, cfg.hide); }
function showPath(el, p) {
  el.textContent = p ? '/' + p : '(még nincs kiválasztva)';
  el.className = 'path' + (p ? '' : ' empty');
}

let setupToken = 0;
async function refreshSetup() {
  const my = ++setupToken;
  showPath($('srcPath'), cfg.src); showPath($('dstPath'), cfg.dst);
  $('rec').checked = cfg.rec;
  const info = $('srcInfo').firstChild;
  if (!granted) { info.textContent = ''; $('catList').innerHTML = ''; return; }

  if (cfg.src) {
    info.textContent = 'Képek számolása…';
    try {
      const imgs = await scanImages(cfg.src, cfg.rec, cfg.dst);
      if (my !== setupToken) return;
      info.textContent = imgs.length ? `${imgs.length} besorolatlan kép van ebben a mappában.` : 'Nincs kép ebben a mappában.';
    } catch (e) { if (my === setupToken) info.textContent = '⚠ A mappa nem olvasható: ' + errText(e); }
  } else info.textContent = '';

  const list = $('catList');
  list.innerHTML = '';
  if (!cfg.dst) return;
  try {
    const dirs = await subDirs(cfg.dst);
    if (my !== setupToken) return;
    if (!dirs.length) { list.innerHTML = '<small>Ebben a mappában még nincs almappa. Hozz létre egyet a mappaválasztóban („＋ Új mappa").</small>'; return; }
    for (const n of dirs) {
      const l = document.createElement('label'); l.className = 'chk';
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !cfg.hide.includes(n);
      c.onchange = () => {
        cfg.hide = cfg.hide.filter(x => x !== n);
        if (!c.checked) cfg.hide.push(n);
        saveCfg();
      };
      l.append(c, document.createTextNode(n));
      list.appendChild(l);
    }
  } catch (e) { list.innerHTML = '<small>⚠ A célmappa nem olvasható: ' + errText(e) + '</small>'; }
}
$('rec').onchange = () => { cfg.rec = $('rec').checked; saveCfg(); refreshSetup(); };

// ---- mappagombok mérete ----
function applyBtn() {
  const r = document.documentElement.style;
  r.setProperty('--bh', btn.h + 'px');
  r.setProperty('--bfs', Math.round(clamp(btn.h * 0.37, 14, 36)) + 'px');
  $('bh').value = btn.h; $('bw').value = btn.w;
  $('bhVal').textContent = btn.h + ' px';
  $('bwVal').textContent = btn.w ? btn.w + ' px' : 'automatikus (a név hossza szerint)';
  $('bprev').style.width = btn.w ? `min(${btn.w}px, 100%)` : 'auto';
}
function saveBtn() { lsSet(K.btn, btn); }
$('bh').oninput = () => { btn.h = +$('bh').value; saveBtn(); applyBtn(); };
$('bw').oninput = () => { btn.w = +$('bw').value; saveBtn(); applyBtn(); };
$('bdef').onclick = () => { btn = { h: 68, w: 0 }; saveBtn(); applyBtn(); };

// ---------------------------------------------------------------- mappaválasztó
const br = { kind: 'src', path: '' };
$('srcBtn').onclick = () => openBrowse('src');
$('dstBtn').onclick = () => openBrowse('dst');

async function openBrowse(kind) {
  if (!(await refreshPerm())) { toast('Előbb add meg a fájlkezelési engedélyt.', 3000); return; }
  br.kind = kind;
  br.path = cleanPath(kind === 'src' ? cfg.src : cfg.dst);
  $('brTitle').textContent = kind === 'src' ? 'Válaszd ki a képek mappáját' : 'Válaszd ki a célmappát (az almappái a kategóriák)';
  $('browse').style.display = 'flex';
  openLayer('browse');
  await brRender();
}
function leaveBrowse() { $('browse').style.display = 'none'; refreshSetup(); }

async function brRender() {
  let items = null;
  while (items === null) {                      // ha a mappa már nem létezik, feljebb lép
    try { items = await ls(br.path); }
    catch (e) { if (!br.path) { $('brList').textContent = 'A tárhely nem olvasható: ' + errText(e); return; } br.path = dirName(br.path); }
  }
  const dirs = items.filter(f => f.dir && !f.name.startsWith('.')).map(f => f.name).sort(coll.compare);
  const imgs = items.filter(f => !f.dir && IMG_EXT.test(f.name)).length;
  $('brPath').textContent = '/' + br.path;
  $('brInfo').textContent = `${dirs.length} almappa, ${imgs} kép`;
  $('brUp').disabled = !br.path;
  const list = $('brList');
  list.innerHTML = '';
  if (!dirs.length) { const s = document.createElement('small'); s.textContent = 'Nincs almappa.'; list.appendChild(s); }
  for (const n of dirs) {
    const b = document.createElement('button');
    b.textContent = '📁 ' + n;
    b.onclick = () => { br.path = join(br.path, n); brRender(); };
    list.appendChild(b);
  }
  list.scrollTop = 0;
}
$('brUp').onclick = () => { br.path = dirName(br.path); brRender(); };
$('brCancel').onclick = closeLayer;
$('brOk').onclick = () => {
  cfg[br.kind] = br.path;
  if (br.kind === 'dst') cfg.hide = [];
  saveCfg();
  closeLayer();
};
$('brNew').onclick = async () => {
  const name = (prompt('Az új mappa neve:') || '').trim().replace(/[\\/]/g, '');
  if (!name) return;
  try { await AllFiles.mkdirs({ path: join(br.path, name) }); br.path = join(br.path, name); await brRender(); }
  catch (e) { toast('Nem sikerült: ' + errText(e), 3500); }
};

// ---------------------------------------------------------------- munkamenet
let queue = [];                 // a még besorolatlan képek: {dir, name}
let qi = 0;
let rank = new Map();           // kép -> eredeti sorszám (visszavonásnál a helyére kerül vissza)
let cats = [];                  // kategóriák (a célmappa almappái)
let history_ = lsGet(K.hist, []);   // [{dir, name, from, to}]: a visszavonáshoz (újraindítás után is megvan)
let sortedCount = 0;
let busy = false;
let suppressUntil = 0;
const relOf = it => join(it.dir, it.name);

$('start').onclick = async () => {
  if (!(await refreshPerm())) { toast('Előbb add meg a fájlkezelési engedélyt.', 3000); return; }
  if (!cfg.src) { alert('Válaszd ki a képek mappáját.'); return; }
  if (!cfg.dst) { alert('Válaszd ki a célmappát.'); return; }
  $('start').disabled = true; $('start').textContent = 'Betöltés…';
  try {
    const dirs = (await subDirs(cfg.dst)).filter(n => !cfg.hide.includes(n));
    if (!dirs.length) { alert('A célmappában nincs megjelenített almappa. Hozz létre legalább egyet.'); return; }
    const items = await scanImages(cfg.src, cfg.rec, cfg.dst);
    if (!items.length) { alert('Nincs besorolatlan kép a kiválasztott mappában.'); return; }
    cats = dirs; queue = items; qi = 0; sortedCount = 0;
    rank = new Map(items.map((it, i) => [it, i]));
    buildPanel();
    $('setup').style.display = 'none'; $('work').style.display = 'flex';
    openLayer('work');
    show();
    toast('Koppints a képre a mappákhoz (újra koppintva eltűnnek) · húzd el a lapozáshoz · dupla koppintás = nagyítás · jobbra-vissza húzás = fájlnév', 5000);
  } catch (e) { alert('Hiba: ' + errText(e)); }
  finally { $('start').disabled = false; $('start').textContent = '▶ Indítás'; }
};

function leaveWork() {
  cancelTap(); closeCats(); resetZoom();
  clearTimeout(infoTimer); $('info').classList.remove('show');
  preloaded.length = 0; $('img').removeAttribute('src');
  $('work').style.display = 'none'; $('setup').style.display = 'block';
  refreshSetup();
}

// ---- gombpanel: Vissza, Menü, majd a mappák, végül az Új mappa ----
function buildPanel() {
  const box = $('cats');
  box.innerHTML = ''; box.classList.remove('open');
  const mk = (label, cls, fn) => {
    const b = document.createElement('button');
    b.textContent = label; if (cls) b.className = cls;
    b.onclick = ev => { ev.stopPropagation(); if (Date.now() < suppressUntil) return; fn(); };
    box.appendChild(b);
  };
  mk('↩ Vissza', 'act', undo);
  mk('☰ Menü', 'act', () => closeLayer());
  cats.forEach(c => mk(c, '', () => choose(c)));
  mk('＋ Új mappa', 'new', newCategory);
}
function openCats() {
  const box = $('cats');
  box.classList.add('open');
  box.style.gridAutoColumns = btn.w ? `minmax(0, ${btn.w}px)` : 'minmax(0, max-content)';
  const cs = getComputedStyle(box);
  const avail = $('stage').clientHeight - parseFloat(cs.top) - parseFloat(cs.bottom);
  const rows = Math.max(1, Math.floor((avail + 6) / (btn.h + 6)));
  box.style.gridTemplateRows = `repeat(${rows}, ${btn.h}px)`;
}
function closeCats() { $('cats').classList.remove('open'); }

async function newCategory() {
  const name = (prompt('Az új mappa neve:') || '').trim().replace(/[\\/]/g, '');
  if (!name) return;
  try {
    await AllFiles.mkdirs({ path: join(cfg.dst, name) });
    cfg.hide = cfg.hide.filter(x => x !== name); saveCfg();
    cats = (await subDirs(cfg.dst)).filter(n => !cfg.hide.includes(n));
    buildPanel(); openCats();
    toast('Létrehozva: ' + name);
  } catch (e) { toast('Nem sikerült: ' + errText(e), 3500); }
}

// ---- nagyítás (dupla koppintás) ----
let zoom = 1, tx = 0, ty = 0;
function applyZoom() { $('img').style.transform = zoom === 1 ? '' : `translate(${tx}px,${ty}px) scale(${zoom})`; }
function resetZoom() { zoom = 1; tx = ty = 0; applyZoom(); }
function clampPan() {
  const img = $('img'), st = $('stage');
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh) { tx = ty = 0; return; }
  const W = st.clientWidth, H = st.clientHeight, s0 = Math.min(W / nw, H / nh);
  const mx = Math.max(0, (nw * s0 * zoom - W) / 2), my = Math.max(0, (nh * s0 * zoom - H) / 2);
  tx = clamp(tx, -mx, mx);
  ty = clamp(ty, -my, my);
}
function toggleZoom(x, y) {
  closeCats();
  if (zoom > 1) { resetZoom(); return; }
  const r = $('stage').getBoundingClientRect();
  zoom = ZOOM;
  tx = (x - r.left - r.width / 2) * (1 - zoom);
  ty = (y - r.top - r.height / 2) * (1 - zoom);
  clampPan(); applyZoom();
}

// ---- tájékoztató (kép sorszáma, fájlneve): 2 mp-ig látszik ----
let infoTimer;
function showInfo(ms = 2000) {
  const el = $('info');
  el.classList.add('show');
  clearTimeout(infoTimer);
  infoTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---- érintés: koppintás, dupla koppintás, elhúzás, jobbra-vissza húzás ----
let ptr = null, lastTap = null, tapTimer = null;
const st = $('stage');
function cancelTap() { clearTimeout(tapTimer); lastTap = null; }
function tap(x, y) {
  const now = Date.now();
  if (lastTap && now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
    cancelTap(); toggleZoom(x, y); return;
  }
  lastTap = { t: now, x, y };
  tapTimer = setTimeout(() => {          // egyszeri koppintás: gombpanel ki/be
    lastTap = null;
    $('cats').classList.contains('open') ? closeCats() : openCats();
  }, 280);
}
st.addEventListener('pointerdown', e => {
  if (e.isPrimary === false) { ptr = null; return; }
  const onBtn = !!e.target.closest('#cats button');
  ptr = { x: e.clientX, y: e.clientY, sx: tx, sy: ty, moved: false, max: 0, onBtn };
  if (!onBtn) { try { st.setPointerCapture(e.pointerId); } catch {} }
});
st.addEventListener('pointermove', e => {
  if (!ptr) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  ptr.max = Math.max(ptr.max, Math.abs(dx));
  if (Math.abs(dx) > 8 || Math.abs(dy) > 8) ptr.moved = true;
  if (zoom > 1 && !ptr.onBtn) { tx = ptr.sx + dx; ty = ptr.sy + dy; clampPan(); applyZoom(); }
});
st.addEventListener('pointercancel', () => { ptr = null; });
st.addEventListener('pointerup', e => {
  if (!ptr) return;
  const p = ptr; ptr = null;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (zoom > 1 && !p.onBtn && p.moved) return;
  if (zoom === 1 && Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
    suppressUntil = Date.now() + 400;
    go(dx < 0 ? 1 : -1);                 // balra húzás = következő, jobbra húzás = előző
    return;
  }
  if (p.onBtn) return;
  if (zoom === 1 && p.max > 40 && Math.abs(dx) < 30 && Math.abs(dy) < 40) { showInfo(3000); return; }
  if (Math.abs(dx) < 15 && Math.abs(dy) < 15) tap(e.clientX, e.clientY);
});

// ---- megjelenítés és lapozás ----
const preloaded = [];                    // az előre betöltött szomszédos képek (hogy a böngésző meg ne feledkezzen róluk)
function updateInfo() {
  const it = queue[qi];
  if (!it) { $('pos').textContent = 'Nincs több besorolatlan kép 🎉'; $('fn').textContent = ''; return; }
  $('pos').textContent = `${qi + 1}/${queue.length}` + (sortedCount ? ` · ${sortedCount} besorolva` : '');
  $('fn').textContent = relOf(it);
}
function show() {
  resetZoom();
  const it = queue[qi];
  const img = $('img');
  updateInfo();
  if (!it) { img.removeAttribute('src'); showInfo(6000); return; }
  showInfo(2000);
  img.onerror = () => toast('Nem jeleníthető meg: ' + it.name, 2500);
  img.src = srcFor(relOf(it));
  preloaded.length = 0;
  for (const n of [queue[qi + 1], queue[qi - 1]]) if (n) { const im = new Image(); im.src = srcFor(relOf(n)); preloaded.push(im); }
}
function go(delta) {
  cancelTap();
  if (!queue.length) return;
  const n = qi + delta;
  if (n < 0) { toast('Ez az első kép'); return; }
  if (n >= queue.length) { toast('Ez az utolsó kép'); return; }
  closeCats();
  qi = n; show();
}

// ---- besorolás (a fájl azonnal átkerül a mappába) és visszavonás ----
function saveHist() { if (history_.length > HIST_MAX) history_ = history_.slice(-HIST_MAX); lsSet(K.hist, history_); }

async function choose(cat) {
  if (busy) return;
  const it = queue[qi];
  if (!it) return;
  busy = true;
  try {
    const from = relOf(it);
    const to = await moveUnique(from, join(cfg.dst, cat), it.name);
    history_.push({ dir: it.dir, name: it.name, from, to }); saveHist();
    queue.splice(qi, 1); sortedCount++;
    cancelTap(); closeCats();
    if (qi >= queue.length) qi = queue.length - 1;
    if (!queue.length) { qi = 0; show(); toast('Minden kép besorolva 🎉', 3000); return; }
    toast(`→ ${cat}`);
    show();
  } catch (e) { toast('Nem sikerült áthelyezni: ' + errText(e), 4000); }
  finally { busy = false; }
}

async function undo() {
  if (busy) return;
  const h = history_[history_.length - 1];
  if (!h) { toast('Nincs mit visszavonni'); return; }
  busy = true;
  try {
    const back = await moveUnique(h.to, h.dir, h.name);
    history_.pop(); saveHist(); sortedCount = Math.max(0, sortedCount - 1);
    const it = [...rank.keys()].find(k => k.dir === h.dir && k.name === h.name) || { dir: h.dir, name: h.name };
    it.name = baseName(back);
    if (!rank.has(it)) rank.set(it, -1);
    let pos;
    const r = rank.get(it);
    if (r >= 0) { pos = queue.findIndex(q => rank.get(q) > r); if (pos < 0) pos = queue.length; }   // az eredeti helyére
    else pos = Math.min(qi, queue.length);                                                          // előző munkamenetből: az aktuális helyre
    queue.splice(pos, 0, it);
    qi = pos;
    cancelTap(); closeCats();
    show();
    toast('Visszavonva');
  } catch (e) { toast('Nem sikerült visszavonni: ' + errText(e), 4000); }
  finally { busy = false; }
}

// Billentyűk (asztali teszteléshez)
document.addEventListener('keydown', e => {
  if ($('work').style.display !== 'flex') return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  else if (e.key === 'Backspace') undo();
  else if (/^[0-9]$/.test(e.key)) { const n = e.key === '0' ? 9 : +e.key - 1; if (cats[n]) choose(cats[n]); }
});

// ---------------------------------------------------------------- indulás
async function init() {
  cfg.src = cleanPath(lsGet(K.src, ''));
  cfg.dst = cleanPath(lsGet(K.dst, ''));
  cfg.rec = !!lsGet(K.rec, false);
  cfg.hide = lsGet(K.hide, []);
  const o = lsGet(K.btn, null);
  if (o) { btn.h = clamp(+o.h || 68, 40, 140); btn.w = clamp(+o.w || 0, 0, 500); }
  applyBtn();
  showPath($('srcPath'), cfg.src); showPath($('dstPath'), cfg.dst);
  $('rec').checked = cfg.rec;
  if (await refreshPerm()) refreshSetup();
}
init();
