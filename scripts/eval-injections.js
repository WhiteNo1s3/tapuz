'use strict';

/**
 * eval-injections (v2.28) — "we want 99.9% effectiveness in our purpose and
 * injections" (Ben). This is the loop that makes that number a measurement
 * instead of a hope: every injection pack the CMS generates is sent to the
 * OWNER'S model — through the CMS's own pipeline (src/ai.js, the `local`
 * provider by default: LM Studio / any OpenAI-shaped runtime on loopback) —
 * N times with varied briefs or fixtures, and every reply is judged by the
 * REAL door that will receive it in the admin (extractThemeReply, the bench
 * compiler, pznSourceToBlocks, the menu organizer's parser + validator).
 * What is counted: landed / refused, repairs the door had to make, warnings
 * it raised, tokens and seconds — and for the organizer the PASS metrics
 * (valid, no hard warning, every page placed, fits one row, no echo).
 *
 *   node scripts/eval-injections.js                        # every pack, 3 runs each
 *   node scripts/eval-injections.js theme-designer 5       # one pack, 5 runs
 *   node scripts/eval-injections.js menu-organizer 20 --fixtures=all --size=full --repair
 *   node scripts/eval-injections.js menu-organizer 3 --fixtures=live-10 --variant=B --provider=direct
 *   EVAL_BASE=http://127.0.0.1:1234/v1 EVAL_MODEL=tapuz-qwen node scripts/eval-injections.js
 *
 * Flags: --fixtures=all|<name>[,<name>]  (menu-organizer: which fixture sites)
 *        --size=lite|full                (pack size; default lite — the free-plan budget)
 *        --variant=A|B                   (prompt variant, for A/B runs)
 *        --provider=cms|direct           (cms = the CMS pipeline, default; direct = raw chat/completions)
 *        --repair                        (apply the runner's one repair round on a refusal / repairable warning)
 *        --temperature=0.3               (direct provider only)
 *
 * Needs a model: it is NOT part of test:smoke. Output: docs/INJECTION-EVAL.md
 * and docs/injection-eval.json (the latest run), eval/runs/<date>-<pack>.jsonl
 * (one line per run), eval/failures/<pack>/*.txt (every non-passing reply,
 * verbatim — the seed of the next canned fixture), eval/reports/<date>-<pack>.md.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.join(os.tmpdir(), 'tapuz-eval');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'replies'), { recursive: true });
process.env.TAPUZ_ROOT = ROOT;

const BASE = process.env.EVAL_BASE || 'http://127.0.0.1:1234/v1';
const MODEL = process.env.EVAL_MODEL || '';
const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flag = (name, dflt) => {
  const hit = argv.find((a) => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return dflt;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const ONLY = positional[0] && !/^\d+$/.test(positional[0]) ? positional[0] : '';
const RUNS = Number(positional[1] || (/^\d+$/.test(positional[0] || '') ? positional[0] : 3));
const FIXTURES = String(flag('fixtures', 'all'));
const SIZE = String(flag('size', 'lite'));
const VARIANT = String(flag('variant', 'A'));
const PROVIDER = String(flag('provider', 'cms'));
const REPAIR = !!flag('repair', false);
const TEMPERATURE = Number(flag('temperature', 0.3));
const STAMP = new Date().toISOString().slice(0, 10);

require('../src/db');
const { runSetup } = require('../src/setup');
runSetup({
  title: 'פרחי נועה', description: 'חנות פרחים וינטג׳ בתל אביב',
  colors: { primary: '#ea580c', bg: '#fffbf7', lightBg: '#fdf1e6', text: '#1c1917' },
  menuPlacement: 'top', pages: ['home', 'about', 'contact', 'articles'], menuPages: ['home', 'about', 'contact', 'articles'], external: []
});
const ai = require('../src/ai');
ai.saveSettings({ provider: 'local', baseUrl: BASE, model: MODEL });

const EVAL_DIR = path.join(__dirname, '..', 'eval');
for (const d of ['runs', 'failures', 'reports']) fs.mkdirSync(path.join(EVAL_DIR, d), { recursive: true });

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
const MENU_BRIEFS = [
  '',
  'סדר לי את התפריט — הדגש את יצירת הקשר',
  'תפריט קצר: עד 5 פריטים למעלה, השאר בתפריטי משנה'
];

// ── talking to the model ──────────────────────────────────────────────
/** direct: one raw chat/completions call (no CMS pipeline) — for speed when
 *  iterating on a prompt. Plain http so a slow local model never hits the
 *  undici 300s header timeout. */
function directChat(messages, maxTokens) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE.replace(/\/+$/, '') + '/chat/completions');
    const body = JSON.stringify({ model: MODEL || undefined, messages, max_tokens: maxTokens, temperature: TEMPERATURE, reasoning_effort: 'none', stream: false });
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ': ' + (j.error && j.error.message || data.slice(0, 200))));
          const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '';
          resolve({ text, usage: j.usage || {}, provider: { id: 'direct', model: j.model || MODEL } });
        } catch (e) { reject(new Error('bad json from the model: ' + data.slice(0, 200))); }
      });
    });
    req.setTimeout(20 * 60 * 1000, () => req.destroy(new Error('direct: timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

/** One model turn through the chosen provider → {text, usage, ms, provider}. */
async function ask({ prompt, history = [], user = '', maxTokens }) {
  const t0 = Date.now();
  let out;
  if (PROVIDER === 'direct') {
    const messages = history.length ? history.concat([{ role: 'user', content: user }]) : [{ role: 'user', content: prompt }];
    out = await directChat(messages, maxTokens);
  } else if (typeof ai.generateDetailed === 'function') {
    // the runner (src/routes/inject.js REPAIR_TURN_CAP) sends the whole pack in
    // the repair round's history — mirror it, or the eval measures a prompt
    // the ▶ button never sends
    out = await ai.generateDetailed({ system: '', user: history.length ? user : prompt, history, maxTokens, turnCap: history.length ? 40000 : 0 });
  } else {
    const text = await ai.generate({ system: '', user: history.length ? user : prompt, history, maxTokens });
    out = { text, usage: {}, provider: { id: 'local', model: MODEL } };
  }
  out.ms = Date.now() - t0;
  return out;
}

// ── the packs ─────────────────────────────────────────────────────────
/** Every pack the CMS ships, as a runnable descriptor. A pack that does not
 *  exist in this checkout (an injection not merged yet) is skipped, not failed. */
function packs() {
  const list = [];
  const themeRp = require('../src/theme-roleplay');
  const theme = require('../src/theme');
  list.push({
    id: 'theme-designer',
    maxTokens: 6000,
    cases: THEME_BRIEFS.map((brief, i) => ({ name: 'brief-' + (i + 1), brief })),
    prompt: (c) => themeRp.buildThemePrompt({ siteTitle: 'פרחי נועה', description: 'חנות פרחים', brief: c.brief }).text,
    judge: (reply) => {
      const t = theme.extractThemeReply(reply, 'eval');
      let bench = { blocks: [], warnings: [] };
      let benchError = '';
      if (t.specimen) { try { bench = require('../src/theme-canvas').blocksFromSource(t.specimen); } catch (e) { benchError = e.message; } }
      const sections = Object.keys(t.overrides).length;
      return { landed: true, pass: sections >= 4 && !benchError, sections, warnings: t.warnings, repairs: bench.warnings, benchBlocks: bench.blocks.length, benchError, hasSkin: !!(t.overrides.skin && t.overrides.skin.css), hasEffect: !!(t.overrides.effects && t.overrides.effects.js) };
    }
  });
  const rp = require('../src/pzn/agent-roleplay');
  const { pznSourceToBlocks } = require('../src/pzn-source');
  const judgePage = (reply) => {
    const r = pznSourceToBlocks(reply);
    const count = (list) => list.reduce((n, b) => n + 1 + (b.data && Array.isArray(b.data.blocks) ? count(b.data.blocks) : 0) + (b.data && Array.isArray(b.data.columns) ? b.data.columns.reduce((m, c) => m + count(c.blocks || []), 0) : 0), 0);
    const blocks = count(r.view.blocks || []);
    const htmlBlocks = JSON.stringify(r.view.blocks).split('"type":"html"').length - 1;
    return { landed: true, pass: blocks >= 3 && htmlBlocks === 0, blocks, repairs: (r.changes || []).map((c) => c.code || c.message), warnings: (r.extracted || []).map((c) => c.code), repaired: !!r.repaired, htmlBlocks };
  };
  for (const size of ['lite', 'full']) {
    list.push({
      id: 'site-builder-' + size,
      maxTokens: 6000,
      cases: PAGE_BRIEFS.map((brief, i) => ({ name: 'brief-' + (i + 1), brief })),
      prompt: (c) => rp.buildRoleplayPack({ locale: 'he', size, playerBrief: c.brief, media: [] }).text,
      judge: judgePage
    });
  }
  try {
    const org = require('../src/menu-organizer');
    if (org && typeof org.buildMenuPrompt === 'function') list.push(menuOrganizerPack(org));
  } catch (e) { console.error('menu-organizer pack skipped:', e.message); }
  return list.filter((p) => !ONLY || p.id === ONLY);
}

/** The organizer: every fixture site × N runs, scored by the door + the
 *  capacity estimate (PASS = valid ∧ no hard warning ∧ every page placed ∧
 *  fits one row (or a fold/side/drawer was chosen) ∧ depth ok ∧ not an echo). */
function menuOrganizerPack(org) {
  const menus = require('../src/menus');
  const dir = path.join(__dirname, '..', 'test', 'fixtures', 'inject', 'menu-organizer');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')) : [];
  const wanted = FIXTURES === 'all' ? names : FIXTURES.split(',').map((s) => s.trim()).filter(Boolean);
  const cases = [];
  for (const name of wanted) {
    const file = path.join(dir, name + '.json');
    if (!fs.existsSync(file)) { console.error(`fixture not found: ${name}`); continue; }
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    cases.push({ name, brief: typeof json.brief === 'string' ? json.brief : MENU_BRIEFS[cases.length % MENU_BRIEFS.length], json, locale: json.locale || 'he' });
  }
  if (!cases.length) cases.push({ name: 'seeded-site', brief: '', json: null, locale: 'he' });
  const ctxOf = (c) => (c.json && typeof org.ctxFromFixture === 'function') ? org.ctxFromFixture(c.json) : org.siteStateForMenus();
  return {
    id: 'menu-organizer',
    maxTokens: 2048,
    cases,
    prompt: (c) => org.buildMenuPrompt({ brief: c.brief, size: SIZE, locale: c.locale, variant: VARIANT, ctx: ctxOf(c) }).text,
    repairable: org.REPAIRABLE || [],
    judge: (reply, c) => {
      const ctx = ctxOf(c);
      const r = org.parseMenuReply(reply, ctx, { brief: c.brief });
      const codes = (r.warnings || []).map((w) => (typeof w === 'string' ? w : w.code));
      const messages = (r.warnings || []).map((w) => (typeof w === 'string' ? w : String(w.message || w.code)));
      const HARD = ['UNKNOWN_PAGE', 'UNSAFE_URL', 'BAD_TEL'];
      const hard = codes.filter((code) => HARD.includes(code));
      const soft = codes.filter((code) => !HARD.includes(code));
      const plan = r.plan || {};
      const mainItems = (plan.menus && plan.menus.main && plan.menus.main.items) || plan.items || [];
      // coverage: published non-article pages that any planned menu reaches
      const pages = (ctx.pages || []).filter((p) => p.status === 'published' && !(Array.isArray(p.tags) ? p.tags : []).includes('article'));
      const reach = new Set();
      // the same reach rule as the door (menu-organizer reachedPaths): a
      // custom "/" or "/index.html" link IS the crowned home page
      const walk = (items) => (items || []).forEach((it) => {
        if (it.type === 'page') reach.add(String(it.target).replace(/^\/+/, '').replace(/\.html$/i, ''));
        else if (ctx.homePath && (it.url === '/' || /^\/index\.html$/i.test(String(it.url || '')))) reach.add(ctx.homePath);
        walk(it.children);
      });
      Object.values(plan.menus || {}).forEach((m) => walk(m.items));
      if (!plan.menus) walk(plan.items);
      const placed = pages.filter((p) => reach.has(p.full_path)).length;
      const coverage = pages.length ? Math.round((placed / pages.length) * 1000) / 10 : 100;
      // overflow: the new top row on the new knobs
      const nextOverrides = mergeKnobs(ctx.overrides, plan.knobs, plan.placement);
      let fit = null;
      try { fit = typeof menus.estimateMenuFit === 'function' ? menus.estimateMenuFit(mainItems, nextOverrides, ctx.config) : null; } catch (e) { fit = null; }
      const knobs = require('../src/theme').menuKnobs(nextOverrides);
      const overflowFree = !fit || fit.rowsNow === 1 || knobs.fold >= 2 || knobs.placement === 'side' || knobs.flow !== 'wrap';
      const depthOk = !codes.includes('DEPTH_FLATTENED');
      const labels = [];
      const collect = (items) => (items || []).forEach((it) => { labels.push(String(it.label || '')); collect(it.children); });
      collect(mainItems);
      const labelsOk = labels.every((l) => l.length >= 2 && l.length <= 40);
      const noChange = codes.includes('NO_CHANGE');
      const expect = (c.json && c.json.expect) || {};
      const expectOk = (!expect.placement || expect.placement === knobs.placement) &&
        (!expect.maxTop || mainItems.length <= expect.maxTop) &&
        (!Array.isArray(expect.mustPlace) || expect.mustPlace.every((p) => reach.has(p))) &&
        (!Array.isArray(expect.mustNotPlace) || expect.mustNotPlace.every((p) => !reach.has(p)));
      const pass = hard.length === 0 && coverage === 100 && overflowFree && depthOk && !noChange && expectOk;
      return {
        landed: true, pass, warnings: codes, warningMessages: messages, hardWarnings: hard, softWarnings: soft, repairs: [], notes: r.notes || [],
        items: mainItems.length, coverage, placed, pages: pages.length, overflowFree, rowsNow: fit && fit.rowsNow, capacity: fit && fit.capacity,
        depthOk, labelsOk, noChange, expectOk, placement: knobs.placement, flow: knobs.flow, fold: knobs.fold,
        fenced: /```/.test(reply), proseChars: Math.max(0, reply.indexOf('<bent-')), note: plan.note || ''
      };
    }
  };
}

function mergeKnobs(overrides, knobs, placement) {
  const theme = require('../src/theme');
  const frag = theme.knobsToOverrides(Object.assign({}, knobs || {}, placement ? { placement } : {})).overrides;
  return theme.mergeDeep(JSON.parse(JSON.stringify(overrides || {})), frag);
}

// ── one run (+ the runner's single repair turn when asked) ─────────────
async function runOne(pack, c, i) {
  const prompt = pack.prompt(c);
  const base = { pack: pack.id, i, fixture: c.name, brief: c.brief, promptChars: prompt.length, size: SIZE, variant: VARIANT, provider: PROVIDER };
  let turn;
  try { turn = await ask({ prompt, maxTokens: pack.maxTokens }); } catch (e) {
    return { ...base, seconds: 0, landed: false, pass: false, error: 'MODEL: ' + e.message, replyChars: 0, rounds: 1 };
  }
  let reply = turn.text || '';
  let ms = turn.ms;
  let usage = turn.usage || {};
  let rounds = 1;
  let repaired = false;
  const judge = (text) => {
    try { return { ok: true, v: pack.judge(text, c) }; } catch (e) { return { ok: false, error: 'DOOR: ' + e.message, message: e.message, code: e.code || '' }; }
  };
  let verdict = judge(reply);
  const wantsRepair = REPAIR && pack.repairable && (!verdict.ok || (verdict.v.warnings || []).some((code) => pack.repairable.includes(code)));
  if (wantsRepair) {
    // byte-for-byte the runner's follow-up (src/routes/inject.js): the door's
    // Hebrew messages, not codes; on a refusal its message
    const lines = verdict.ok
      ? (verdict.v.warnings || []).map((code, idx) => ({ code, msg: (verdict.v.warningMessages || [])[idx] || code })).filter((w) => pack.repairable.includes(w.code)).map((w) => w.msg)
      : [verdict.message || verdict.error];
    const user = 'תיקונים נדרשים:\n' + lines.map((l) => '- ' + String(l).replace(/\s+/g, ' ').trim()).join('\n') + '\nהחזירו את המסמך המלא, מתוקן.';
    try {
      const second = await ask({ prompt, history: [{ role: 'user', content: prompt }, { role: 'assistant', content: reply }], user, maxTokens: pack.maxTokens });
      const v2 = judge(second.text || '');
      const hardOf = (v) => (v.ok ? (v.v.hardWarnings || []).length : 99);
      rounds = 2;
      ms += second.ms;
      usage = { prompt_tokens: (usage.prompt_tokens || 0) + (second.usage && second.usage.prompt_tokens || 0), completion_tokens: (usage.completion_tokens || 0) + (second.usage && second.usage.completion_tokens || 0) };
      if (hardOf(v2) <= hardOf(verdict)) { verdict = v2; reply = second.text || ''; repaired = true; }
    } catch (e) { /* the first reply stands */ }
  }
  const file = path.join(ROOT, 'replies', `${pack.id}-${c.name}-${i}.md`);
  fs.writeFileSync(file, reply, 'utf8');
  const seconds = Math.round(ms / 1000);
  const common = { ...base, seconds, ms, replyChars: reply.length, rounds, repaired, usage, model: turn.provider && turn.provider.model };
  if (!verdict.ok) return { ...common, landed: false, pass: false, error: verdict.error, code: verdict.code };
  return { ...common, ...verdict.v, strictPass: verdict.v.pass && rounds === 1 };
}

function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }
function p95(list) { if (!list.length) return 0; const s = list.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; }

const ADVICE = {
  UNKNOWN_PAGE: 'rule 2 (page= verbatim) — shrink the table or repeat the slug column',
  PAGES_MISSING: 'rule 3 (every published page once) — list the orphans explicitly',
  OVERFLOW_LIKELY: 'the ladder — capacity numbers must be in the rule, not only in the state',
  DEPTH_FLATTENED: 'rule 4 — show the `/>` leaf and the one-level parent in the example',
  NO_CHANGE: 'rule 8 — never echo the current menu',
  LAYOUT_UNASKED: 'rule 9 — placement/flow only when the brief asks',
  LABEL_TRIMMED: 'rule 6 — labels 2–12 chars',
  ARTICLE_LINKED: 'rule 3 — articles stay out, their hub page is in',
  DRAFT_LINKED: 'rule 3 — drafts stay out'
};

(async () => {
  const list = packs();
  if (!list.length) { console.error('no packs to run (unknown id?)'); process.exit(1); }
  console.log(`eval: ${list.map((p) => `${p.id}(${p.cases.length} cases)`).join(', ')} × ${RUNS} runs → ${BASE} ${MODEL || '(loaded model)'} · provider=${PROVIDER} size=${SIZE} variant=${VARIANT}${REPAIR ? ' repair' : ''}`);
  const results = [];
  for (const pack of list) {
    const runFile = path.join(EVAL_DIR, 'runs', `${STAMP}-${pack.id}-${VARIANT}.jsonl`);
    for (const c of pack.cases) {
      for (let i = 1; i <= RUNS; i++) {
        const r = await runOne(pack, c, i);
        results.push(r);
        fs.appendFileSync(runFile, JSON.stringify({ ts: new Date().toISOString(), ...r }) + '\n', 'utf8');
        if (!r.pass) {
          const fdir = path.join(EVAL_DIR, 'failures', pack.id);
          fs.mkdirSync(fdir, { recursive: true });
          const reply = fs.existsSync(path.join(ROOT, 'replies', `${pack.id}-${c.name}-${i}.md`)) ? fs.readFileSync(path.join(ROOT, 'replies', `${pack.id}-${c.name}-${i}.md`), 'utf8') : '';
          fs.writeFileSync(path.join(fdir, `${Date.now()}-${c.name}-${i}.txt`), `# ${pack.id} · ${c.name} · #${i} · ${r.error || (r.hardWarnings || r.warnings || []).join(',')}\n# brief: ${c.brief}\n\n${reply}`, 'utf8');
        }
        console.log(`[${pack.id} ${c.name} #${i}] ${r.landed ? (r.pass ? 'PASS' : 'landed') : 'REFUSED'} ${r.seconds}s${r.rounds > 1 ? ' ×2' : ''}` +
          (r.error ? ' — ' + r.error.slice(0, 160) : '') +
          (r.items != null ? ` · ${r.items} top` : '') +
          (r.coverage != null ? ` · cov ${r.coverage}%` : '') +
          (r.rowsNow != null ? ` · rows ${r.rowsNow}/${r.capacity}` : '') +
          (r.repairs && r.repairs.length ? ' · repairs: ' + r.repairs.length : '') +
          (r.warnings && r.warnings.length ? ' · ' + r.warnings.slice(0, 6).join(',') : ''));
      }
    }
  }
  // ── the report ──────────────────────────────────────────────────────
  const byPack = {};
  for (const r of results) (byPack[r.pack] = byPack[r.pack] || []).push(r);
  const rows = Object.entries(byPack).map(([id, rs]) => {
    const landed = rs.filter((r) => r.landed).length;
    const pass = rs.filter((r) => r.pass).length;
    const strict = rs.filter((r) => r.strictPass).length;
    const clean = rs.filter((r) => r.landed && !(r.repairs && r.repairs.length) && !(r.warnings && r.warnings.length)).length;
    const second = rs.filter((r) => r.rounds > 1).length;
    const repairs = rs.reduce((n, r) => n + ((r.repairs && r.repairs.length) || 0), 0);
    const warnings = rs.reduce((n, r) => n + ((r.warnings && r.warnings.length) || 0), 0);
    const secs = Math.round(rs.reduce((n, r) => n + (r.seconds || 0), 0) / rs.length);
    const p95s = Math.round(p95(rs.map((r) => r.seconds || 0)));
    const ptok = Math.round(rs.reduce((n, r) => n + ((r.usage && r.usage.prompt_tokens) || 0), 0) / rs.length);
    const ctok = Math.round(rs.reduce((n, r) => n + ((r.usage && r.usage.completion_tokens) || 0), 0) / rs.length);
    return { id, runs: rs.length, landed, landedPct: pct(landed, rs.length), pass, passPct: pct(pass, rs.length), strict, strictPct: pct(strict, rs.length), clean, cleanPct: pct(clean, rs.length), second, repairs, warnings, secs, p95s, ptok, ctok };
  });
  const hist = {};
  for (const r of results) for (const c of (r.repairs || []).concat(r.warnings || [])) hist[c] = (hist[c] || 0) + 1;
  const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const fixtureRows = [];
  for (const r of results) {
    if (r.pack !== 'menu-organizer') continue;
    let row = fixtureRows.find((x) => x.fixture === r.fixture);
    if (!row) { row = { fixture: r.fixture, runs: 0, pass: 0, strict: 0, cov: 0, secs: 0, codes: {} }; fixtureRows.push(row); }
    row.runs++; if (r.pass) row.pass++; if (r.strictPass) row.strict++; row.cov += r.coverage || 0; row.secs += r.seconds || 0;
    for (const c of (r.warnings || [])) row.codes[c] = (row.codes[c] || 0) + 1;
  }
  const md = [
    '# Injection eval — the packs against the owner\'s model',
    '',
    `Model endpoint: \`${BASE}\` (${MODEL || 'the loaded model'}) · ${RUNS} runs per case · provider ${PROVIDER} · size ${SIZE} · variant ${VARIANT}${REPAIR ? ' · one repair round' : ''} · run at ${new Date().toISOString()}`,
    '',
    'Every pack the CMS generates is sent through the CMS\'s own pipeline (`src/ai.js`) and every reply is judged by the REAL admin door. **Landed** = the door accepted the reply; **PASS** = landed and the result is right for the site (organizer: no hard warning, every published page placed, fits one row or a fold/side/drawer was chosen, not an echo; theme: ≥ 4 sections and the bench compiles; page: ≥ 3 blocks and no raw-html fallback); **strict** = PASS on the first reply; **clean** = no repair and no warning at all.',
    '',
    `The 99.9% headline is earned only after ≥ 3,000 scored runs with ≤ 3 non-passes — until then this report says "${results.length} runs, ${results.filter((r) => r.pass).length} pass".`,
    '',
    '| Pack | Runs | Landed | PASS | Strict | Clean | 2nd round | Repairs | Warnings | Avg s | p95 s | Prompt tok | Reply tok |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${r.runs} | ${r.landed} (${r.landedPct}%) | ${r.pass} (${r.passPct}%) | ${r.strict} (${r.strictPct}%) | ${r.clean} (${r.cleanPct}%) | ${r.second} | ${r.repairs} | ${r.warnings} | ${r.secs} | ${r.p95s} | ${r.ptok} | ${r.ctok} |`),
    '',
    ...(fixtureRows.length ? [
      '## Menu organizer — per fixture site',
      '',
      '| Fixture | Runs | PASS | Strict | Avg coverage | Avg s | Top codes |',
      '|---|---|---|---|---|---|---|',
      ...fixtureRows.map((f) => `| ${f.fixture} | ${f.runs} | ${f.pass} (${pct(f.pass, f.runs)}%) | ${f.strict} | ${Math.round(f.cov / f.runs)}% | ${Math.round(f.secs / f.runs)} | ${Object.entries(f.codes).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c}×${n}`).join(' ') || '—'} |`),
      ''
    ] : []),
    '## What the doors had to do (most frequent first)',
    '',
    ...(top.length ? top.map(([c, n]) => `- \`${String(c).slice(0, 110)}\` × ${n}${ADVICE[c] ? ' — ' + ADVICE[c] : ''}`) : ['- nothing — every reply was clean']),
    '',
    '## Refusals',
    '',
    ...(results.filter((r) => !r.landed).map((r) => `- ${r.pack} ${r.fixture} #${r.i}: ${String(r.error).slice(0, 200)}`).concat(results.some((r) => !r.landed) ? [] : ['- none'])),
    '',
    // the report is committed and the repo is public — never print this
    // machine's temp path (it carries the OS username); the folder is
    // os.tmpdir()/tapuz-eval/replies on whichever box ran the eval
    `Raw replies: \`<tmp>/tapuz-eval/replies\` · run log: \`eval/runs/${STAMP}-<pack>-${VARIANT}.jsonl\` · non-passing replies: \`eval/failures/<pack>/\``,
    ''
  ].join('\n');
  const docs = path.join(__dirname, '..', 'docs');
  fs.writeFileSync(path.join(docs, 'INJECTION-EVAL.md'), md, 'utf8');
  fs.writeFileSync(path.join(docs, 'injection-eval.json'), JSON.stringify({ base: BASE, model: MODEL, runs: RUNS, provider: PROVIDER, size: SIZE, variant: VARIANT, repair: REPAIR, rows, fixtureRows, hist, results }, null, 2), 'utf8');
  fs.writeFileSync(path.join(EVAL_DIR, 'reports', `${STAMP}-${ONLY || 'all'}-${VARIANT}.md`), md, 'utf8');
  console.log('\n' + md);
  const worst = Math.min(...rows.map((r) => r.landedPct));
  process.exit(worst < 100 ? 2 : 0);
})().catch((e) => { console.error('eval failed:', e.message); process.exit(1); });
