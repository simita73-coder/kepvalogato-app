import { Capacitor, registerPlugin } from '@capacitor/core';

// Saját plugin (android-extra/AllFilesPlugin.java): java.io.File a "minden fájl kezelése" engedéllyel.
// A __MOCK_ALLFILES__ csak az automatikus tesztekhez van.
const AllFiles = window.__MOCK_ALLFILES__ || registerPlugin('AllFiles');

const VERSION = 'v3.1';
const $ = id => document.getElementById(id);
const IMG_EXT = /\.(jpe?g|jfif|pjpe?g|pjp|png|webp|gif|bmp|avif|heic|heif)$/i;
const VID_EXT = /\.(mp4|m4v|webm|mov|3gp|mkv|ogv|avi)$/i;
const isVideo = name => VID_EXT.test(name);
const isMedia = name => IMG_EXT.test(name) || VID_EXT.test(name);
const ZOOM = 2.5;
const HIST_MAX = 100;
const TAG_FILE = 'cimkek.txt';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

$('ver').textContent = VERSION;
document.title = 'Kép-videó válogató ' + VERSION;

// ---------------------------------------------------------------- tárolás (csak ezen az eszközön)
const K = { profiles: 'kv3_profiles', btn: 'kv_btn', hist: 'kv3_hist_', tags: 'kv3_tagfreq' };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const lsDel = k => { try { localStorage.removeItem(k); } catch {} };

let profiles = [];              // [{id, name, src, rec, dst, hide:[], rate, tags}]
let P = null;                   // az éppen futó profil
let E = null;                   // a szerkesztett profil (munkapéldány)
let editIsNew = false, autoName = true;
let btn = { h: 68, w: 0 };      // mappagombok mérete (w=0: automatikus szélesség)
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
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const parseRate = s => { const v = parseFloat(String(s).replace(',', '.')); return isFinite(v) ? clamp(v, 0.5, 2.5) : null; };

function toast(t, ms = 1500) {
  const el = $('toast'); el.textContent = t; el.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => el.style.display = 'none', ms);
}

async function ls(path) { return (await AllFiles.list({ path })).files || []; }

/** A képek és videók listázása; rec=true esetén az almappákkal együtt. */
async function scanMedia(src, rec, skipDir) {
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
      else if (isMedia(f.name)) out.push({ dir: d, name: f.name });
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

// ---------------------------------------------------------------- Android "vissza" gomb: képernyők veremben
const layers = [];                       // 'edit' | 'browse' | 'work'
const topLayer = () => layers[layers.length - 1] || null;
function openLayer(kind) { layers.push(kind); history.pushState({ k: kind }, ''); }
function closeLayer() { history.back(); }
window.addEventListener('popstate', () => {
  const l = layers.pop();
  if (l === 'work') leaveWork();
  else if (l === 'browse') leaveBrowse();
  else if (l === 'edit') leaveEdit();
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
  if (document.hidden || layers.length) return;
  await refreshPerm();
});

// ---------------------------------------------------------------- profilok
function normProfile(p) {
  return {
    id: p.id || newId(),
    name: String(p.name || ''),
    src: cleanPath(p.src), dst: cleanPath(p.dst),
    rec: !!p.rec,
    hide: Array.isArray(p.hide) ? p.hide : [],
    rate: clamp(+p.rate || 1.2, 0.5, 2.5),
    tags: !!p.tags,
  };
}
function loadProfiles() {
  let list = lsGet(K.profiles, null);
  if (!Array.isArray(list)) {
    // átvétel a régi (v2.x) egyetlen beállításból
    list = [];
    const src = cleanPath(lsGet('kv2_src', '')), dst = cleanPath(lsGet('kv2_dst', ''));
    if (src || dst) {
      const id = newId();
      list.push({ id, name: baseName(src) || 'Alap', src, dst, rec: !!lsGet('kv2_rec', false), hide: lsGet('kv2_hide', []), rate: lsGet('kv2_rate', 1.2), tags: false });
      const h = lsGet('kv2_hist', null); if (h) lsSet(K.hist + id, h);
    }
    lsSet(K.profiles, list);
  }
  profiles = list.map(normProfile);
}
const saveProfiles = () => lsSet(K.profiles, profiles);
const profTitle = p => p.name || baseName(p.src) || 'Névtelen profil';

function renderHome() {
  const box = $('profList');
  box.innerHTML = '';
  if (!profiles.length) {
    const s = document.createElement('small'); s.textContent = 'Még nincs profil. Hozz létre egyet az alábbi gombbal.'; box.appendChild(s); return;
  }
  for (const p of profiles) {
    const card = document.createElement('div'); card.className = 'card';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = profTitle(p);
    const pp = document.createElement('div'); pp.className = 'pp';
    pp.textContent = (p.src ? '/' + p.src : '(nincs forrás)') + '  →  ' + (p.dst ? '/' + p.dst : '(nincs cél)');
    const row = document.createElement('div'); row.className = 'row';
    const go_ = document.createElement('button'); go_.className = 'acc'; go_.textContent = '▶ Indítás'; go_.onclick = () => startProfile(p);
    const ed = document.createElement('button'); ed.textContent = '⚙'; ed.setAttribute('aria-label', 'Beállítások'); ed.onclick = () => openEdit(p);
    row.append(go_, ed);
    card.append(nm, pp, row);
    box.appendChild(card);
  }
}
$('newProf').onclick = () => openEdit(null);

// ---------------------------------------------------------------- mappagombok mérete (két szám + Alkalmaz)
function applyBtn() {
  const r = document.documentElement.style;
  r.setProperty('--bh', btn.h + 'px');
  r.setProperty('--bfs', Math.round(clamp(btn.h * 0.37, 14, 36)) + 'px');
  $('bhIn').value = btn.h; $('bwIn').value = btn.w;
  $('bprev').style.width = btn.w ? `min(${btn.w}px, 100%)` : 'auto';
}
$('bapply').onclick = () => {
  const h = parseInt($('bhIn').value, 10), w = parseInt($('bwIn').value, 10);
  btn.h = clamp(isFinite(h) ? h : 68, 40, 140);
  btn.w = isFinite(w) && w > 0 ? clamp(w, 60, 600) : 0;
  lsSet(K.btn, btn); applyBtn(); toast('Alkalmazva');
};

// ---------------------------------------------------------------- profil szerkesztése
function showPath(el, p) {
  el.textContent = p ? '/' + p : '(még nincs kiválasztva)';
  el.className = 'path' + (p ? '' : ' empty');
}
function openEdit(p) {
  editIsNew = !p;
  E = p ? normProfile(JSON.parse(JSON.stringify(p))) : normProfile({ rate: 1.2 });
  autoName = !p || !E.name || E.name === baseName(E.src);
  $('edTitle').textContent = p ? 'Profil beállítása' : 'Új profil';
  $('edName').value = E.name;
  $('edName').placeholder = baseName(E.src) || 'a képek mappájának neve';
  $('edRate').value = String(E.rate).replace('.', ',');
  $('edTags').checked = E.tags;
  $('rec').checked = E.rec;
  $('edDelete').style.display = p ? '' : 'none';
  $('home').style.display = 'none'; $('edit').style.display = 'block';
  $('edit').scrollTop = 0;
  openLayer('edit');
  refreshEdit();
}
function leaveEdit() {
  $('edit').style.display = 'none'; $('home').style.display = 'block';
  renderHome();
}
$('edName').oninput = () => { E.name = $('edName').value; autoName = false; };
$('rec').onchange = () => { E.rec = $('rec').checked; refreshEdit(); };
$('edTags').onchange = () => { E.tags = $('edTags').checked; };
$('edCancel').onclick = closeLayer;
$('edSave').onclick = () => {
  const r = parseRate($('edRate').value);
  if (r === null) { alert('A sebesség 0,5 és 2,5 közötti szám legyen (pl. 1,2).'); return; }
  E.rate = r; E.tags = $('edTags').checked; E.rec = $('rec').checked;
  E.name = ($('edName').value || '').trim() || baseName(E.src) || 'Profil';
  const i = profiles.findIndex(p => p.id === E.id);
  if (i >= 0) profiles[i] = E; else profiles.push(E);
  saveProfiles();
  closeLayer();
};
$('edDelete').onclick = () => {
  if (!confirm(`Törlöd a(z) „${profTitle(E)}" profilt? A fájlokhoz nem nyúl.`)) return;
  profiles = profiles.filter(p => p.id !== E.id);
  saveProfiles(); lsDel(K.hist + E.id);
  closeLayer();
};

let editToken = 0;
async function refreshEdit() {
  const my = ++editToken;
  showPath($('srcPath'), E.src); showPath($('dstPath'), E.dst);
  const info = $('srcInfo').firstChild;
  if (!granted) { info.textContent = ''; $('catList').innerHTML = ''; return; }

  if (E.src) {
    info.textContent = 'Fájlok számolása…';
    try {
      const items = await scanMedia(E.src, E.rec, E.dst);
      if (my !== editToken) return;
      const v = items.filter(i => isVideo(i.name)).length;
      info.textContent = items.length ? `${items.length} besorolatlan fájl (${items.length - v} kép, ${v} videó) van ebben a mappában.` : 'Nincs kép vagy videó ebben a mappában.';
    } catch (e) { if (my === editToken) info.textContent = '⚠ A mappa nem olvasható: ' + errText(e); }
  } else info.textContent = '';

  const list = $('catList');
  list.innerHTML = '';
  if (!E.dst) return;
  try {
    const dirs = await subDirs(E.dst);
    if (my !== editToken) return;
    if (!dirs.length) { list.innerHTML = '<small>Ebben a mappában még nincs almappa. Hozz létre egyet a mappaválasztóban („＋ Új mappa").</small>'; return; }
    for (const n of dirs) {
      const l = document.createElement('label'); l.className = 'chk';
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !E.hide.includes(n);
      c.onchange = () => { E.hide = E.hide.filter(x => x !== n); if (!c.checked) E.hide.push(n); };
      l.append(c, document.createTextNode(n));
      list.appendChild(l);
    }
  } catch (e) { list.innerHTML = '<small>⚠ A célmappa nem olvasható: ' + errText(e) + '</small>'; }
}

// ---------------------------------------------------------------- mappaválasztó
const br = { kind: 'src', path: '' };
$('srcBtn').onclick = () => openBrowse('src');
$('dstBtn').onclick = () => openBrowse('dst');

async function openBrowse(kind) {
  if (!(await refreshPerm())) { toast('Előbb add meg a fájlkezelési engedélyt (a főképernyőn).', 3500); return; }
  br.kind = kind;
  br.path = cleanPath(kind === 'src' ? E.src : E.dst);
  $('brTitle').textContent = kind === 'src' ? 'Válaszd ki a képek / videók mappáját' : 'Válaszd ki a célmappát (az almappái a kategóriák)';
  $('browse').style.display = 'flex';
  openLayer('browse');
  await brRender();
}
function leaveBrowse() { $('browse').style.display = 'none'; refreshEdit(); }

async function brRender() {
  let items = null;
  while (items === null) {                      // ha a mappa már nem létezik, feljebb lép
    try { items = await ls(br.path); }
    catch (e) { if (!br.path) { $('brList').textContent = 'A tárhely nem olvasható: ' + errText(e); return; } br.path = dirName(br.path); }
  }
  const dirs = items.filter(f => f.dir && !f.name.startsWith('.')).map(f => f.name).sort(coll.compare);
  const imgs = items.filter(f => !f.dir && IMG_EXT.test(f.name)).length;
  const vids = items.filter(f => !f.dir && VID_EXT.test(f.name)).length;
  $('brPath').textContent = '/' + br.path;
  $('brInfo').textContent = `${dirs.length} almappa, ${imgs} kép, ${vids} videó`;
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
  E[br.kind] = br.path;
  if (br.kind === 'dst') E.hide = [];
  if (br.kind === 'src' && autoName) {            // a profil neve alapból a forrásmappa neve
    E.name = baseName(br.path); $('edName').value = E.name;
  }
  $('edName').placeholder = baseName(E.src) || 'a képek mappájának neve';
  closeLayer();
};
$('brNew').onclick = async () => {
  const name = (prompt('Az új mappa neve:') || '').trim().replace(/[\\/]/g, '');
  if (!name) return;
  try { await AllFiles.mkdirs({ path: join(br.path, name) }); br.path = join(br.path, name); await brRender(); }
  catch (e) { toast('Nem sikerült: ' + errText(e), 3500); }
};

// ---------------------------------------------------------------- munkamenet
let queue = [];                 // a még besorolatlan fájlok: {dir, name}
let qi = 0;
let rank = new Map();           // fájl -> eredeti sorszám (visszavonásnál a helyére kerül vissza)
let cats = [];                  // kategóriák (a célmappa almappái)
let hist = [];                  // [{dir, name, from, to, tag}]: a visszavonáshoz (újraindítás után is megvan)
let sortedCount = 0;
let busy = false;
let suppressUntil = 0;
const relOf = it => join(it.dir, it.name);
const saveHist = () => { if (hist.length > HIST_MAX) hist = hist.slice(-HIST_MAX); lsSet(K.hist + P.id, hist); };

async function startProfile(p, switching = false) {
  if (!(await refreshPerm())) { toast('Előbb add meg a fájlkezelési engedélyt.', 3000); return; }
  if (!p.src) { alert('Ennél a profilnál nincs kiválasztva a képek mappája. Nyisd meg a ⚙ beállításokat.'); return; }
  if (!p.dst) { alert('Ennél a profilnál nincs kiválasztva a célmappa. Nyisd meg a ⚙ beállításokat.'); return; }
  if (switching) toast('Profil betöltése…', 20000);
  try {
    const dirs = (await subDirs(p.dst)).filter(n => !p.hide.includes(n));
    if (!dirs.length) { alert('A célmappában nincs megjelenített almappa. Hozz létre legalább egyet.'); return; }
    const items = await scanMedia(p.src, p.rec, p.dst);
    if (!items.length) { alert('Nincs besorolatlan kép vagy videó ebben a profilban: ' + profTitle(p)); return; }
    if (switching) teardownWork();                 // az előző profil munkafelülete lezárul
    P = p;
    hist = lsGet(K.hist + P.id, []);
    cats = dirs; queue = items; qi = 0; sortedCount = 0; pendingTag = '';
    rank = new Map(items.map((it, i) => [it, i]));
    if (P.tags) await loadTagFreq();
    buildPanel();
    if (!switching) {
      $('home').style.display = 'none'; $('work').style.display = 'flex';
      openLayer('work');
    }
    show();
    if (switching) toast('Profil: ' + profTitle(P), 2000);
    else toast('Koppints a képre a mappákhoz (újra koppintva eltűnnek; videónál közben szünetel) · húzd el a lapozáshoz · dupla koppintás = nagyítás / videónál szünet · jobbra-vissza húzás = fájlnév', 6000);
  } catch (e) { alert('Hiba: ' + errText(e)); }
  finally { if (switching) { const el = $('toast'); if (el.textContent === 'Profil betöltése…') el.style.display = 'none'; } }
}

function teardownWork() {
  cancelTap(); closeCats(); hideTagBar(); resetZoom();
  clearTimeout(infoTimer); $('info').classList.remove('show');
  preloaded.length = 0; $('img').removeAttribute('src'); unloadVideo();
  $('profPick').style.display = 'none';
}
function leaveWork() {
  teardownWork();
  $('work').style.display = 'none'; $('home').style.display = 'block';
  P = null;
  renderHome();
}

// ---- profilváltó a munkafelületről ----
function openProfPick() {
  closeCats();
  const box = $('profPickList');
  box.innerHTML = '';
  for (const p of profiles) {
    const b = document.createElement('button');
    b.textContent = (p === P ? '● ' : '') + profTitle(p);
    if (p === P) b.className = 'acc';
    b.style.cssText = 'display:block;width:100%;margin:5px 0;padding:14px;font-size:18px;text-align:left';
    b.onclick = () => { $('profPick').style.display = 'none'; if (p !== P) startProfile(p, true); };
    box.appendChild(b);
  }
  $('profPick').style.display = 'flex';
}
$('profPickX').onclick = () => { $('profPick').style.display = 'none'; };

// ---- gombpanel: Vissza, Menü, (sebesség), (címke), majd a mappák, végül az Új mappa ----
function buildPanel() {
  const box = $('cats');
  box.innerHTML = ''; box.classList.remove('open');
  const mk = (label, cls, fn) => {
    const b = document.createElement('button');
    b.textContent = label; if (cls) b.className = cls;
    b.onclick = ev => { ev.stopPropagation(); if (Date.now() < suppressUntil) return; fn(); };
    box.appendChild(b);
    return b;
  };
  mk('↩ Vissza', 'act', undo);
  mk('☰ Menü', 'act', () => closeLayer());
  mk('⇄ Profil', 'act', openProfPick);
  speedBtn = mk('', 'act', cycleSpeed);
  updateSpeedBtn();
  if (P.tags) mk('🏷 Címke', 'tag', openTagBar);
  cats.forEach(c => mk(c, '', () => choose(c)));
  mk('＋ Új mappa', 'new', newCategory);
}
function openCats() {
  commitTag();                          // a címkesáv eltűnik, a beírt címke megmarad
  if (curIsVideo()) { const v = $('vid'); if (!v.paused) { v.pause(); pausedByPanel = true; } }   // a panel alatt a videó szünetel
  const box = $('cats');
  box.classList.add('open');
  box.style.gridAutoColumns = btn.w ? `minmax(0, ${btn.w}px)` : 'minmax(0, max-content)';
  const cs = getComputedStyle(box);
  const avail = $('stage').clientHeight - parseFloat(cs.top) - parseFloat(cs.bottom);
  const rows = Math.max(1, Math.floor((avail + 6) / (btn.h + 6)));
  box.style.gridTemplateRows = `repeat(${rows}, ${btn.h}px)`;
}
function closeCats() {
  $('cats').classList.remove('open');
  if (pausedByPanel) { pausedByPanel = false; resumeVideo(); }     // a panel bezárásakor a videó folytatódik
}

async function newCategory() {
  const name = (prompt('Az új mappa neve:') || '').trim().replace(/[\\/]/g, '');
  if (!name) return;
  try {
    await AllFiles.mkdirs({ path: join(P.dst, name) });
    P.hide = P.hide.filter(x => x !== name); saveProfiles();
    cats = (await subDirs(P.dst)).filter(n => !P.hide.includes(n));
    buildPanel(); openCats();
    toast('Létrehozva: ' + name);
  } catch (e) { toast('Nem sikerült: ' + errText(e), 3500); }
}

// ---- címkézés (nem kötelező) ----
// A címke vesszővel elválasztott tételekből áll (pl. "N6, hajlékony lányok"). Az ajánlás a tételeket egyesével kínálja,
// gyakoriság szerint (a leggyakoribb elöl, görgethető). A tétel első 2+ karakterének beírása után csak az ezzel kezdődők
// (vagy amelyeknek valamelyik szava ezzel kezdődik) maradnak.
let pendingTag = '';
let tagFreq = {};                        // tétel -> előfordulás
const normTxt = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const tagItems = s => String(s || '').split(',').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
function cleanTag(s) {
  const seen = new Set(), out = [];
  for (const x of tagItems(s)) { const k = normTxt(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out.join(', ');
}
function addFreq(tag, d) {
  for (const x of tagItems(tag)) { tagFreq[x] = (tagFreq[x] || 0) + d; if (tagFreq[x] <= 0) delete tagFreq[x]; }
  lsSet(K.tags, tagFreq);
}
/** A gyakoriságok a célmappa cimkek.txt fájljából (ha nincs: az utoljára mentett helyi adatból). */
async function loadTagFreq() {
  tagFreq = {};
  try {
    const txt = (await AllFiles.readText({ path: join(P.dst, TAG_FILE) })).text || '';
    for (const line of txt.split('\n')) {
      const i = line.indexOf('\t');
      if (i > 0) for (const x of tagItems(line.slice(i + 1))) tagFreq[x] = (tagFreq[x] || 0) + 1;
    }
  } catch {
    const old = lsGet(K.tags, {});
    for (const [k, v] of Object.entries(old)) for (const x of tagItems(k)) tagFreq[x] = (tagFreq[x] || 0) + (+v || 1);
  }
}
function suggestions(fragment, used) {
  const f = normTxt(fragment.trim());
  let arr = Object.entries(tagFreq).filter(([x]) => !used.has(normTxt(x)));
  if (f.length >= 2) arr = arr.filter(([x]) => { const n = normTxt(x); return n.startsWith(f) || n.split(' ').some(w => w.startsWith(f)); });
  arr.sort((a, b) => b[1] - a[1] || coll.compare(a[0], b[0]));
  return arr.slice(0, 80).map(e => e[0]);
}
function showTagInfo() { $('tg').textContent = pendingTag ? '🏷 ' + pendingTag : ''; }
function renderChips() {
  const v = $('tagIn').value, c = v.lastIndexOf(',');
  const before = v.slice(0, c + 1).trim(), frag = v.slice(c + 1);
  const used = new Set(tagItems(before).map(normTxt));
  const box = $('tagChips'); box.innerHTML = ''; box.scrollTop = 0;
  for (const x of suggestions(frag, used)) {
    const b = document.createElement('button'); b.textContent = x;
    b.onmousedown = e => e.preventDefault();                       // a beviteli mező megtartja a fókuszt
    b.onclick = () => { $('tagIn').value = (before ? before + ' ' : '') + x + ', '; renderChips(); try { $('tagIn').focus(); } catch {} };
    box.appendChild(b);
  }
}
$('tagIn').addEventListener('input', renderChips);
function openTagBar() {
  closeCats();
  $('tagIn').value = pendingTag ? pendingTag + ', ' : '';
  renderChips();
  $('tagbar').style.display = 'block';
  setTimeout(() => { try { $('tagIn').focus(); } catch {} }, 50);
}
function hideTagBar() { $('tagbar').style.display = 'none'; try { $('tagIn').blur(); } catch {} }
function commitTag() {
  if ($('tagbar').style.display === 'block') { pendingTag = cleanTag($('tagIn').value); hideTagBar(); showTagInfo(); if (pendingTag) showInfo(2500); }
}
function clearTag() { pendingTag = ''; hideTagBar(); showTagInfo(); }
$('tagOk').onclick = () => { commitTag(); toast(pendingTag ? 'Címke: ' + pendingTag : 'Nincs címke', 1200); };
$('tagX').onclick = () => { clearTag(); };
$('tagIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('tagOk').click(); } });
for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'click']) $('tagbar').addEventListener(ev, e => e.stopPropagation());
const noteTag = tag => addFreq(tag, 1);
async function removeTagLine(to, tag) {
  const path = join(P.dst, TAG_FILE);
  const want = baseName(to) + '\t' + tag;
  const text = (await AllFiles.readText({ path })).text || '';
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i] === want) { lines.splice(i, 1); break; }
  await AllFiles.writeText({ path, text: lines.join('\n') });
  addFreq(tag, -1);
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
    cancelTap();
    if (curIsVideo()) togglePlay(); else toggleZoom(x, y);
    return;
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

// ---- videó ----
let speedBtn = null;
let pausedByPanel = false, wasPlayingBeforeHide = false;
const SPEEDS = [1, 1.2, 1.5, 2];
const curIsVideo = () => { const it = queue[qi]; return !!it && isVideo(it.name); };
function resumeVideo() {
  const v = $('vid');
  if (curIsVideo() && v.getAttribute('src')) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }
}
function unloadVideo() {
  const v = $('vid');
  pausedByPanel = false;
  try { v.pause(); } catch {}
  v.removeAttribute('src'); v.load();
  v.style.display = 'none';
  $('work').classList.remove('video');
}
function togglePlay() {
  const v = $('vid');
  if (v.paused) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); toast('▶', 500); }
  else { v.pause(); toast('⏸', 500); }
}
function updateSpeedBtn() {
  if (!speedBtn || !P) return;
  speedBtn.textContent = '⏩ ' + P.rate.toFixed(1) + '×';
  speedBtn.style.display = curIsVideo() ? '' : 'none';
}
function cycleSpeed() {
  const i = SPEEDS.findIndex(s => Math.abs(s - P.rate) < 0.05);
  P.rate = SPEEDS[(i + 1) % SPEEDS.length];
  saveProfiles();
  $('vid').playbackRate = P.rate;
  updateSpeedBtn();
}
const fmtTime = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function updateSeek() {
  const v = $('vid'), d = v.duration;
  const f = d > 0 && isFinite(d) ? clamp(v.currentTime / d, 0, 1) : 0;
  $('seekFill').style.width = (f * 100) + '%';
  $('seekKnob').style.left = (f * 100) + '%';
  $('seekTime').textContent = fmtTime(v.currentTime) + ' / ' + fmtTime(d);
}
{
  const v = $('vid');
  v.addEventListener('timeupdate', updateSeek);
  v.addEventListener('durationchange', updateSeek);
  v.addEventListener('loadedmetadata', () => { if (P) v.playbackRate = P.rate; updateSeek(); });
  const seekEl = $('seek');
  let seeking = false;
  const seekTo = e => {
    const r = seekEl.querySelector('.track').getBoundingClientRect();
    const f = clamp((e.clientX - r.left) / r.width, 0, 1);
    if (v.duration > 0 && isFinite(v.duration)) { v.currentTime = f * v.duration; updateSeek(); }
  };
  seekEl.addEventListener('pointerdown', e => { e.stopPropagation(); seeking = true; try { seekEl.setPointerCapture(e.pointerId); } catch {} seekTo(e); });
  seekEl.addEventListener('pointermove', e => { if (seeking) seekTo(e); });
  seekEl.addEventListener('pointerup', () => { seeking = false; });
  seekEl.addEventListener('pointercancel', () => { seeking = false; });
}
document.addEventListener('visibilitychange', () => {
  const v = $('vid');
  if (document.hidden) { wasPlayingBeforeHide = !v.paused && !!v.getAttribute('src'); try { v.pause(); } catch {} }
  else if (wasPlayingBeforeHide && topLayer() === 'work' && curIsVideo() && !pausedByPanel) { wasPlayingBeforeHide = false; resumeVideo(); }
});

// ---- megjelenítés és lapozás ----
const preloaded = [];                    // az előre betöltött szomszédos képek
function updateInfo() {
  const it = queue[qi];
  if (!it) { $('pos').textContent = 'Nincs több besorolatlan fájl 🎉'; $('fn').textContent = ''; return; }
  $('pos').textContent = `${qi + 1}/${queue.length}` + (sortedCount ? ` · ${sortedCount} besorolva` : '');
  $('fn').textContent = relOf(it);
}
function show() {
  resetZoom();
  clearTag();
  const it = queue[qi];
  const img = $('img'), vid = $('vid');
  updateInfo();
  unloadVideo();
  updateSpeedBtn();
  if (!it) { img.style.display = ''; img.removeAttribute('src'); showInfo(6000); return; }
  showInfo(2000);
  preloaded.length = 0;
  if (isVideo(it.name)) {
    img.removeAttribute('src'); img.style.display = 'none';
    $('work').classList.add('video');
    vid.style.display = 'block';
    vid.onerror = () => toast('Nem játszható le: ' + it.name, 3000);
    vid.defaultPlaybackRate = P.rate;
    vid.src = srcFor(relOf(it));
    vid.playbackRate = P.rate;
    updateSeek();
    const pr = vid.play(); if (pr && pr.catch) pr.catch(() => {});
    return;
  }
  img.style.display = '';
  img.onerror = () => toast('Nem jeleníthető meg: ' + it.name, 2500);
  img.src = srcFor(relOf(it));
  // a szomszédos képeket előre betölti, hogy a lapozás gyors legyen
  for (const n of [queue[qi + 1], queue[qi - 1]]) if (n && !isVideo(n.name)) { const im = new Image(); im.src = srcFor(relOf(n)); preloaded.push(im); }
}
function go(delta) {
  cancelTap();
  if (!queue.length) return;
  const n = qi + delta;
  if (n < 0) { toast('Ez az első fájl'); return; }
  if (n >= queue.length) { toast('Ez az utolsó fájl'); return; }
  closeCats();
  qi = n; show();
}

// ---- besorolás (a fájl azonnal átkerül a mappába) és visszavonás ----
async function choose(cat) {
  if (busy) return;
  const it = queue[qi];
  if (!it) return;
  busy = true;
  try {
    const from = relOf(it);
    const tag = P.tags ? cleanTag(pendingTag) : '';
    if (isVideo(it.name)) unloadVideo();       // a lejátszó engedje el a fájlt
    const to = await moveUnique(from, join(P.dst, cat), it.name);
    let savedTag = '';
    if (tag) {
      try { await AllFiles.appendText({ path: join(P.dst, TAG_FILE), text: baseName(to) + '\t' + tag + '\n' }); savedTag = tag; noteTag(tag); }
      catch (e) { toast('A címkét nem sikerült elmenteni: ' + errText(e), 4000); }
    }
    hist.push({ dir: it.dir, name: it.name, from, to, tag: savedTag }); saveHist();
    queue.splice(qi, 1); sortedCount++;
    cancelTap(); closeCats();
    if (qi >= queue.length) qi = queue.length - 1;
    if (!queue.length) { qi = 0; show(); toast('Minden fájl besorolva 🎉', 3000); return; }
    toast(`→ ${cat}` + (savedTag ? '  🏷 ' + savedTag : ''));
    show();
  } catch (e) { toast('Nem sikerült áthelyezni: ' + errText(e), 4000); if (curIsVideo()) show(); }
  finally { busy = false; }
}

async function undo() {
  if (busy) return;
  const h = hist[hist.length - 1];
  if (!h) { toast('Nincs mit visszavonni'); return; }
  busy = true;
  try {
    if (curIsVideo()) unloadVideo();
    const back = await moveUnique(h.to, h.dir, h.name);
    if (h.tag) { try { await removeTagLine(h.to, h.tag); } catch (e) { toast('A címkesort nem sikerült törölni: ' + errText(e), 4000); } }
    hist.pop(); saveHist(); sortedCount = Math.max(0, sortedCount - 1);
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
  } catch (e) { toast('Nem sikerült visszavonni: ' + errText(e), 4000); if (curIsVideo()) show(); }
  finally { busy = false; }
}

// Billentyűk (asztali teszteléshez)
document.addEventListener('keydown', e => {
  if ($('work').style.display !== 'flex' || (e.target && e.target.tagName === 'INPUT')) return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  else if (e.key === 'Backspace') undo();
  else if (/^[0-9]$/.test(e.key)) { const n = e.key === '0' ? 9 : +e.key - 1; if (cats[n]) choose(cats[n]); }
});

// ---------------------------------------------------------------- indulás
async function init() {
  const o = lsGet(K.btn, null);
  if (o) { btn.h = clamp(+o.h || 68, 40, 140); btn.w = clamp(+o.w || 0, 0, 600); }
  applyBtn();
  loadProfiles();
  renderHome();
  await refreshPerm();
}
init();
