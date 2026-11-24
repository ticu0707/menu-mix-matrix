// Teste pentru motorul de calcul din app.html (MenuMix Matrix v1).
// Rulare: node tests/test_engine.mjs app.html [--mutants]
// Motorul se extrage din scriptul inline (de la `function calcMargin` până la secțiunea A3)
// și se rulează izolat în vm. Oracolele sunt independente: calcule de mână și forță brută.
import fs from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2] ?? 'app.html';
const runMutants = process.argv.includes('--mutants');
const html = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('function calcMargin');
const end = html.indexOf('/* ══════════════════════════════════════════════════════════════\n     A3 · State');
if (start < 0 || end < 0 || end <= start) throw new Error('Nu găsesc blocul motorului în ' + file);
const ENGINE = html.slice(start, end);

function load(src) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + `
    ;globalThis.E = { calcMargin, calcPopularity, calcThresholds, classify, enrichItems,
      priceIncreaseEffect, flipDistances, borderline, portionsToFlip, groupItems, parsePastedMenu, parsePastedNumber, MIN_GROUP,
      BORDER_MARGIN_SHARE, BORDER_SALES_SHARE };`, ctx);
  return ctx.E;
}

// ── Date ──
const MAINS = [ // felurile principale din reclama v1.3 (preț și cost fără TVA)
  ['Paste carbonara', 130, 30, 9], ['Somon la gratar', 65, 64, 26], ['Snitel vienez', 110, 36, 13],
  ['Ceafa de porc', 70, 40, 15], ['Tochitura', 60, 38, 15], ['Piept de pui', 90, 32, 10],
];
const OLD = [ // exemplul vechi din capturi
  ['Snitel vienez', 120, 35, 14], ['Ciorba radauteana', 180, 37, 21], ['Ciorba de vacuta', 80, 36, 22],
  ['Tochitura', 50, 45, 36], ['Dorada', 30, 48, 37],
];
const toRaw = rows => rows.map(([name, sales, price, cost]) => ({ name, sales, price, cost }));

function analyze(E, raw) {
  const items = E.enrichItems(raw);
  const t = E.calcThresholds(items);
  return { items, t, cats: items.map(i => E.classify(i, t)) };
}

// PRNG cu sămânță (mulberry32): fuzz reproductibil
function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function randomMenu(r) {
  const n = 4 + Math.floor(r() * 12);
  return Array.from({ length: n }, (_, k) => {
    const price = Math.round((15 + r() * 70) * 100) / 100;
    const cost = Math.round(price * (0.2 + r() * 0.6) * 100) / 100;
    return { name: 'P' + k, sales: 1 + Math.floor(r() * 250), price, cost };
  });
}

// ── Teste ──
function suite(E) {
  const results = [];
  const t = (name, fn) => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e.message]); } };
  const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`); };
  const near = (a, b, eps, msg) => { if (!(Math.abs(a - b) <= eps)) throw new Error(`${msg}: ${a} vs ${b}`); };

  // A. Clasificare clasică, calculată de mână
  t('A1 praguri feluri principale (12840/525, 70%/6)', () => {
    const { t: th } = analyze(E, toRaw(MAINS));
    near(th.marginLine, 12840 / 525, 1e-9, 'marjă ponderată');
    near(th.popLine, 70 / 6, 1e-9, 'prag popularitate');
  });
  t('A2 categorii feluri principale', () => {
    const { cats } = analyze(E, toRaw(MAINS));
    eq(cats.join(','), 'muncitor,vedeta,muncitor,vedeta,candidat,muncitor', 'categorii');
  });
  t('A3 exemplul vechi: praguri 7300/460 și 14%', () => {
    const { t: th, cats } = analyze(E, toRaw(OLD));
    near(th.marginLine, 7300 / 460, 1e-9, 'marjă ponderată');
    near(th.popLine, 14, 1e-9, 'prag');
    eq(cats.join(','), 'vedeta,vedeta,muncitor,candidat,candidat', 'categorii');
  });
  t('A4 exact pe prag = sus (≥)', () => {
    // 4 preparate, toate cu aceeași marjă și aceleași vânzări: totul e exact pe prag de marjă
    const raw = [1, 2, 3, 4].map(k => ({ name: 'x' + k, sales: 10, price: 20, cost: 10 }));
    const { cats } = analyze(E, raw);
    eq(cats.join(','), 'vedeta,vedeta,vedeta,vedeta', 'categorii');
  });

  // B. Creștere de preț și prag de rentabilitate
  t('B1 paste +5%: +1,50/porție, +195 RON, 6,67%, 8 porții', () => {
    const it = E.enrichItems(toRaw(MAINS))[0];
    const e = E.priceIncreaseEffect(it, 0.05);
    near(e.dp, 1.5, 1e-12, 'dp'); near(e.gain, 195, 1e-9, 'câștig');
    near(e.lossShare, 1.5 / 22.5, 1e-12, 'cotă'); eq(e.maxLoss, 8, 'porții');
  });
  t('B2 cazul exact (profit egal la L = 5)', () => {
    const it = E.enrichItems([{ name: 'x', sales: 100, price: 20, cost: 1 }])[0]; // m = 19, dp = 1
    eq(E.priceIncreaseEffect(it, 0.05).maxLoss, 5, 'porții');
  });
  t('B3 forță brută pe 300 de meniuri aleatoare (fiecare porție)', () => {
    const r = rng(20261124);
    for (let k = 0; k < 300; k++) {
      for (const it of E.enrichItems(randomMenu(r))) {
        for (const pct of [0.03, 0.05, 0.08]) {
          const dp = it.price * pct, base = it.margin * it.sales;
          let brute = -1;
          for (let L = 0; L <= it.sales; L++) if ((it.margin + dp) * (it.sales - L) >= base - 1e-9) brute = L;
          const e = E.priceIncreaseEffect(it, pct);
          if (e.maxLoss !== brute) throw new Error(`meniu ${k} ${it.name} pct ${pct}: ${e.maxLoss} vs ${brute}`);
          near(e.gain, dp * it.sales, 1e-9, 'câștig');
        }
      }
    }
  });

  // C. Distanța până la schimbarea categoriei, verificată prin recalcul complet
  function bruteMarginFlip(raw, idx) { // cel mai mic pas de 0,01 RON în cost care schimbă latura de marjă
    const base = analyze(E, raw);
    const high0 = base.items[idx].margin >= base.t.marginLine;
    for (let c = 1; c <= 100000; c++) {
      const mod = raw.map((x, j) => j === idx ? { ...x, cost: x.cost + (high0 ? c : -c) / 100 } : x);
      const a = analyze(E, mod);
      if ((a.items[idx].margin >= a.t.marginLine) !== high0) return c / 100;
    }
    return null;
  }
  function bruteSalesFlip(raw, idx) { // câte porții întregi schimbă latura de popularitate
    const base = analyze(E, raw);
    const high0 = base.items[idx].popularity >= base.t.popLine;
    for (let c = 1; c <= 100000; c++) {
      const s = raw[idx].sales + (high0 ? -c : c);
      if (s < 0) return null;
      const mod = raw.map((x, j) => j === idx ? { ...x, sales: s } : x);
      const a = analyze(E, mod);
      if ((a.items[idx].popularity >= a.t.popLine) !== high0) return c;
    }
    return null;
  }
  t('C1 feluri principale: marjă și porții = recalcul complet', () => {
    const raw = toRaw(MAINS);
    const items = E.enrichItems(raw);
    items.forEach((it, idx) => {
      const d = E.flipDistances(it, items);
      const bm = bruteMarginFlip(raw, idx);
      // forța brută merge în pași de 0,01: trecerea e între |Δ| și |Δ| + 0,01
      if (!(bm >= Math.abs(d.marginDelta) - 1e-9 && bm <= Math.abs(d.marginDelta) + 0.01 + 1e-9))
        throw new Error(`${it.name} marjă: formulă ${d.marginDelta} vs brut ${bm}`);
      eq(E.portionsToFlip(d.salesDelta), bruteSalesFlip(raw, idx), `${it.name} porții`);
    });
  });
  t('C2 ceafă: trece la Muncitor dacă marja scade cu peste 0,63 RON (mână)', () => {
    const items = E.enrichItems(toRaw(MAINS));
    const d = E.flipDistances(items[3], items);
    near(d.marginDelta, (12840 - 1750) / 455 - 25, 1e-9, 'Δmarjă');
    if (!E.borderline(items[3], d).margin) throw new Error('ar trebui la limită pe marjă (0,63 ≤ 5% × 40)');
  });
  t('C3 forță brută pe 60 de meniuri aleatoare', () => {
    const r = rng(7);
    for (let k = 0; k < 60; k++) {
      const raw = randomMenu(r);
      const items = E.enrichItems(raw);
      items.forEach((it, idx) => {
        const d = E.flipDistances(it, items);
        eq(E.portionsToFlip(d.salesDelta), bruteSalesFlip(raw, idx), `meniu ${k} ${it.name} porții`);
        const bm = bruteMarginFlip(raw, idx);
        if (bm !== null && !(bm >= Math.abs(d.marginDelta) - 1e-9 && bm <= Math.abs(d.marginDelta) + 0.01 + 1e-9))
          throw new Error(`meniu ${k} ${it.name} marjă: ${d.marginDelta} vs ${bm}`);
      });
    }
  });
  t('C4 ceilalți cu 0 vânzări: fără calcul (null)', () => {
    const items = [{ name: 'a', sales: 10, price: 10, cost: 5, margin: 5 }, { name: 'b', sales: 0, price: 10, cost: 5, margin: 5 }];
    const d = E.flipDistances(items[0], items);
    eq(d.marginDelta, null, 'marjă'); eq(E.borderline(items[0], d).any, false, 'limită');
  });
  t('C5 tochitura: +2 porții (62/527 ≥ 11,67% > 61/526) sau +1,65 RON marjă (11460/465 − 23)', () => {
    const items = E.enrichItems(toRaw(MAINS));
    const d = E.flipDistances(items[4], items);
    eq(E.portionsToFlip(d.salesDelta), 2, 'porții');
    near(d.marginDelta, 11460 / 465 - 23, 1e-9, 'Δmarjă');
    const b = E.borderline(items[4], d);
    eq(b.margin && b.sales, true, 'la limită pe ambele');
  });
  t('C6 somon: −5 porții îl scot din Vedetă (60 < 60,76 ≤ 61); 5 ≤ 10% × 65', () => {
    const items = E.enrichItems(toRaw(MAINS));
    const d = E.flipDistances(items[1], items);
    eq(E.portionsToFlip(d.salesDelta), 5, 'porții');
    eq(E.borderline(items[1], d).sales, true, 'la limită pe vânzări');
  });
  t('C7 exemplul vechi: Ciorba de văcuță NU e la limită cu regula clasică (2,26 > 5% × 36)', () => {
    const items = E.enrichItems(toRaw(OLD));
    const d = E.flipDistances(items[2], items);
    near(d.marginDelta, 6180 / 380 - 14, 1e-9, 'Δmarjă');
    eq(E.borderline(items[2], d).any, false, 'văcuță');
  });
  // D. Lipire din Excel / casa de marcat
  t('D1 numere: virgulă, punct, mii, spații, RON', () => {
    const P = E.parsePastedNumber;
    const cases = [['12,5', 12.5], ['12.5', 12.5], ['1.234,50', 1234.5], ['1.234', 1234], ['1 234', 1234],
      ['35 RON', 35], ['35lei', 35], ['0.125', 0.125], ['0,125', 0.125], ['2.500.000', 2500000], ['120', 120]];
    for (const [tok, want] of cases) near(P(tok), want, 1e-12, `„${tok}"`);
    for (const bad of ['', 'abc', '-5', '1,2,3', '12.', '1.23.4', '€5']) if (!Number.isNaN(P(bad))) throw new Error(`„${bad}" ar trebui respins`);
  });
  t('D2 tab, antet, coloana de categorie, rânduri goale, CRLF', () => {
    const txt = '\uFEFFPreparat\tVânzări\tPreț\tCost\tCategorie\r\nSnitel\t120\t35,50\t14\tPrincipale\r\n\r\nSupa\t180\t20\t6\r\n';
    const r = E.parsePastedMenu(txt);
    eq(r.headerSkipped, true, 'antet'); eq(r.rows.length, 2, 'rânduri'); eq(r.skipped.length, 0, 'ignorate');
    eq(r.rows[0].price, 35.5, 'preț'); eq(r.rows[0].category, 'Principale', 'categorie'); eq(r.rows[1].category, '', 'fără categorie');
  });
  t('D3 punct și virgulă ca separator', () => {
    const r = E.parsePastedMenu('Paste;130;30;9\nSomon;65;64;26');
    eq(r.rows.length, 2, 'rânduri'); eq(r.rows[1].cost, 26, 'cost');
  });
  t('D4 rânduri respinse cu motiv (fără separator, cost>preț, zero, text)', () => {
    const r = E.parsePastedMenu('Paste 130 30 9\nA\t10\t5\t8\nB\t0\t5\t2\nC\tzece\t5\t2\nD\t10\t5\nBun\t10\t5\t2');
    eq(r.rows.length, 1, 'valide'); eq(r.skipped.length, 5, 'ignorate');
    eq(r.skipped.map(x => x.line).join(','), '1,2,3,4,5', 'rândurile');
    if (!/separator|tab/.test(r.skipped[0].reason)) throw new Error('motiv separator: ' + r.skipped[0].reason);
  });
  t('D5 doar prima linie e antet; la a doua, text = rând respins', () => {
    const r = E.parsePastedMenu('x\ty\tz\tw\nAntet2\ta\tb\tc');
    eq(r.headerSkipped, true, 'antet'); eq(r.skipped.length, 1, 'al doilea respins');
  });
  t('D6 fuzz: nu aruncă, fără NaN, rândurile sunt mereu valide', () => {
    const r = rng(99), chars = ['\t', ';', '\n', ',', '.', ' ', '0', '5', '12', 'a', '-', '1.234,5', 'RON', '\u00a0'];
    for (let k = 0; k < 3000; k++) {
      let txt = ''; const n = Math.floor(r() * 40);
      for (let j = 0; j < n; j++) txt += chars[Math.floor(r() * chars.length)];
      const res = E.parsePastedMenu(txt);
      for (const row of res.rows) {
        if (![row.sales, row.price, row.cost].every(Number.isFinite)) throw new Error('NaN în ' + JSON.stringify(txt));
        if (!(row.sales > 0 && row.price > 0 && row.cost > 0 && row.cost <= row.price && row.name)) throw new Error('rând invalid din ' + JSON.stringify(txt));
      }
    }
  });
  t('D7 fișierul de 25+ rânduri: toate citite (limita o pune interfața)', () => {
    const txt = Array.from({ length: 40 }, (_, k) => `P${k}\t${10 + k}\t20\t8`).join('\n');
    eq(E.parsePastedMenu(txt).rows.length, 40, 'rânduri');
  });

  // E. Grupare pe categorii
  const mk = (cat, n, start = 0) => Array.from({ length: n }, (_, k) => ({ name: `${cat || 'x'}${start + k}`, sales: 10, price: 20, cost: 8, category: cat }));
  t('E1 fără categorii: un singur grup, nume gol', () => {
    const g = E.groupItems(mk('', 6)); eq(g.length, 1, 'grupuri'); eq(g[0].name, '', 'nume'); eq(g[0].items.length, 6, 'preparate');
  });
  t('E2 două categorii ≥4 + rest → grupuri + Altele', () => {
    const g = E.groupItems([...mk('Supe', 4), ...mk('Principale', 5), ...mk('Deserturi', 2), ...mk('', 1, 100)]);
    eq(g.map(x => x.name).join('|'), 'Supe|Principale|Altele', 'nume'); eq(g[2].items.length, 3, 'Altele'); eq(g[2].weak, true, 'slab');
  });
  t('E3 majuscule și spații: o singură categorie', () => {
    const g = E.groupItems([...mk('Supe', 2), ...mk(' supe ', 1, 10), ...mk('SUPE', 1, 20), ...mk('Principale', 4)]);
    eq(g.map(x => x.name + ':' + x.items.length).join('|'), 'Supe:4|Principale:4', 'grupuri');
  });
  t('E4 toate categoriile sub 4: tot meniul într-un grup', () => {
    const g = E.groupItems([...mk('A', 2), ...mk('B', 3), ...mk('', 1, 50)]);
    eq(g.length, 1, 'grupuri'); eq(g[0].items.length, 6, 'preparate'); eq(g[0].name, '', 'nume');
  });
  t('E5 nicio pierdere: fiecare preparat apare exact o dată (fuzz)', () => {
    const r = rng(5);
    for (let k = 0; k < 300; k++) {
      const items = randomMenu(r).map(i => ({ ...i, category: ['', 'A', 'B', 'a ', 'C'][Math.floor(r() * 5)] }));
      const g = E.groupItems(items);
      const names = g.flatMap(x => x.items.map(i => i.name)).sort().join(',');
      eq(names, items.map(i => i.name).sort().join(','), 'conservare');
    }
  });
  return results;
}

function report(results, label) {
  const failed = results.filter(r => !r[1]);
  if (label) return failed.length;
  for (const [n, ok, msg] of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : ' — ' + msg}`);
  console.log(`\n${results.length - failed.length}/${results.length} teste trecute`);
  return failed.length;
}

const fails = report(suite(load(ENGINE)));

if (runMutants) {
  const MUTANTS = [
    ['marjă medie simplă, nu ponderată', s => s.replace('items.reduce((a, i) => a + i.margin * i.sales, 0) / totalSales', 'items.reduce((a, i) => a + i.margin, 0) / items.length')],
    ['prag popularitate 100% în loc de 70%', s => s.replace('0.7 * (100 / items.length)', '1.0 * (100 / items.length)')],
    ['+5% din marjă, nu din preț (bug vechi)', s => s.replace('const dp = item.price * pct;', 'const dp = item.margin * pct;')],
    ['rotunjire în loc de floor la porții', s => s.replace('Math.floor(item.sales * lossShare + 1e-9)', 'Math.round(item.sales * lossShare)')],
    ['media tuturor în loc de a celorlalte', s => s.replace('(weighted - item.margin * item.sales) / rest', 'weighted / T')],
    ['clasificare cu > în loc de ≥', s => s.replace('item.margin     >= thresholds.marginLine', 'item.margin     > thresholds.marginLine')],
    ['grup valid de la 3 preparate', s => s.replace('const MIN_GROUP = 4;', 'const MIN_GROUP = 3;')],
    ['categorii sensibile la majuscule', s => s.replace('const k = c.toLowerCase();', 'const k = c;')],
    ['mii: punctul zecimal citit ca mii', s => s.replace('/^[1-9]\\d{0,2}(\\.\\d{3})+(,\\d+)?$/', '/^\\d{1,3}(\\.\\d{3})+(,\\d+)?$/')],
    ['cost > preț acceptat la lipire', s => s.replace("if (cost > price) { skipped.push", "if (false) { skipped.push")],
    ['porții fără +1 la coborâre', s => s.replace('Math.floor(-salesDelta + 1e-9) + 1', 'Math.floor(-salesDelta + 1e-9)')],
  ];
  let caught = 0;
  console.log('\nMutanți:');
  for (const [name, mut] of MUTANTS) {
    const src = mut(ENGINE);
    if (src === ENGINE) { console.log(`  NEAPLICAT  ${name}`); continue; }
    const f = report(suite(load(src)), name);
    console.log(`  ${f > 0 ? 'prins ' : 'SCĂPAT'}  ${name} (${f} teste picate)`);
    if (f > 0) caught++;
  }
  console.log(`${caught}/${MUTANTS.length} mutanți prinși`);
  if (caught !== MUTANTS.length) process.exitCode = 1;
}
if (fails > 0) process.exitCode = 1;
