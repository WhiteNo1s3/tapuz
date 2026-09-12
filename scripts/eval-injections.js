'use strict';

/**
 * eval-injections (v2.28) — "we want 99.9% effectiveness in our purpose and
 * injections" (Ben). This is the loop that makes that number a measurement
 * instead of a hope: every injection pack the CMS generates is sent to the
 * OWNER'S model — through the CMS's own pipeline (src/ai.js generate(), the
 * `local` provider by default: LM Studio / any OpenAI-shaped runtime on
 * loopback) — N times with varied briefs, and every reply is judged by the
 * REAL door that will receive it in the admin (extractThemeReply, the
 * bench compiler, pznSourceToBlocks, the menu organizer's parser). What is
 * counted: landed / refused, repairs the door had to make, warnings it
 * raised, tokens and seconds. The report is a markdown table + a JSON file
 * beside it, so a prompt change can be judged by its numbers.
 *
 *   node scripts/eval-injections.js                # every pack, 3 runs each
 *   node scripts/eval-injections.js theme 5        # one pack, 5 runs
 *   EVAL_BASE=http://127.0.0.1:1234/v1 EVAL_MODEL=tapuz-qwen node scripts/eval-injections.js
 *
 * Needs a model: it is NOT part of test:smoke. Output: docs/INJECTION-EVAL.md
 * and docs/injection-eval.json (the latest run), plus every raw reply under
 * <tmp>/tapuz-eval/replies for reading what the model actually wrote.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(os.tmpdir(), 'tapuz-eval');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'replies'), { recursive: true });
process.env.TAPUZ_ROOT = ROOT;

const BASE = process.env.EVAL_BASE || 'http://127.0.0.1:1234/v1';
const MODEL = process.env.EVAL_MODEL || '';
const ONLY = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : '';
const RUNS = Number(process.argv[3] || (/^\d+$/.test(process.argv[2] || '') ? process.argv[2] : 3));

require('../src/db');
const { runSetup } = require('../src/setup');
runSetup({
  title: 'פרחי נועה', description: 'חנות פרחים וינטג׳ בתל אביב',
  colors: { primary: '#ea580c', bg: '#fffbf7', lightBg: '#fdf1e6', text: '#1c1917' },
  menuPlacement: 'top', pages: ['home', 'about', 'contact', 'articles'], menuPages: ['home', 'about', 'contact', 'articles'], external: []
});
const ai = require('../src/ai');
ai.saveSettings({ provider: 'local', baseUrl: BASE, model: MODEL });

// ── the briefs: varied, so a pack is judged on more than one wish ──────
const THEME_BRIEFS = [
  'חנות פרחים וינטג׳ פריזאית — פסטל, סריפים, תחושת נייר ישן, כפתורים במסגרת, תפריט עם קו תחתון עדין',
  'סטארטאפ סייבר — כהה, ניאון ירוק, פינות חדות, גופן טכני, הילה על הכפתורים',
  'גן ילדים שמח — צבעים בהירים, עיגולים, גופן עגול וידידותי, רקע נקודות',
  'משרד עורכי דין — לבן, כחול עמוק, סריף קלאסי, שטוח, אלגנטי ושמרני',
  'מסעדת שף — שחור וזהב, כותרות ענק, רקע גרדיאנט עדין, אפקט עכבר עדין של הילה זהובה'
];
const PAGE_BRIEFS = [
  'דף אודות לסטודיו צילום בתל אביב: הירו, שלושה יתרונות, גלריה של 4 תמונות, המלצה אחת וטופס יצירת קשר',
  'דף מחירון למכון כושר: הירו קצר, שלוש חבילות מחיר, שאלות נפוצות עם 4 שאלות, קריאה לפעולה',
  'דף שירותים לרואה חשבון: כותרת, פסקת פתיחה, 4 שירותים ביתרונות, שלבים של תהליך העבודה, טופס',
  'דף מוצר לנעל ריצה: הירו עם תמונה, יתרונות, סטטיסטיקות (3 מספרים), המלצות של 2 לקוחות, כפתור רכישה',
  'דף צוות למרפאת שיניים: הירו, צוות של 3 אנשים, שעות פתיחה, שאלות נפוצות, מפה וטופס'
];

/** Every pack the CMS ships, as a runnable descriptor. A pack that does not
 *  exist in this checkout (an injection not merged yet) is skipped, not failed. */
function packs() {
  const list = [];
  const themeRp = require('../src/theme-roleplay');
  const theme = require('../src/theme');
  list.push({
    id: 'theme-designer',
    briefs: THEME_BRIEFS,
    prompt: (brief) => themeRp.buildThemePrompt({ siteTitle: 'פרחי נועה', description: 'חנות פרחים', brief }).text,
    judge: (reply) => {
      const t = theme.extractThemeReply(reply, 'eval');
      let bench = { blocks: [], warnings: [] };
      let benchError = '';
      if (t.specimen) { try { bench = require('../src/theme-canvas').blocksFromSource(t.specimen); } catch (e) { benchError = e.message; } }
      return { landed: true, sections: Object.keys(t.overrides).length, warnings: t.warnings, repairs: bench.warnings, benchBlocks: bench.blocks.length, benchError, hasSkin: !!(t.overrides.skin && t.overrides.skin.css), hasEffect: !!(t.overrides.effects && t.overrides.effects.js) };
    }
  });
  const rp = require('../src/pzn/agent-roleplay');
  const { pznSourceToBlocks } = require('../src/pzn-source');
  const judgePage = (reply) => {
    const r = pznSourceToBlocks(reply);
    const count = (list) => list.reduce((n, b) => n + 1 + (b.data && Array.isArray(b.data.blocks) ? count(b.data.blocks) : 0) + (b.data && Array.isArray(b.data.columns) ? b.data.columns.reduce((m, c) => m + count(c.blocks || []), 0) : 0), 0);
    return { landed: true, blocks: count(r.view.blocks || []), repairs: (r.changes || []).map((c) => c.code || c.message), warnings: (r.extracted || []).map((c) => c.code), repaired: !!r.repaired, htmlBlocks: JSON.stringify(r.view.blocks).split('"type":"html"').length - 1 };
  };
  for (const size of ['lite', 'full']) {
    list.push({
      id: 'site-builder-' + size,
      briefs: PAGE_BRIEFS,
      prompt: (brief) => rp.buildRoleplayPack({ locale: 'he', size, playerBrief: brief, media: [] }).text,
      judge: judgePage
    });
  }
  try {
    const org = require('../src/menu-organizer');
    if (org && typeof org.buildMenuPrompt === 'function') {
      list.push({
        id: 'menu-organizer',
        briefs: ['סדר לי את התפריט — הדגש את יצירת הקשר', 'תפריט קצר: עד 5 פריטים למעלה, השאר בתפריטי משנה', 'תפריט צד עם קבוצות לפי נושא'],
        prompt: (brief) => org.buildMenuPrompt({ brief }).text,
        judge: (reply) => { const r = org.parseMenuReply(reply); return { landed: true, warnings: r.warnings || [], repairs: [], items: (r.plan && r.plan.items || []).length, placement: r.plan && r.plan.placement }; }
      });
    }
  } catch (e) { /* the organizer is not in this checkout */ }
  return list.filter((p) => !ONLY || p.id === ONLY);
}

async function runOne(pack, brief, i) {
  const prompt = pack.prompt(brief);
  const t0 = Date.now();
  let reply = '';
  let error = '';
  try {
    reply = await ai.generate({ system: '', user: prompt, history: [] });
  } catch (e) { error = 'MODEL: ' + e.message; }
  const seconds = Math.round((Date.now() - t0) / 1000);
  const file = path.join(ROOT, 'replies', `${pack.id}-${i}.md`);
  fs.writeFileSync(file, reply, 'utf8');
  if (error) return { pack: pack.id, i, brief, seconds, landed: false, error, promptChars: prompt.length, replyChars: 0 };
  try {
    const v = pack.judge(reply);
    return { pack: pack.id, i, brief, seconds, promptChars: prompt.length, replyChars: reply.length, ...v };
  } catch (e) {
    return { pack: pack.id, i, brief, seconds, promptChars: prompt.length, replyChars: reply.length, landed: false, error: 'DOOR: ' + e.message, code: e.code || '' };
  }
}

function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }

(async () => {
  const list = packs();
  if (!list.length) { console.error('no packs to run (unknown id?)'); process.exit(1); }
  console.log(`eval: ${list.map((p) => p.id).join(', ')} × ${RUNS} runs each → ${BASE} ${MODEL || '(loaded model)'}`);
  const results = [];
  for (const pack of list) {
    for (let i = 1; i <= RUNS; i++) {
      const brief = pack.briefs[(i - 1) % pack.briefs.length];
      const r = await runOne(pack, brief, i);
      results.push(r);
      console.log(`[${pack.id} #${i}] ${r.landed ? 'landed' : 'REFUSED'} ${r.seconds}s` +
        (r.error ? ' — ' + r.error.slice(0, 160) : '') +
        (r.repairs && r.repairs.length ? ' · repairs: ' + r.repairs.length : '') +
        (r.warnings && r.warnings.length ? ' · warnings: ' + r.warnings.length : ''));
    }
  }
  // ── the report ──────────────────────────────────────────────────────
  const byPack = {};
  for (const r of results) (byPack[r.pack] = byPack[r.pack] || []).push(r);
  const rows = Object.entries(byPack).map(([id, rs]) => {
    const landed = rs.filter((r) => r.landed).length;
    const clean = rs.filter((r) => r.landed && !(r.repairs && r.repairs.length) && !(r.warnings && r.warnings.length)).length;
    const repairs = rs.reduce((n, r) => n + ((r.repairs && r.repairs.length) || 0), 0);
    const warnings = rs.reduce((n, r) => n + ((r.warnings && r.warnings.length) || 0), 0);
    const secs = Math.round(rs.reduce((n, r) => n + r.seconds, 0) / rs.length);
    return { id, runs: rs.length, landed, landedPct: pct(landed, rs.length), clean, cleanPct: pct(clean, rs.length), repairs, warnings, secs };
  });
  const hist = {};
  for (const r of results) for (const c of (r.repairs || []).concat(r.warnings || [])) hist[c] = (hist[c] || 0) + 1;
  const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const md = [
    '# Injection eval — the packs against the owner\'s model',
    '',
    `Model endpoint: \`${BASE}\` (${MODEL || 'the loaded model'}) · ${RUNS} runs per pack · run at ${new Date().toISOString()}`,
    '',
    'Every pack the CMS generates is sent through the CMS\'s own pipeline (`src/ai.js generate()`) and every reply is judged by the REAL admin door. **Landed** = the door accepted the reply; **clean** = accepted with no repair and no warning. The target is 99.9% landed; clean is the quality of the prompt.',
    '',
    '| Pack | Runs | Landed | Clean | Repairs | Warnings | Avg s |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${r.runs} | ${r.landed} (${r.landedPct}%) | ${r.clean} (${r.cleanPct}%) | ${r.repairs} | ${r.warnings} | ${r.secs} |`),
    '',
    '## What the doors had to do (most frequent first)',
    '',
    ...(top.length ? top.map(([c, n]) => `- \`${String(c).slice(0, 110)}\` × ${n}`) : ['- nothing — every reply was clean']),
    '',
    '## Refusals',
    '',
    ...(results.filter((r) => !r.landed).map((r) => `- ${r.pack} #${r.i}: ${String(r.error).slice(0, 200)}`).concat(results.some((r) => !r.landed) ? [] : ['- none'])),
    '',
    `Raw replies: \`${path.join(ROOT, 'replies')}\``,
    ''
  ].join('\n');
  const docs = path.join(__dirname, '..', 'docs');
  fs.writeFileSync(path.join(docs, 'INJECTION-EVAL.md'), md, 'utf8');
  fs.writeFileSync(path.join(docs, 'injection-eval.json'), JSON.stringify({ base: BASE, model: MODEL, runs: RUNS, rows, hist, results }, null, 2), 'utf8');
  console.log('\n' + md);
  const worst = Math.min(...rows.map((r) => r.landedPct));
  process.exit(worst < 100 ? 2 : 0);
})().catch((e) => { console.error('eval failed:', e.message); process.exit(1); });
