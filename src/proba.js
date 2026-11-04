import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

// Saját plugin (android-extra/AllFilesPlugin.java): java.io.File a "minden fájl kezelése" engedéllyel
const AllFiles = registerPlugin('AllFiles');
const D = Directory.ExternalStorage;

const $ = id => document.getElementById(id);
const IMG = /\.(jpe?g|jfif|png|webp|gif|bmp|avif)$/i;
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const BASE = 'Download/KV_proba';

let ROOT = '/storage/emulated/0';
let lastList = [];     // az utolsó listázás fájljai
let lastDir = '';
let lastMove = null;   // {from, to}

// ---------------------------------------------------------------- napló
function log(msg, bad) {
  const el = document.createElement('div');
  if (bad) el.className = 'bad';
  el.textContent = new Date().toLocaleTimeString('hu-HU') + '  ' + msg;
  $('log').appendChild(el);
  $('log').scrollTop = $('log').scrollHeight;
}
const errText = e => (e && (e.message || e.errorMessage)) || JSON.stringify(e);

async function step(name, fn) {
  const t = performance.now();
  try {
    const r = await fn();
    log(`✔ ${name} (${Math.round(performance.now() - t)} ms)`);
    return r;
  } catch (e) {
    log(`✘ ${name}: ${errText(e)}`, true);
    throw e;
  }
}
window.addEventListener('error', e => log('✘ JS hiba: ' + e.message, true));
window.addEventListener('unhandledrejection', e => log('✘ Elfogatlan hiba: ' + errText(e.reason), true));

// ---------------------------------------------------------------- kép megjelenítése
function showImage(absPath) {
  return new Promise((resolve, reject) => {
    const img = $('img');
    img.onload = () => { log(`   kép betöltve: ${img.naturalWidth}×${img.naturalHeight}`); resolve(); };
    img.onerror = () => reject(new Error('a kép nem tölthető be: ' + img.src));
    img.src = Capacitor.convertFileSrc('file://' + absPath);
  });
}

// ---------------------------------------------------------------- engedély
async function refreshStatus() {
  const box = $('status');
  try {
    const i = await AllFiles.info();
    ROOT = i.root || ROOT;
    box.className = i.granted ? 'ok' : 'no';
    box.textContent = `Android API: ${i.sdk}\nMinden fájl kezelése: ${i.granted ? 'IGEN ✔' : 'NEM ✘ (nyomd meg az Engedély gombot)'}\nTárhely gyökere: ${i.root}`;
    box.style.whiteSpace = 'pre-line';
    return i.granted;
  } catch (e) {
    box.className = 'no';
    box.textContent = 'Az állapot nem kérdezhető le: ' + errText(e);
    return false;
  }
}
$('perm').onclick = async () => {
  try { await AllFiles.openSettings(); log('Beállítások megnyitva: kapcsold be az engedélyt, majd lépj vissza ide.'); }
  catch (e) { log('✘ A beállítások nem nyithatók meg: ' + errText(e), true); }
};
$('check').onclick = refreshStatus;
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });

// ---------------------------------------------------------------- önteszt
async function testOwn() {
  log('--- A) Saját plugin (java.io.File) ---');
  const d = BASE + '/A';
  await step('mappák létrehozása', async () => { await AllFiles.mkdirs({ path: d + '/forras' }); await AllFiles.mkdirs({ path: d + '/cel' }); });
  await step('próbakép írása', () => AllFiles.writeBase64({ path: d + '/forras/proba.png', data: PNG_1PX }));
  await step('áthelyezés forras → cel', () => AllFiles.move({ from: d + '/forras/proba.png', to: d + '/cel/proba.png' }));
  const names = await step('cel mappa listázása', async () => (await AllFiles.list({ path: d + '/cel' })).files.map(f => f.name));
  log('   cel tartalma: ' + names.join(', '));
  await step('kép megjelenítése', () => showImage(ROOT + '/' + d + '/cel/proba.png'));
  await step('50 próbafájl írása', async () => {
    for (let i = 0; i < 50; i++) await AllFiles.writeBase64({ path: `${d}/forras/s${i}.png`, data: PNG_1PX });
  });
  const t0 = performance.now();
  await step('50 fájl áthelyezése egyenként', async () => {
    for (let i = 0; i < 50; i++) await AllFiles.move({ from: `${d}/forras/s${i}.png`, to: `${d}/cel/s${i}.png` });
  });
  log(`   átlag: ${((performance.now() - t0) / 50).toFixed(1)} ms / áthelyezés`);
}

async function testFs() {
  log('--- B) Capacitor Filesystem plugin ---');
  const d = BASE + '/B';
  await step('mappák létrehozása', async () => {
    await Filesystem.mkdir({ path: d + '/forras', directory: D, recursive: true });
    await Filesystem.mkdir({ path: d + '/cel', directory: D, recursive: true });
  });
  await step('próbakép írása', () => Filesystem.writeFile({ path: d + '/forras/proba.png', data: PNG_1PX, directory: D, recursive: true }));
  await step('áthelyezés forras → cel', () => Filesystem.rename({ from: d + '/forras/proba.png', to: d + '/cel/proba.png', directory: D, toDirectory: D }));
  const names = await step('cel mappa listázása', async () => (await Filesystem.readdir({ path: d + '/cel', directory: D })).files.map(f => f.name));
  log('   cel tartalma: ' + names.join(', '));
}

$('selftest').onclick = async () => {
  $('selftest').disabled = true;
  log('=== Önteszt indul ===');
  if (!(await refreshStatus())) log('⚠ A "minden fájl kezelése" engedély nincs megadva, a próbák valószínűleg hibát adnak.', true);
  try { await testOwn(); } catch (e) { log('A) rész megszakadt.', true); }
  try { await testFs(); } catch (e) { log('B) rész megszakadt.', true); }
  log('=== Önteszt vége ===');
  $('selftest').disabled = false;
};
$('clean').onclick = async () => {
  try { await step('Próbafájlok törlése', () => AllFiles.removeTest({ path: BASE })); } catch (e) { /* a napló már jelezte */ }
};

// ---------------------------------------------------------------- valódi mappa
const cleanPath = p => p.trim().replace(/^\/+|\/+$/g, '');

$('list').onclick = async () => {
  const p = cleanPath($('dir').value);
  lastList = []; lastDir = p;
  try {
    const t = performance.now();
    const r = await AllFiles.list({ path: p });
    const ms = Math.round(performance.now() - t);
    lastList = r.files.filter(f => !f.dir);
    const imgs = lastList.filter(f => IMG.test(f.name));
    log(`✔ Saját plugin: ${r.files.length} elem, ebből ${imgs.length} kép (${ms} ms)`);
    log('   első képek: ' + (imgs.slice(0, 3).map(f => f.name).join(' | ') || '–'));
  } catch (e) { log('✘ Saját plugin listázás: ' + errText(e), true); }
  try {
    const t = performance.now();
    const r = await Filesystem.readdir({ path: p, directory: D });
    log(`✔ Filesystem plugin: ${r.files.length} elem (${Math.round(performance.now() - t)} ms)`);
  } catch (e) { log('✘ Filesystem plugin listázás: ' + errText(e), true); }
};
$('show').onclick = async () => {
  const f = lastList.find(x => IMG.test(x.name));
  if (!f) { log('Előbb listázd a mappát (legyen benne kép).', true); return; }
  try { await step('kép megjelenítése: ' + f.name, () => showImage(`${ROOT}/${lastDir}/${f.name}`)); } catch (e) { /* naplózva */ }
};

// ---------------------------------------------------------------- valódi fájl mozgatása
$('move').onclick = async () => {
  const from = cleanPath($('file').value);
  const dir = cleanPath($('target').value);
  if (!from || !dir) { log('Add meg a fájl útvonalát és a cél mappát.', true); return; }
  const to = dir + '/' + from.split('/').pop();
  try {
    await step(`áthelyezés: ${from} → ${to}`, () => AllFiles.move({ from, to }));
    lastMove = { from, to };
  } catch (e) { /* naplózva */ }
};
$('back').onclick = async () => {
  if (!lastMove) { log('Nincs mit visszamozgatni.', true); return; }
  try {
    await step(`visszamozgatás: ${lastMove.to} → ${lastMove.from}`, () => AllFiles.move({ from: lastMove.to, to: lastMove.from }));
    lastMove = null;
  } catch (e) { /* naplózva */ }
};

log('Képválogató próba v0.1 elindult.');
refreshStatus();
