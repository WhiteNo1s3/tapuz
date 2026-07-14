'use strict';

/**
 * v0.66 QA — the export-file importer (src/importers). Proves a WordPress WXR
 * imports STRAIGHT from its Gutenberg structure (heading/columns/list map
 * directly), classic HTML falls back to the decompiler, drafts + non-content
 * items are skipped, and every produced page is valid .pzn.
 */

const { importFile, detectFormat } = require('../src/importers');
const pzn = require('../src/pzn/index');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const wxr = `<?xml version="1.0"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <item>
    <title>עמוד הבית</title>
    <wp:post_name>home</wp:post_name>
    <wp:post_type>page</wp:post_type>
    <wp:status>publish</wp:status>
    <content:encoded><![CDATA[
      <!-- wp:heading {"level":1} --><h1>ברוכים הבאים</h1><!-- /wp:heading -->
      <!-- wp:paragraph --><p>פסקה עם &copy; ותו &nbsp; מיוחד.</p><!-- /wp:paragraph -->
      <!-- wp:columns --><!-- wp:column --><!-- wp:heading --><h2>שמאל</h2><!-- /wp:heading --><!-- /wp:column --><!-- wp:column --><!-- wp:paragraph --><p>ימין</p><!-- /wp:paragraph --><!-- /wp:column --><!-- /wp:columns -->
      <!-- wp:list --><ul><li>פריט א</li><li>פריט ב</li></ul><!-- /wp:list -->
    ]]></content:encoded>
  </item>
  <item>
    <title>כתבה קלאסית</title>
    <wp:post_name>classic</wp:post_name>
    <wp:post_type>post</wp:post_type>
    <wp:status>publish</wp:status>
    <content:encoded><![CDATA[<h2>כותרת</h2><p>גוף הכתבה הקלאסית ללא גוטנברג.</p><img src="/x.jpg">]]></content:encoded>
  </item>
  <item>
    <title>טיוטה</title><wp:post_type>page</wp:post_type><wp:status>draft</wp:status>
    <content:encoded><![CDATA[<p>לא אמור להיכנס</p>]]></content:encoded>
  </item>
  <item>
    <title>תפריט</title><wp:post_type>nav_menu_item</wp:post_type><wp:status>publish</wp:status>
  </item>
</channel></rss>`;

check('detectFormat recognizes WXR', detectFormat(wxr, 'export.xml') === 'wordpress');

const { format, pages } = importFile(wxr, { filename: 'export.xml' });
check('format is wordpress', format === 'wordpress');
check('skips draft + nav item → exactly 2 pages', pages.length === 2);

const home = pages.find((p) => p.slug === 'home');
check('home page imported', !!home);
check('home slug + title kept', home && home.title === 'עמוד הבית' && home.slug === 'home');
check('every page is valid .pzn', pages.every((p) => p.valid));

// re-parse home's .pzn and inspect the mapped blocks
const homeBlocks = pzn.toTapuzPage(pzn.parse(home.source)).blocks;
const types = homeBlocks.map((b) => b.type);
check('gutenberg heading L1 → heading', homeBlocks.some((b) => b.type === 'heading' && b.data.level === 1 && b.data.text === 'ברוכים הבאים'));
check('gutenberg columns → columns block', homeBlocks.some((b) => b.type === 'columns' && (b.data.columns || []).length === 2));
check('gutenberg list → list block (2 items)', homeBlocks.some((b) => b.type === 'list' && (b.data.items || []).length === 2));
check('entity decoded in paragraph (© not &copy;)', homeBlocks.some((b) => b.type === 'text' && /©/.test(b.data.content) && !/&copy;/.test(b.data.content)));

const classic = pages.find((p) => p.slug === 'classic');
const classicBlocks = pzn.toTapuzPage(pzn.parse(classic.source)).blocks;
check('classic (no gutenberg) → decompiler fallback mapped heading+text+image',
  classicBlocks.some((b) => b.type === 'heading') && classicBlocks.some((b) => b.type === 'image'));

console.log('');
console.log(fail ? 'SMOKE IMPORT-FILE: FAIL' : 'SMOKE IMPORT-FILE: PASS');
process.exit(fail ? 1 : 0);
