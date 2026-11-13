'use strict';

/**
 * v2.69 QA — the store's categories screen, the hub, the settings screen and
 * the CSV door, through real HTTP on a scratch site.
 *
 *   the screen      /admin/store/shelves renders inside the store's tabs, has
 *                   its own rail item, and says what a category is when there
 *                   are none
 *   the API         create (the address is the id), the one-level rules in
 *                   Hebrew beside the right field, an edit that keeps what it
 *                   does not send, reorder, delete with and without a target
 *   the storefront  every write answers `rebuilt`, and the public shop page
 *                   really carries a renamed category
 *   the gate        an editor gets 403 on every route; every store route in
 *                   both modules is requireAdmin (the source is parsed)
 *   settings        a posted `shelves` list deletes NOTHING (it used to be
 *                   the whole truth); the card is gone
 *   the hub         a product name and a payment label with markup stay text;
 *                   "payments" is red when an open store offers none, and
 *                   names what is held back; a missing page is not a link
 *   CSV             export → import changes nothing; a new row is previewed,
 *                   applied with its cost, and leaves a backup; a sheet with
 *                   no sku/title column is refused in Hebrew
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-store-shelves-'));
const PORT = 3998;
const BASE = `http://127.0.0.1:${PORT}`;

let failed = 0;
function ok(cond, name) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) failed++;
}

function req(method, urlPath, { body, cookie, headers: extra } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE, ...(extra || {}) };
    if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (cookie) headers.Cookie = cookie;
    const r = http.request(BASE + encodeURI(urlPath).replace(/%25/g, '%'), { method, headers }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* html or text */ }
        resolve({ status: res.statusCode, headers: res.headers, json: json || {}, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function waitUp(tries = 60) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(BASE + '/', () => resolve()).on('error', () => {
        if (n <= 0) return reject(new Error('server did not start'));
        setTimeout(() => tick(n - 1), 150);
      });
    };
    tick(tries);
  });
}

const XSS = 'x</title><script>alert(1)</script>';
const HEBREW = /[א-ת]/;

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'חנות הקטגוריות', description: 'בדיקה',
    colors: { primary: '#7c2d12', bg: '#ffffff', lightBg: '#fef3c7', text: '#1c1917' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const auth = require('../src/auth');
  const owner = auth.createAdmin('owner', 'owner-pass-1');
  const editor = auth.addTeamMember('ed', 'editor-pass-12', 'editor');
  const OWNER = auth.COOKIE_NAME + '=' + auth.makeToken(owner.id);
  const EDITOR = auth.COOKIE_NAME + '=' + auth.makeToken(editor.id);
  const store = require('../src/store');
  const cat = store.catalog;
  // a PayPal-only shop without keys: the state in which nobody can order
  store.settings.saveSettings({
    shipping: [{ id: 'pickup', label: 'איסוף עצמי', price: '0', address: false }],
    payments: [{ id: 'paypal', kind: 'paypal', label: 'PayPal' }]
  });

  // the server must not find PayPal keys (or a demo flag) in this shell's environment
  const env = { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) };
  for (const k of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MODE', 'TAPUZ_PAYPAL_LIVE', 'TAPUZ_DEMO_STORE']) delete env[k];
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env, stdio: 'ignore' });

  const get = (p, cookie = OWNER) => req('GET', p, { cookie, headers: { Accept: 'text/html' } });
  const api = (p, body, cookie = OWNER) => req('POST', p, { cookie, body: body || {} });
  const list = async () => ((await req('GET', '/admin/api/store/shelves', { cookie: OWNER })).json.shelves || []);
  const order = async () => (await list()).map((s) => (s.depth ? '-' : '') + s.slug).join(' ');
  const S = '/admin/api/store/shelves';

  try {
    await waitUp();

    // ── the screen ────────────────────────────────────────────────────
    const empty = await get('/admin/store/shelves');
    ok(empty.status === 200 && /st-tabs/.test(empty.text), 'screen: /admin/store/shelves answers 200 inside the store tabs');
    ok(/<a href="\/admin\/store\/shelves" class="is-on" aria-current="page">🗂️ קטגוריות<\/a>/.test(empty.text), 'screen: the tab "🗂️ קטגוריות" exists and is the active one');
    ok(/<a href="\/admin\/store\/shelves" title="קטגוריות מוצרים" class="active">/.test(empty.text), 'screen: the rail has "קטגוריות מוצרים" (not a second "קטגוריות") and it is lit');
    ok(/עוד אין קטגוריות\. קטגוריה היא מדף בחנות: אפשר לסנן לפיה, לתת לה תמונה ותיאור, ולקבל לה דף משלה\./.test(empty.text), 'screen: with no categories it says what a category is');
    ok(!/<style\b/i.test(empty.text.replace(/<style>:root \{ --admin-accent: [^}]*\}<\/style>/, '')), 'screen: no inline <style> block of its own');
    ok(/data-media-pick="st-cat-image"/.test(empty.text) && /src="\/admin-media-picker\.js/.test(empty.text) && /src="\/admin-store-shelves\.js\?v=/.test(empty.text),
      'screen: the picture field has the media picker, and the screen script is build-stamped');
    const kit = require('../src/store/admin-kit');
    const tabKeys = kit.TABS.map((t) => t[0]);
    ok(tabKeys.indexOf('store-shelves') === tabKeys.indexOf('store-products') + 1, 'admin-kit: the categories tab sits right after products');
    const { ADMIN_NAV_GROUPS, paletteBootJson } = require('../src/admin-ui');
    const railItem = ADMIN_NAV_GROUPS.find((g) => g.key === 'store').items.find((i) => i.key === 'store-shelves');
    ok(!!railItem && railItem.label === 'קטגוריות מוצרים' && /"href":"\/admin\/store\/shelves"/.test(paletteBootJson()), 'admin-ui: the store family has the item, and the command palette knows it');
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-store-shelves.js'), 'utf8');
    let parses = true;
    try { new Function(js); } catch (e) { parses = false; }
    ok(parses && !/innerHTML/.test(js) && !/\beval\(/.test(js) && !/(document|window)\.addEventListener/.test(js),
      'admin-store-shelves.js parses, never writes innerHTML, never evals, leaves no listener on document or window');

    // ── create ────────────────────────────────────────────────────────
    const a = await api(S + '/clothes', { isNew: true, label: 'בגדים' });
    ok(a.status === 200 && a.json.ok && a.json.created === true && a.json.shelf.slug === 'clothes' && a.json.rebuilt === true, 'create: a parent category (the address is its id), and the site was rebuilt');
    const b = await api(S + '/shirts', { isNew: true, label: 'חולצות', parent: 'clothes' });
    ok(b.status === 200 && b.json.shelf.parent === 'clothes', 'create: a sub-category under it');
    ok((await order()) === 'clothes -shirts', 'list: GET /admin/api/store/shelves answers the tree, parent then child');
    const heb = await api(S + '/נעליים', { isNew: true, label: 'נעליים' });
    ok(heb.status === 200 && heb.json.shelf.slug === 'נעליים', 'create: a Hebrew id travels in the address');
    const tidy = await api(S + '/Home Decor', { isNew: true, label: 'לבית' });
    ok(tidy.status === 200 && tidy.json.shelf.slug === 'home-decor', 'create: a typed id is tidied the way the catalog tidies it');
    const dup = await api(S + '/clothes', { isNew: true, label: 'עוד בגדים' });
    ok(dup.status === 400 && dup.json.field === 'slug' && HEBREW.test(dup.json.error || '') && cat.getShelf('clothes').label === 'בגדים',
      'create: an id that is taken is refused beside the id field — the existing category is not rewritten');
    const noName = await api(S + '/nameless', { isNew: true, label: '   ' });
    ok(noName.status === 400 && noName.json.field === 'label' && HEBREW.test(noName.json.error || '') && !cat.getShelf('nameless'), 'create: no name → 400, in Hebrew, beside the name');

    // ── the one-level rules ───────────────────────────────────────────
    const self = await api(S + '/clothes', { label: 'בגדים', parent: 'clothes' });
    ok(self.status === 400 && self.json.field === 'parent' && HEBREW.test(self.json.error || ''), 'rules: a category cannot be its own parent (400, Hebrew, beside the parent field)');
    const deep = await api(S + '/tees', { isNew: true, label: 'טישרטים', parent: 'shirts' });
    ok(deep.status === 400 && deep.json.field === 'parent' && HEBREW.test(deep.json.error || '') && !cat.getShelf('tees'), 'rules: a child of a child is refused, and nothing is created');
    const hasKids = await api(S + '/clothes', { label: 'בגדים', parent: 'home-decor' });
    ok(hasKids.status === 400 && hasKids.json.field === 'parent' && HEBREW.test(hasKids.json.error || '') && cat.getShelf('clothes').parent === '', 'rules: a category with sub-categories cannot be given a parent');
    const ghost = await api(S + '/clothes', { label: 'בגדים', parent: 'no-such' });
    ok(ghost.status === 400 && ghost.json.field === 'parent', 'rules: a parent that does not exist is refused');

    // ── edit ──────────────────────────────────────────────────────────
    const full = await api(S + '/clothes', { label: 'בגדים', image: '/assets/clothes.png', summary: 'כל מה שלובשים', seoTitle: 'בגדים', seoDescription: 'חולצות ומכנסיים', hidden: false });
    ok(full.status === 200 && full.json.created === false && full.json.shelf.image === '/assets/clothes.png' && full.json.shelf.summary === 'כל מה שלובשים', 'edit: every field is saved');
    const renamed = await api(S + '/clothes', { label: 'ביגוד' });
    const kept = cat.getShelf('clothes');
    ok(renamed.status === 200 && kept.label === 'ביגוד' && kept.image === '/assets/clothes.png' && kept.summary === 'כל מה שלובשים' && kept.seoDescription === 'חולצות ומכנסיים',
      'edit: a save that sends only the name keeps the picture, the summary and the SEO text');
    const badPic = await api(S + '/clothes', { label: 'ביגוד', image: 'javascript:alert(1)' });
    ok(badPic.status === 400 && badPic.json.field === 'image' && cat.getShelf('clothes').image === '/assets/clothes.png', 'edit: a picture address that is not one is refused beside the picture');
    const gone = await api(S + '/no-such', { label: 'רוח' });
    ok(gone.status === 404 && !cat.getShelf('no-such'), 'edit: a category that is not there is 404 — an edit never creates');
    const hide = await api(S + '/נעליים', { label: 'נעליים', hidden: true });
    ok(hide.status === 200 && cat.getShelf('נעליים').hidden === true, 'edit: hidden is saved');

    // ── reorder ───────────────────────────────────────────────────────
    await api(S + '/pants', { isNew: true, label: 'מכנסיים', parent: 'clothes' });
    ok((await order()) === 'clothes -shirts -pants נעליים home-decor', 'reorder: before — the order of creation');
    const tops = await api(S + '/reorder', { slugs: ['home-decor', 'clothes', 'נעליים'] });
    ok(tops.status === 200 && tops.json.ok && tops.json.rebuilt === true && (await order()) === 'home-decor clothes -shirts -pants נעליים', 'reorder: the top level moves (children travel with their parent), and the site was rebuilt');
    const kids = await api(S + '/reorder', { slugs: ['pants', 'shirts'] });
    ok(kids.status === 200 && (await order()) === 'home-decor clothes -pants -shirts נעליים', 'reorder: sub-categories move inside their parent');
    const named = await api(S + '/reorder', { isNew: true, label: 'סדר מחדש' });
    ok(named.status === 200 && named.json.created === true && cat.getShelf('reorder').label === 'סדר מחדש', 'reorder: a category may itself be called "reorder" — a body with no list of ids is a save');
    ok((await api(S + '/reorder/delete', {})).json.deleted === true && !cat.getShelf('reorder'), 'reorder: …and it can be deleted');

    // ── the screen with data ──────────────────────────────────────────
    const filled = await get('/admin/store/shelves');
    ok(/<tbody class="st-cat-group" data-group="clothes">/.test(filled.text) && /<tr class="st-cat-row is-child" data-slug="pants">/.test(filled.text), 'screen: a top-level category is a group, its sub-categories are rows inside it');
    ok(/data-slug="נעליים"[\s\S]*?<span class="pill"[^>]*>מוסתרת<\/span>/.test(filled.text), 'screen: a hidden category wears the "מוסתרת" pill');
    ok(/href="\/admin\/store\/products\?shelf=clothes">למוצרים<\/a>/.test(filled.text) && /data-move="up"/.test(filled.text) && /class="st-cat-grip" draggable="true"/.test(filled.text),
      'screen: each row has "למוצרים", the drag handle and the ↑ ↓ buttons');

    // ── delete ────────────────────────────────────────────────────────
    const mk = (o) => cat.createProduct(o).product;
    mk({ title: 'חולצת פשתן', slug: 'linen', price: '189', shelf: 'shirts', images: ['/assets/a.png'] });
    mk({ title: 'חולצה מוסתרת', slug: 'hidden-shirt', price: '99', shelf: 'shirts', status: 'hidden', images: ['/assets/a.png'] });
    mk({ title: 'ג׳ינס', slug: 'jeans', price: '249', shelf: 'pants', images: ['/assets/a.png'] });
    const counted = (await list()).find((s) => s.slug === 'shirts');
    ok(counted.count === 1 && counted.all === 2, 'list: a row carries count (active) and all (any status) — the delete panel\'s two numbers');
    const lost = await api(S + '/shirts/delete', { moveTo: 'no-such' });
    ok(lost.status === 400 && HEBREW.test(lost.json.error || '') && !!cat.getShelf('shirts') && cat.getProduct('linen').shelf === 'shirts', 'delete: a target that does not exist is refused — nothing is deleted, nothing is un-shelved');
    const moved = await api(S + '/shirts/delete', { moveTo: 'pants' });
    ok(moved.status === 200 && moved.json.deleted && moved.json.moved === 2 && moved.json.movedTo === 'pants' && moved.json.rebuilt === true &&
      cat.getProduct('linen').shelf === 'pants' && cat.getProduct('hidden-shirt').shelf === 'pants' && !cat.getShelf('shirts'),
      'delete: with a target, its products (hidden ones too) move there');
    ok(moved.json.backupId > 0 && store.document.listBackups().some((x) => x.id === moved.json.backupId && /^admin:category-delete:shirts/.test(x.reason)), 'delete: the catalog as it was is on the backups list first');
    const freed = await api(S + '/clothes/delete', {});
    ok(freed.status === 200 && freed.json.deleted && !cat.getShelf('clothes') && cat.getShelf('pants').parent === '' && cat.getProduct('jeans').shelf === 'pants',
      'delete: a parent\'s sub-categories become top-level, and keep their products');
    const bare = await api(S + '/pants/delete', {});
    ok(bare.status === 200 && bare.json.moved === 3 && cat.getProduct('jeans').shelf === '' && cat.getProduct('linen').shelf === '', 'delete: without a target the products are left with no category');
    ok((await api(S + '/pants/delete', {})).status === 404, 'delete: a category that is already gone is 404');

    // ── the gate ──────────────────────────────────────────────────────
    const shut = [
      await get('/admin/store/shelves', EDITOR),
      await req('GET', S, { cookie: EDITOR }),
      await api(S + '/reorder', { slugs: ['home-decor'] }, EDITOR),
      await api(S + '/sneaky', { isNew: true, label: 'x' }, EDITOR),
      await api(S + '/home-decor', { label: 'x' }, EDITOR),
      await api(S + '/home-decor/delete', {}, EDITOR),
      await api('/admin/api/store/import-csv', { csv: 'sku,title\na,b' }, EDITOR)
    ];
    ok(shut.every((r) => r.status === 403) && !cat.getShelf('sneaky') && cat.getShelf('home-decor').label === 'לבית', 'gate: an editor gets 403 on the screen and on every category route (and on the CSV door) — nothing changed');
    const anon = await req('POST', S + '/home-decor/delete', { body: {} });
    ok(anon.status === 401 && !!cat.getShelf('home-decor'), 'gate: no session → 401');
    for (const file of ['store-shelves.js', 'store-admin.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', file), 'utf8');
      const routes = src.split('\n').filter((l) => /router\.(get|post)\('\/admin\/(api\/)?store/.test(l));
      ok(routes.length > 0 && routes.every((l) => /requireAdmin/.test(l)), `gate: every store route in ${file} is requireAdmin (${routes.length} routes)`);
    }

    // ── settings no longer owns categories ────────────────────────────
    const before = (await list()).length;
    const wipe = await api('/admin/api/store/settings', { name: 'חנות', shelves: [] });
    ok(wipe.status === 200 && wipe.json.ok && before > 0 && (await list()).length === before, 'settings: a post with `shelves: []` deletes NOTHING (an old open tab cannot wipe the categories)');
    const sneak = await api('/admin/api/store/settings', { shelves: [{ slug: 'from-settings', label: 'מהגדרות' }] });
    ok(sneak.status === 200 && !cat.getShelf('from-settings') && (await list()).length === before, 'settings: a posted shelf list creates nothing either — the key is not read');
    ok(Array.isArray(sneak.json.notes) && sneak.json.notes.some((n) => /PayPal/.test(n) && /(לא יופיע|אינו מוצע) בקופה/.test(n)), 'settings: the save says which configured method the checkout will not show (PayPal without keys)');
    const settings = await get('/admin/store/settings');
    ok(settings.status === 200 && !/id="st-shelves"|data-shelf\b|st-add-shelf|st-shelf-tpl/.test(settings.text) && !/shelves:/.test(settings.text), 'settings: the categories card is gone, and the form no longer sends `shelves`');
    ok(/<a href="\/admin\/store\/shelves">[^<]*קטגוריות המוצרים עברו למסך משלהן ←<\/a>/.test(settings.text), 'settings: one line says where the categories went');
    ok(/PayPal מופיע בקופה רק אחרי שמפתחות ה-API שלו הוגדרו/.test(settings.text), 'settings: the payment card explains PayPal, not only cards');
    ok(/data-card-only hidden/.test(settings.text) && /\.st-page \[data-card-only\]\[hidden\] \{ display: none; \}/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin.css'), 'utf8')),
      'settings: the card-only "עד תשלומים" field is hidden on a non-card row, and the stylesheet makes that attribute win');

    // ── markup in a name stays text ───────────────────────────────────
    const xss = mk({ title: XSS, slug: 'xss', price: '5', shelf: 'home-decor' });
    const editorPage = await get('/admin/store/products/' + xss.id);
    ok(editorPage.status === 200 && !/<script>alert\(1\)/.test(editorPage.text), 'xss: a product named with markup leaves no raw <script> in its editor page');
    ok(/<title>x&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; • Tapuziel<\/title>/.test(editorPage.text) && /<span class="section-title">x&lt;\/title&gt;&lt;script&gt;/.test(editorPage.text),
      'xss: the <title> and the top bar print the name escaped (kit.screen escapes its title)');
    const made = kit.screen({ key: 'store', title: '<b>bold</b> & "q"', body: '' });
    ok(!/<b>bold<\/b>/.test(made) && (made.match(/&lt;b&gt;bold&lt;\/b&gt; &amp; &quot;q&quot;/g) || []).length === 2, 'admin-kit: screen() escapes the title in both places it lands');
    ok(!/<script>alert\(1\)/.test((await get('/admin/store/products')).text), 'xss: …nor in the product list');
    store.settings.saveSettings({
      shipping: [{ id: 'pickup', label: '<b>ship</b>', price: '0', address: false }],
      payments: [{ id: 'cash', kind: 'cash', label: '<img src=x onerror=alert(2)>' }]
    });
    const hubX = await get('/admin/store');
    ok(hubX.status === 200 && !/<script>alert\(1\)/.test(hubX.text), 'xss: …nor in the hub (the health card names it as text)');
    ok(!/<img src=x/.test(hubX.text) && /&lt;img src=x onerror=alert\(2\)&gt;/.test(hubX.text) && !/<b>ship<\/b>/.test(hubX.text) && /&lt;b&gt;ship&lt;\/b&gt;/.test(hubX.text),
      'xss: a payment label and a shipping label with markup are escaped in the hub\'s readiness list');

    // ── the hub ───────────────────────────────────────────────────────
    const check = (html, key) => {
      const m = new RegExp('<li class="([^"]*)" data-check="' + key + '">([\\s\\S]*?)</li>').exec(html);
      return m ? { cls: m[1], html: m[2] } : { cls: '', html: '' };
    };
    ok(/הזמנות היום · \d+/.test(hubX.text) && /הזמנות החודש · \d+/.test(hubX.text) && !/>היום · /.test(hubX.text), 'hub: the money tiles are named for what they sum — orders, paid or not');
    ok(/<div class="stat-num" style="--n:\d+">/.test(hubX.text), 'hub: a money tile tells the stylesheet how long its number is (so a total of millions fits)');
    ok(/shop \(חסר\)/.test(hubX.text) && !/href="\/admin\/edit\/shop"/.test(hubX.text), 'hub: a store page that does not exist yet is printed as text, not as a link to a 404');
    ok(/href="\/admin\/store\/shelves">🗂️ קטגוריות<\/a>/.test(hubX.text) && /href="\/admin\/store\/bentml#csv" data-nav-full>/.test(hubX.text), 'hub: quick links to the categories and to the CSV door');

    store.settings.saveSettings({
      shipping: [{ id: 'pickup', label: 'איסוף עצמי', price: '0', address: false }],
      payments: [{ id: 'paypal', kind: 'paypal', label: 'PayPal' }]
    });
    const closedHub = check((await get('/admin/store')).text, 'payments');
    ok(closedHub.cls === 'is-todo' && /אין כרגע אף אמצעי תשלום זמין בקופה/.test(closedHub.html), 'hub: PayPal only, no keys, store CLOSED → payments is not green (amber: nothing would be offered)');
    const flip = await api('/admin/api/store/flip', { open: true });
    ok(flip.status === 200 && flip.json.ok, 'the store opens');
    const openHub = (await get('/admin/store')).text;
    const red = check(openHub, 'payments');
    ok(red.cls === 'is-bad' && /אין כרגע אף אמצעי תשלום זמין בקופה — אי אפשר להזמין/.test(red.html) && /href="\/admin\/store\/settings#payments" data-nav-full>/.test(red.html),
      'hub: PayPal only, no keys, store OPEN → RED "אי אפשר להזמין", with a button to the settings');
    const pp = check(openHub, 'paypal');
    ok(pp.cls === 'is-bad' && /PayPal: לא מחובר/.test(pp.html) && /חסרים מפתחות PayPal/.test(pp.html), 'hub: a PayPal line says "לא מחובר" and why');
    ok(/href="\/admin\/edit\/shop">shop<\/a>/.test(openHub), 'hub: once the store pages exist they are links again');
    store.settings.saveSettings({ payments: [{ id: 'paypal', kind: 'paypal', label: 'PayPal' }, { id: 'cash', kind: 'cash', label: 'מזומן' }] });
    const amber = check((await get('/admin/store')).text, 'payments');
    ok(amber.cls === 'is-todo' && /אמצעי תשלום בקופה: מזומן/.test(amber.html) && /לא מוצעים כרגע: PayPal \(חסרים מפתחות PayPal\)/.test(amber.html),
      'hub: add cash → no longer red; it names what IS offered and what is held back, and why');
    store.settings.saveSettings({ payments: [{ id: 'cash', kind: 'cash', label: 'מזומן' }] });
    const greenHub = (await get('/admin/store')).text;
    const green = check(greenHub, 'payments');
    ok(green.cls === 'is-ok' && /אמצעי תשלום בקופה: מזומן/.test(green.html) && check(greenHub, 'paypal').cls === '', 'hub: cash alone → green, and no PayPal line when there is no PayPal method');

    // ── the money tiles: orders, and the paid part of them ────────────
    ok(!/st-stat-sub/.test(greenHub), 'hub: a day with no orders prints no "מתוכן שולמו" line');
    const buy = (sku) => req('POST', '/api/store/checkout', {
      body: { items: [{ sku, qty: 1 }], shipping: 'pickup', payment: 'cash', customer: { name: 'דנה כהן', phone: '0501234567' } }
    });
    const o1 = await buy('linen');
    const o2 = await buy('jeans');
    const o3 = await buy('jeans');
    ok(o1.status === 200 && o2.status === 200 && o3.status === 200 && !!o1.json.order && !!o3.json.order, 'three orders are placed (₪189, ₪249, ₪249)');
    store.orders.markPaid(o1.json.order.number, true);
    store.orders.markPaid(o3.json.order.number, true);
    store.orders.setStatus(o3.json.order.number, 'cancelled');
    const tiles = (await get('/admin/store')).text;
    const paidText = store.money.formatMoney(18900, 'ILS');
    const tile = (label) => {
      const m = new RegExp('<div class="stat"><div class="stat-num"[^>]*>([^<]*)</div><div class="stat-label">' + label + ' · (\\d+)</div>(?:<div class="st-stat-sub">([^<]*)</div>)?</div>').exec(tiles);
      return m ? { total: m[1], count: m[2], sub: m[3] || '' } : { total: '', count: '', sub: '' };
    };
    const day = tile('הזמנות היום');
    const month = tile('הזמנות החודש');
    ok(day.count === '2' && day.total === store.money.formatMoney(43800, 'ILS') && month.count === '2' && month.total === day.total,
      'hub: the tiles sum the two orders that were not cancelled, paid or not (₪438)');
    ok(day.sub === 'מתוכן שולמו: ' + paidText && month.sub === day.sub,
      'hub: under each, "מתוכן שולמו" is the paid part only — the unpaid order and the cancelled paid one are not in it (₪189)');

    // ── catalog health ────────────────────────────────────────────────
    mk({ title: 'נר לבנדר', slug: 'lavender', price: '89.90', stock: 3, shelf: 'home-decor', images: ['/assets/a.png'] });
    mk({ title: 'מתנה', slug: 'free', price: '0', shelf: 'home-decor', images: ['/assets/a.png'] });
    mk({ title: 'אזל', slug: 'gone', price: '10', stock: 0, shelf: 'home-decor', images: ['/assets/a.png'] });
    mk({ title: 'בעבודה', slug: 'draft1', price: '10', shelf: 'home-decor', status: 'draft', images: ['/assets/a.png'] });
    // (linen, hidden-shirt, jeans lost their category above; xss has no picture)
    const health = (await get('/admin/store')).text;
    const n = (key) => { const m = new RegExp('data-health="' + key + '">[\\s\\S]*?class="st-health-n">([^<]*)<').exec(health); return m ? m[1] : ''; };
    ok(n('no-image') === '1' && n('free') === '1' && n('no-shelf') === '2' && n('draft') === '1' && n('out') === '1' && n('low') === '1',
      'hub: catalog health counts — no picture 1 · price 0 1 · no category 2 (the hidden one is not counted) · drafts 1 · sold out 1 · low stock 1');
    ok(/data-health="no-image">[\s\S]*?<a href="\/admin\/store\/products\/\d+">x&lt;\/title&gt;/.test(health) && /href="\/admin\/store\/products\?status=draft">/.test(health) &&
      /href="\/admin\/store\/products\?status=active&stock=out">/.test(health), 'hub: each line opens onto its products, and links to the filtered list where the list can filter');
    for (let i = 1; i <= 11; i++) mk({ title: 'בלי תמונה ' + i, slug: 'bare-' + i, price: '10', shelf: 'home-decor' });
    const crowded = /data-health="no-image">([\s\S]*?)<\/details>/.exec((await get('/admin/store')).text);
    ok(!!crowded && (crowded[1].match(/<li><a href="\/admin\/store\/products\/\d+">/g) || []).length === 12 && !/ועוד/.test(crowded[1]),
      'hub: a line with twelve products behind it names all twelve (the list scrolls) — none is hidden behind "ועוד"');

    // ── the storefront really follows ─────────────────────────────────
    cat.updateProduct('linen', { shelf: 'home-decor' });
    await api(S + '/gifts', { isNew: true, label: 'מתנות יפות' });
    cat.updateProduct('jeans', { shelf: 'gifts' });
    const renameLive = await api(S + '/gifts', { label: 'מתנות מושלמות' });
    const shop = await get('/shop');
    ok(renameLive.json.rebuilt === true && shop.status === 200 && /מתנות מושלמות/.test(shop.text) && !/מתנות יפות/.test(shop.text),
      'storefront: after a rename the public shop page carries the new name — the write rebuilt the site');

    // ── CSV ───────────────────────────────────────────────────────────
    const csvIo = require('../src/store/csv-io');
    const exported = csvIo.exportCsv();
    const total = cat.listProducts({ status: 'all', limit: 100000 }).length;
    const same = await api('/admin/api/store/import-csv', { csv: exported });
    ok(same.status === 200 && same.json.ok && same.json.count === total && same.json.preview.added.length === 0 && same.json.preview.changed.length === 0 &&
      same.json.preview.hidden.length === 0 && same.json.preview.unchanged === total && same.json.costs === 0 && typeof same.json.source === 'string' && /^<bent-store[^>]*mode="merge"/.test(same.json.source),
      `csv: export → import preview changes nothing (${total} rows unchanged, none hidden — a sheet is a merge)`);
    const sheet = 'sku,title,price,cost,category\nlavender,נר לבנדר,95,31.50,לבית\nnew-mug,ספל חדש,45,12.50,לבית\n';
    const pv = await api('/admin/api/store/import-csv', { csv: sheet });
    ok(pv.status === 200 && pv.json.ok && pv.json.count === 2 && pv.json.preview.added.some((x) => x.id === 'new-mug') && pv.json.preview.changed.some((x) => x.id === 'lavender') &&
      pv.json.preview.hidden.length === 0 && !cat.getProduct('new-mug') && cat.getProduct('lavender').price === 8990,
      'csv: a sheet with a new product previews it under "added" (and the price change under "changed") — nothing is written');
    const costOnly = await api('/admin/api/store/import-csv', { csv: 'sku,title,cost\nlavender,נר לבנדר,31.50\n' });
    ok(pv.json.costs === 2 && costOnly.status === 200 && costOnly.json.costs === 1 && costOnly.json.preview.changed.length === 0 && cat.getProduct('lavender').cost === null,
      'csv: the preview counts the costs that would change — a sheet that only changes a cost does not preview as "no changes"');
    const backupsBefore = store.document.listBackups().length;
    const ap = await api('/admin/api/store/import-csv', { csv: sheet, apply: true });
    const mug = cat.getProduct('new-mug');
    ok(ap.status === 200 && ap.json.ok && ap.json.backupId > 0 && !!mug && mug.price === 4500 && mug.cost === 1250 && mug.shelf === 'home-decor' &&
      cat.getProduct('lavender').price === 9500 && cat.getProduct('lavender').cost === 3150 && ap.json.costs === 2,
      'csv: apply creates the product, changes the price, and writes both costs (the document cannot carry a cost)');
    ok(store.document.listBackups().length === backupsBefore + 1 && store.document.listBackups()[0].reason === 'csv' && cat.getProduct('gone').status === 'active' && cat.getProduct('gone').price === 1000,
      'csv: a backup named "csv" exists afterwards, and a product the file did not mention is as it was');
    const undo = await api('/admin/api/store/undo', {});
    ok(undo.status === 200 && cat.getProduct('lavender').price === 8990, 'csv: "ביטול החלה אחרונה" puts the price back');
    ok(cat.getProduct('lavender').cost === null && cat.getProduct('new-mug').cost === 1250 && /"ביטול החלה אחרונה" מחזיר גם אותו/.test((await get('/admin/store/bentml')).text),
      'csv: …and the cost with it (a backup keeps the costs beside its document; a product the import created keeps its own) — and the preview says so before the owner applies');
    const headless = await api('/admin/api/store/import-csv', { csv: 'price,stock\n10,5\n' });
    ok(headless.status === 400 && headless.json.ok === false && HEBREW.test((headless.json.errors[0] || {}).message || '') && /sku/.test(headless.json.errors[0].message),
      'csv: a header with neither a sku nor a title/name column is refused, in Hebrew');
    const holes = await api('/admin/api/store/import-csv', { csv: 'sku,title,price\nok-row,שורה טובה,10\nbad-row,,10\n' });
    ok(holes.status === 200 && holes.json.ok && holes.json.hard === true && holes.json.errors.some((e) => e.line === 3 && /^שורה 3: /.test(e.message)),
      'csv: a row with no name is named by its line, and the rest asks for a yes before it is applied');
    const big = await api('/admin/api/store/import-csv', { csv: 'sku,title\n' + 'x'.repeat(2 * 1024 * 1024 + 10) });
    ok(big.status === 400 && /2MB/.test((big.json.errors[0] || {}).message || ''), 'csv: a sheet over 2 MB is refused');
    const bentml = await get('/admin/store/bentml');
    ok(bentml.status === 200 && /<section class="card" id="csv">/.test(bentml.text) && bentml.text.includes(csvIo.HEAD.join(', ')) && /href="\/admin\/store\/products\.csv" data-nav-full>/.test(bentml.text) &&
      /id="csv-file" accept="\.csv,text\/csv"/.test(bentml.text), 'csv: the BenTML screen has the CSV card (#csv) — the column list from csv-io, the export link, the file field');
    ok(/TapuzInjectCard\.mount\(el, 'store-catalog'/.test(bentml.text) && /function render\(d, target\)/.test(bentml.text), 'csv: the screen still mounts the AI catalog writer, and both doors share one preview renderer');

    // ── a clean catalog says so in one line ───────────────────────────
    const keep = cat.getProduct('linen');
    const rest = cat.listProducts({ status: 'all', limit: 100000 }).filter((p) => p.id !== keep.id).map((p) => p.id);
    cat.bulkUpdate(rest, { delete: true });
    const calm = (await get('/admin/store')).text;
    ok(/הקטלוג נקי ✓/.test(calm) && !/class="st-health"/.test(calm), 'hub: a catalog with nothing to fix says "הקטלוג נקי ✓" and nothing else');

    // ── the site's page-categories screen ─────────────────────────────
    const pageCats = await get('/admin/categories', EDITOR);
    ok(pageCats.status === 200 && /data-media-pick="cat-img-' \+ i \+ '"/.test(pageCats.text) && /src="\/admin-media-picker\.js/.test(pageCats.text), 'page categories: the picture field has the media picker button');
    ok((await req('GET', '/admin/api/categories', { cookie: EDITOR })).status === 200, 'page categories: an editor still reaches them — they are content, not the store');

    // ── the stylesheet block ──────────────────────────────────────────
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin.css'), 'utf8');
    const from = css.indexOf('/* ── store: categories + hub (v2.69) ──');
    const to = css.indexOf('/* ── store: orders + gateway (v2.69) ──');
    const block = from >= 0 && to > from ? css.slice(from, to) : '';
    const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
    ok(block.length > 2000 && !/var\(--(color-|radius-|accent-bg|font-family|max-width)/.test(rules) &&
      !/21px|9997|#e11d48|#050202|\.31em|7px dashed|Impact|Frank Ruhl|cursor:\s*none/i.test(rules) && !/\b(margin|padding|border)-(left|right)\b|[^-]\b(left|right):/.test(rules),
      'css: the categories + hub block reads admin tokens only, has none of the theme sentinels, and uses no physical left/right');
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    child.kill();
  }
  console.log('\nSMOKE STORE-SHELVES-ADMIN: ' + (failed ? 'FAIL (' + failed + ')' : 'PASS'));
  process.exit(failed ? 1 : 0);
})();
