// Browser-Tests für Lernkasten. Start: cd tests && npm install && npx playwright install chromium && npm test
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json'};
const KEY = 'lernkasten.v1', DAY = 86400000;
let server, base, browser;

before(async () => {
  server = http.createServer(async (req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
    try { const body = await readFile(file); res.writeHead(200, {'content-type': TYPES[extname(file)] || 'application/octet-stream'}); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

async function open(t, {mobile = false, sw = false, storage, init} = {}) {
  const ctx = await browser.newContext({
    serviceWorkers: sw ? 'allow' : 'block', acceptDownloads: true,
    ...(mobile ? {viewport: {width: 390, height: 700}, isMobile: true, hasTouch: true} : {}),
  });
  if (storage) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, s); }, [KEY, JSON.stringify(storage)]);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = []; page.requests = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('request', r => page.requests.push(r.url()));
  t.after(async () => { const errs = page.errors; await ctx.close(); assert.deepEqual(errs, [], 'JavaScript-Fehler auf der Seite'); });
  await page.goto(base);
  return page;
}
const state = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const tab = (page, name) => page.locator('nav.tabs').getByRole('button', {name, exact: true}).click();
const btn = (page, name, exact = true) => page.getByRole('button', {name, exact});
const dueCount = async page => (await page.locator('.big').first().textContent()).trim();
async function openSeedDeck(page) { await tab(page, 'Stapel'); await btn(page, 'Karten bearbeiten').first().click(); }
async function deckSettings(page, label) {
  await openSeedDeck(page);
  await page.getByLabel(label).check();
  await btn(page, 'Speichern').click();
  await tab(page, 'Lernen');
}
async function answerRight(page, n) {
  for (let i = 0; i < n; i++) { await btn(page, 'Antwort zeigen').click(); await btn(page, /^Richtig/, false).click(); }
}
function oneDeck(cards, extra = {}) {
  const now = Date.now();
  return {decks: [{id: 'd1', name: 'Test', created: now}], log: [], ...extra,
    cards: cards.map(([front, back], i) => ({id: 'c' + i, deckId: 'd1', front, back, created: now + i, ease: 2.5, interval: 0, reps: 0, due: now, right: 0, wrong: 0, lapses: 0, last: null}))};
}

// --- Datenschutz und Offline ---
test('lädt nichts von fremden Servern', async t => {
  const page = await open(t);
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(page.requests.filter(u => !u.startsWith(base)), []);
});

test('Schriften kommen aus dem eigenen fonts-Ordner', async t => {
  const page = await open(t);
  const loaded = await page.evaluate(async () => (await document.fonts.load('16px "Atkinson Hyperlegible"')).length);
  assert.ok(loaded > 0, 'Atkinson Hyperlegible nicht geladen');
  assert.ok(page.requests.some(u => u.startsWith(base + 'fonts/')), 'keine Anfrage an fonts/');
});

test('läuft nach dem ersten Laden offline mit Schriften', async t => {
  const page = await open(t, {sw: true});
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await page.reload();
  await page.locator('.brand').waitFor();
  const loaded = await page.evaluate(async () => (await document.fonts.load('16px "Atkinson Hyperlegible"')).length);
  assert.ok(loaded > 0, 'Schrift offline nicht verfügbar');
});

test('fragt dauerhaften Speicher an, sobald gespeichert wird', async t => {
  const page = await open(t, {init: () => { navigator.storage.persist = async () => { window.__persist = (window.__persist || 0) + 1; return true; }; }});
  await tab(page, 'Stapel');
  await page.getByLabel('Name').fill('Neu');
  await btn(page, 'Anlegen').click();
  assert.ok(await page.evaluate(() => window.__persist >= 1));
});

// --- Zurück-Taste ---
test('Zurück führt von der Statistik zur Startseite', async t => {
  const page = await open(t);
  await tab(page, 'Statistik');
  await page.goBack();
  await page.getByText('Heute fällig').waitFor({timeout: 2000});
});

test('Zurück aus der Lernrunde zeigt die Startseite', async t => {
  const page = await open(t);
  await btn(page, 'Alle fälligen lernen').click();
  await page.goBack();
  await page.getByText('Heute fällig').waitFor({timeout: 2000});
  assert.equal(await btn(page, 'Antwort zeigen').count(), 0);
});

test('Zurück aus dem Stapel-Editor zeigt die Stapelliste', async t => {
  const page = await open(t);
  await openSeedDeck(page);
  await page.goBack();
  await page.getByRole('heading', {name: 'Alle Stapel'}).waitFor({timeout: 2000});
  assert.equal(await page.getByRole('heading', {name: 'Karte hinzufügen'}).count(), 0);
});

// --- Lernansicht ---
test('Karte antippen deckt die Antwort auf', async t => {
  const page = await open(t);
  await btn(page, 'Alle fälligen lernen').click();
  await page.locator('.card').click();
  await btn(page, /^Richtig/, false).waitFor({timeout: 2000});
});

test('Rückgängig stellt Karte, Protokoll und Ansicht wieder her', async t => {
  const page = await open(t);
  await btn(page, 'Alle fälligen lernen').click();
  await btn(page, 'Antwort zeigen').click();
  await btn(page, /^Falsch/, false).click();
  await btn(page, 'Rückgängig').click();
  const s = await state(page);
  assert.equal(s.log.length, 0);
  assert.ok(s.cards.every(c => c.wrong === 0 && c.lapses === 0 && c.ease === 2.5));
  await btn(page, /^Richtig/, false).waitFor({timeout: 2000});
  assert.match(await page.locator('.card .q').textContent(), /to achieve/);
});

test('Karte lässt sich während der Lernrunde korrigieren', async t => {
  const page = await open(t);
  await btn(page, 'Alle fälligen lernen').click();
  await btn(page, 'Karte bearbeiten').click();
  await page.getByRole('textbox', {name: 'Antwort', exact: true}).fill('erreichen');
  await btn(page, 'Speichern').click();
  await btn(page, 'Antwort zeigen').click();
  assert.equal((await page.locator('.card .a').textContent()).trim(), 'erreichen');
});

test('Neue Karten: Tageslimit gilt über mehrere Runden', async t => {
  const page = await open(t);
  await tab(page, 'Daten');
  await page.getByLabel('Neue Karten pro Tag').fill('3');
  await page.getByLabel('Neue Karten pro Tag').press('Tab');
  await tab(page, 'Lernen');
  assert.equal(await dueCount(page), '3');
  await btn(page, 'Alle fälligen lernen').click();
  await answerRight(page, 3);
  await btn(page, 'Fertig').click();
  assert.equal(await dueCount(page), '0');
});

test('Rückwärts lernen verdoppelt die fälligen Karten', async t => {
  const page = await open(t);
  await deckSettings(page, 'Auch rückwärts lernen');
  assert.equal(await dueCount(page), '16');
});

test('Rückwärts-Karte zeigt die Rückseite als Frage', async t => {
  const page = await open(t);
  await deckSettings(page, 'Auch rückwärts lernen');
  await btn(page, 'Alle fälligen lernen').click();
  await answerRight(page, 8);
  assert.equal((await page.locator('.card .q').textContent()).trim(), 'erreichen, schaffen');
});

test('Rückwärts ausschalten blendet die Rückwärts-Karten aus, ohne sie zu löschen', async t => {
  const page = await open(t);
  await deckSettings(page, 'Auch rückwärts lernen');
  await openSeedDeck(page);
  await page.getByLabel('Auch rückwärts lernen').uncheck();
  await btn(page, 'Speichern').click();
  await tab(page, 'Lernen');
  assert.equal(await dueCount(page), '8');
  assert.equal((await state(page)).cards.filter(c => c.of).length, 8);
});

test('Eintipp-Modus erkennt eine richtige Alternative', async t => {
  const page = await open(t);
  await deckSettings(page, 'Antwort eintippen');
  await btn(page, 'Alle fälligen lernen').click();
  await page.getByLabel('Deine Antwort').fill(' Schaffen ');
  await btn(page, 'Prüfen').click();
  await page.locator('.typed.ok').waitFor({timeout: 2000});
});

test('Vorlesen nutzt die Sprache der Vorderseite', async t => {
  const page = await open(t, {init: () => {
    window.__spoken = [];
    window.SpeechSynthesisUtterance ??= class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', {value: {speak: u => window.__spoken.push({text: u.text, lang: u.lang}), cancel() {}}});
  }});
  await btn(page, 'Alle fälligen lernen').click();
  await page.getByRole('button', {name: 'Vorlesen'}).click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), [{text: 'to achieve', lang: 'en-US'}]);
});

// --- Stapel-Editor ---
test('Massenimport überspringt doppelte Karten', async t => {
  const page = await open(t);
  await openSeedDeck(page);
  await page.getByLabel(/Eine Karte pro Zeile/).fill('reliable ; zuverlässig\nneu ; new');
  await btn(page, 'Karten importieren').click();
  await page.locator('#toast', {hasText: 'übersprungen'}).waitFor({timeout: 2000});
  assert.equal((await state(page)).cards.length, 9);
});

test('CSV-Export lässt sich verlustfrei wieder importieren', async t => {
  const page = await open(t, {storage: oneDeck([['a;b', 'Zeile 1\nZeile 2'], ['Er sagt "hi"', 'x'], ['ä ö ü', 'ß']])});
  await openSeedDeck(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), btn(page, 'Als CSV exportieren').click()]);
  assert.match(dl.suggestedFilename(), /\.csv$/);
  const csv = await readFile(await dl.path(), 'utf8');
  assert.ok(csv.startsWith('﻿'), 'BOM für Excel fehlt');
  await tab(page, 'Stapel');
  await page.getByLabel('Name').fill('Kopie');
  await btn(page, 'Anlegen').click();
  await page.getByLabel(/Eine Karte pro Zeile/).fill(csv.slice(1));
  await btn(page, 'Karten importieren').click();
  const s = await state(page);
  const pairs = id => s.cards.filter(c => c.deckId === id).map(c => c.front + '|' + c.back).sort();
  const copy = s.decks.find(d => d.name === 'Kopie').id;
  assert.deepEqual(pairs(copy), pairs('d1'));
});

test('Suche filtert die Kartenliste beim Tippen', async t => {
  const page = await open(t);
  await openSeedDeck(page);
  await page.getByLabel('Karten durchsuchen').pressSequentially('relia');
  assert.equal(await page.locator('#cardlist .li:visible').count(), 1);
  assert.equal(await page.getByLabel('Karten durchsuchen').inputValue(), 'relia');
});

test('Löschen bestätigen: Fokus bleibt auf dem Button', async t => {
  const page = await open(t);
  await openSeedDeck(page);
  await btn(page, 'Löschen').first().focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Wirklich?');
});

// --- Sicherung ---
test('Sicherung als Datei herunterladen', async t => {
  const page = await open(t);
  await tab(page, 'Daten');
  const [dl] = await Promise.all([page.waitForEvent('download'), btn(page, 'Als Datei sichern').click()]);
  assert.match(dl.suggestedFilename(), /^lernkasten-sicherung-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(JSON.parse(await readFile(await dl.path(), 'utf8')).cards.length, 8);
});

test('Sicherungsdatei wählen füllt das Einspielen-Feld', async t => {
  const page = await open(t);
  await tab(page, 'Daten');
  const json = JSON.stringify(oneDeck([['x', 'y']]));
  await page.getByLabel('Sicherungsdatei wählen').setInputFiles({name: 's.json', mimeType: 'application/json', buffer: Buffer.from(json)});
  await page.waitForFunction(j => document.getElementById('imp').value === j, json);
});

test('Kaputte oder manipulierte Sicherung legt die App nicht lahm', async t => {
  const page = await open(t);
  await tab(page, 'Daten');
  await page.locator('#imp').fill(JSON.stringify({decks: [{id: 'x" onmouseover="alert(1)', name: 'X'}], cards: [{id: 'k', deckId: 'fehlt', front: 1}], log: {}}));
  await btn(page, 'Einspielen').click();
  await page.getByRole('button', {name: /Fortfahren/}).click();
  await page.getByText('Heute fällig').waitFor({timeout: 2000});
  await tab(page, 'Stapel');
  assert.equal(await page.locator('[onmouseover]').count(), 0);
  await page.reload(); // stellt die zuletzt offene Ansicht (Stapel) wieder her
  await page.getByRole('heading', {name: 'Alle Stapel'}).waitFor({timeout: 2000});
});

test('Protokoll älter als ein Jahr wird zusammengefasst, Statistik bleibt gleich', async t => {
  const now = Date.now();
  const log = [400, 400, 380, 1, 0].map((d, i) => ({t: now - d * DAY, c: 'c0', d: 'd1', ok: i % 2}));
  const page = await open(t, {storage: oneDeck([['a', 'b']], {log})});
  await tab(page, 'Statistik');
  assert.equal((await page.locator('.kpi b').first().textContent()).trim(), '5');
  await tab(page, 'Stapel');
  await page.getByLabel('Name').fill('Neu');
  await btn(page, 'Anlegen').click();
  const s = await state(page);
  assert.equal(s.log.length, 2);
  assert.ok(s.log.every(l => l.t > now - 366 * DAY));
  await tab(page, 'Statistik');
  assert.equal((await page.locator('.kpi b').first().textContent()).trim(), '5');
});

test('Zahlenfelder aus einer Sicherung können kein HTML einschleusen', async t => {
  const page = await open(t);
  await tab(page, 'Daten');
  await page.locator('#imp').fill(JSON.stringify({decks: [{id: 'd', name: 'X'}], newPerDay: '"><img src=x>',
    cards: [{id: 'k', deckId: 'd', front: 'a', back: 'b', wrong: '<img src=x>'}], old: {n: 1, ok: 0, d: {d: ['<img src=x>', 0]}}}));
  await btn(page, 'Einspielen').click();
  await page.getByRole('button', {name: /Fortfahren/}).click();
  await page.getByText('Heute fällig').waitFor({timeout: 2000});
  assert.equal(await dueCount(page), '1');
  for (const v of ['Stapel', 'Statistik', 'Daten']) { await tab(page, v); assert.equal(await page.locator('img').count(), 0, v); }
  await openSeedDeck(page);
  assert.equal(await page.locator('img').count(), 0);
});

test('Massenimport: offenes Anführungszeichen verschluckt keine Zeilen', async t => {
  const page = await open(t);
  await openSeedDeck(page);
  await page.getByLabel(/Eine Karte pro Zeile/).fill('"Carpe diem ; Nutze den Tag\nHaus ; house');
  await btn(page, 'Karten importieren').click();
  const fronts = (await state(page)).cards.map(c => c.front);
  assert.ok(fronts.includes('"Carpe diem') && fronts.includes('Haus'), fronts.join(' | '));
});

test('Massenimport: Anführungszeichen mitten im Text bleiben erhalten', async t => {
  const page = await open(t);
  await openSeedDeck(page);
  await page.getByLabel(/Eine Karte pro Zeile/).fill('"to be" or not ; Sein');
  await btn(page, 'Karten importieren').click();
  assert.ok((await state(page)).cards.some(c => c.front === '"to be" or not'));
});

// --- Verlauf, Randfälle ---
test('Viele Tab-Wechsel: „Lernen“ führt trotzdem zur Startseite', async t => {
  const page = await open(t);
  for (let i = 0; i < 30; i++) { await tab(page, 'Stapel'); await tab(page, 'Statistik'); }
  await tab(page, 'Lernen');
  await page.getByText('Heute fällig').waitFor({timeout: 2000});
});

test('Neu laden in der Lernrunde: Zurück nach neuer Runde zeigt die Startseite', async t => {
  const page = await open(t);
  await btn(page, 'Alle fälligen lernen').click();
  await page.reload();
  await btn(page, 'Alle fälligen lernen').click();
  await page.goBack();
  await page.getByText('Heute fällig').waitFor({timeout: 2000});
  assert.equal(await btn(page, 'Antwort zeigen').count(), 0);
});

test('Doppelter Tipp auf „Beenden“ verlässt die App nicht', async t => {
  const page = await open(t);
  await btn(page, 'Alle fälligen lernen').click();
  await page.evaluate(() => { const b = document.querySelector('#app [data-v="home"]'); b.click(); b.click(); });
  await page.waitForTimeout(500);
  assert.ok(page.url().startsWith(base), page.url());
  await page.getByText('Heute fällig').waitFor({timeout: 2000});
});

test('Eintipp-Modus: Karte antippen prüft die Eingabe trotzdem', async t => {
  const page = await open(t);
  await deckSettings(page, 'Antwort eintippen');
  await btn(page, 'Alle fälligen lernen').click();
  await page.getByLabel('Deine Antwort').fill('schaffen');
  await page.locator('.card').click();
  await page.locator('.typed.ok').waitFor({timeout: 2000});
});

test('Service Worker speichert keine Fehlerseite als App', async t => {
  const page = await open(t, {sw: true});
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.goto(base + 'gibt-es-nicht');
  await page.context().setOffline(true);
  await page.goto(base);
  await page.locator('.brand').waitFor({timeout: 2000});
});

// --- Mobil und Gestaltung ---
test('Mobil: Navigation unten, in der Lernrunde ausgeblendet', async t => {
  const page = await open(t, {mobile: true});
  const box = await page.locator('nav.tabs').boundingBox();
  assert.ok(box.y + box.height > 700 - 90, 'Navigation nicht unten');
  await btn(page, 'Alle fälligen lernen').click();
  assert.equal(await page.locator('nav.tabs').isVisible(), false);
});

test('Mobil: Bewerten-Buttons bleiben bei langer Antwort sichtbar', async t => {
  const page = await open(t, {mobile: true, storage: oneDeck([['Frage', 'Sehr lange Antwort '.repeat(80)]])});
  await btn(page, 'Alle fälligen lernen').click();
  await btn(page, 'Antwort zeigen').click();
  const box = await btn(page, /^Richtig/, false).boundingBox();
  assert.ok(box.y + box.height <= 700, `Richtig-Button endet bei ${box.y + box.height}px`);
});

test('Mobil: Tastatur-Hinweise sind ausgeblendet', async t => {
  const page = await open(t, {mobile: true});
  await btn(page, 'Alle fälligen lernen').click();
  assert.equal(await page.locator('.keys').isVisible(), false);
});

test('theme-color passt zum Hintergrund, mit Dark-Mode-Variante', async t => {
  const page = await open(t);
  const metas = await page.$$eval('meta[name=theme-color]', ms => ms.map(m => [m.media, m.content.toLowerCase()]));
  assert.deepEqual(metas, [['(prefers-color-scheme: light)', '#eef1f6'], ['(prefers-color-scheme: dark)', '#0e131c']]);
});

test('Eingabefelder in Stapel-Editor und Daten haben keinen Leerraum darunter', async t => {
  const page = await open(t, {mobile: true});
  await openSeedDeck(page);
  const h1 = (await page.locator('label.f', {hasText: 'Stapelname'}).boundingBox()).height;
  await tab(page, 'Daten');
  const h2 = (await page.locator('label.f', {hasText: 'Neue Karten pro Tag'}).boundingBox()).height;
  assert.ok(h1 < 100 && h2 < 100, `Höhen ${h1}px / ${h2}px`);
});

test('Seite hat genau eine h1', async t => {
  const page = await open(t);
  assert.equal(await page.locator('h1').count(), 1);
});
