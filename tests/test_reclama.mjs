// Test de contract reclamă ↔ motor: cifrele din reclama-v1.md trebuie să iasă din motorul app.html.
// Rulare: node tests/test_reclama.mjs [app.html] [reclama-v1.md]
// Pică dacă: se schimbă o cifră în text, se schimbă motorul/exemplul sau reapare formularea ambiguă „8 din 130 (6,7%)".
import fs from 'node:fs';
import vm from 'node:vm';

const appFile = process.argv[2] ?? 'app.html';
const mdFile = process.argv[3] ?? 'reclama-v1.md';
const html = fs.readFileSync(appFile, 'utf8').replace(/\r\n/g, '\n');
const md = fs.readFileSync(mdFile, 'utf8').replace(/\r\n/g, '\n');
const a = html.indexOf('function calcMargin');
const b = html.indexOf('/* ══════════════════════════════════════════════════════════════\n     A3 · State');
if (a < 0 || b <= a) throw new Error('Nu găsesc motorul în ' + appFile);
const ctx = {}; vm.createContext(ctx);
vm.runInContext(html.slice(a, b) + ';globalThis.E={enrichItems,calcThresholds,classify,priceIncreaseEffect,parsePastedMenu,EXAMPLE_PASTE};', ctx);
const E = ctx.E;

const num = s => Number(String(s).replace(/\./g, '').replace(',', '.')); // „2.730" → 2730, „6,7" → 6.7
const rows = E.parsePastedMenu(E.EXAMPLE_PASTE).rows;
const items = E.enrichItems(rows), th = E.calcThresholds(items);
const cat = i => E.classify(i, th);
const byName = n => items.find(i => i.name.startsWith(n));
const CAT = { vedeta: 'Vedetă', potential: 'Potențial', muncitor: 'Muncitor', candidat: 'Candidat la eliminare' };

const out = []; const t = (n, fn) => { try { fn(); out.push([n, true]); } catch (e) { out.push([n, false, e.message]); } };
const ok = (c, m) => { if (!c) throw new Error(m); };

t('R1 tabelul din reclamă = motorul (vânzări, preț, cost, marjă, profit, popularitate, categorie)', () => {
  const lines = md.split('\n').filter(l => /^\| (Paste|Șnițel|Somon|Piept|Ceafă|Tochitura)/.test(l));
  ok(lines.length === 6, `rânduri în tabel: ${lines.length}`);
  for (const l of lines) {
    const c = l.split('|').slice(1, -1).map(x => x.trim());
    const it = items.find(i => i.name === c[0]); ok(it, 'lipsește din exemplu: ' + c[0]);
    ok(it.sales === num(c[1]) && it.price === num(c[2]) && it.cost === num(c[3]), 'sales/preț/cost ' + c[0]);
    ok(Math.abs(it.margin - num(c[5])) < 1e-9, 'marjă ' + c[0]);
    ok(Math.abs(it.margin * it.sales - num(c[6])) < 1e-9, 'profit ' + c[0]);
    ok(Math.abs(it.popularity - num(String(c[7]).replace('%', ''))) < 0.05, `popularitate ${c[0]}: ${it.popularity} vs ${c[7]}`);
    ok(CAT[cat(it)] === c[8], `categorie ${c[0]}: ${CAT[cat(it)]} vs ${c[8]}`);
  }
});
t('R2 orice „A ori/× B = sau , R" din text e aritmetic corect (minim 4)', () => {
  let n = 0;
  for (const m of md.matchAll(/(\d[\d.]*) (?:ori|×) (\d+)(?: lei)?\s*(?:=|,)\s*(?:doar )?(\d[\d.]*)/g)) {
    n++; ok(num(m[1]) * num(m[2]) === num(m[3]), `${m[0]}: ${num(m[1]) * num(m[2])}`);
  }
  ok(n >= 4, `găsite doar ${n}`);
});
t('R3 ghicitoarea: perechile preț×porții din captions = marja și vânzările din motor', () => {
  for (const [nm, sales] of [['Somon', 65], ['Paste', 130], ['Șnițel', 110]]) {
    const it = byName(nm); ok(it.sales === sales, 'vânzări ' + nm);
    const re = new RegExp(`${nm === 'Paste' ? 'paste' : nm.toLowerCase()} ${it.margin} lei × ${it.sales} porții|${nm.toLowerCase()} ${it.margin} × ${it.sales}`);
    ok(re.test(md), `lipsește în caption: ${nm} ${it.margin} × ${it.sales}`);
  }
});
t('R4 +5%: 195 lei și 8 porții (8,7 exact, 6,7%) apar în reclamă la fel ca în motor', () => {
  const p = byName('Paste'), e = E.priceIncreaseEffect(p, 0.05);
  ok(e.gain === 195 && e.maxLoss === 8, 'motor');
  ok(md.includes('+195 RON/lună') && md.includes('195 de lei în plus'), '195 lipsește');
  ok(md.includes('8 porții din 130'), '8 din 130 lipsește');
  ok(md.includes(String(Math.round(e.lossShare * 1000) / 10).replace('.', ',') + '%'), 'procentul 6,7% lipsește');
});
t('R5 formularea ambiguă „8 porții din 130 (6,7%)" nu mai apare nelămurită în subtitrare', () => {
  for (const l of md.split('\n')) if (/8 porții din 130 \(6,7%\)/.test(l) && !/pragul exact|până la|6,15/.test(l) && !/Subtitrarea/.test(l))
    throw new Error('rând ambiguu: ' + l.slice(0, 120));
});
t('R6 primul rând din fiecare caption: ≤125 caractere', () => {
  const blocks = [...md.matchAll(/^### V\d[^\n]*\n> ([^\n]+)/gm)];
  ok(blocks.length === 4, `caption-uri găsite: ${blocks.length}`);
  for (const m of blocks) ok(m[1].length <= 125, `${m[1].length} caractere: ${m[1].slice(0, 50)}`);
});
t('R7 fiecare caption: disclaimer „fără TVA" + „după ingrediente" + „vânzări neschimbate" în corp sau rând', () => {
  const sec = md.split('### V1')[1] ?? ''; ok(/după ingrediente/.test(sec) && /fără TVA/.test(sec) && /vânzări neschimbate/.test(sec), 'lipsesc disclaimerele');
});
t('R8 aplicația afișează „pragul exact" (textul din card)', () => {
  ok(html.includes('pragul exact:'), 'app.html nu are formularea nouă');
});

for (const [n, o, m] of out) console.log(`${o ? 'ok  ' : 'FAIL'} ${n}${o ? '' : ' — ' + m}`);
const f = out.filter(r => !r[1]).length;
console.log(`\n${out.length - f}/${out.length} teste trecute`);
if (f) process.exitCode = 1;
