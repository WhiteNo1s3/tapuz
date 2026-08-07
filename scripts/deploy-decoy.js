'use strict';

/**
 * The no-op "build" for deploy pipelines that insist on one (npm run build).
 *
 * Tapuziel has no build step — the server renders pages itself. This script
 * exists for pipelines whose app entry is misconfigured as a build-then-serve
 * framework (the live Hostinger case was a web app typed as Next.js):
 *
 *   - A NODE pipeline (build → start) hits its ".next exists?" gate, passes,
 *     and proceeds to `npm start` → node src/server.js. The decoy is scenery.
 *   - A STATIC pipeline (build → publish output dir) grabs .next/ and serves
 *     it as the site. Nothing can save that deploy — such a pipeline cannot
 *     run a Node server — so the decoy's index.html IS the error message:
 *     whoever opens the domain sees exactly what happened and how to fix it,
 *     instead of the webserver's bare 403 for an index-less folder.
 */

const fs = require('fs');

fs.mkdirSync('.next', { recursive: true });
fs.writeFileSync('.next/BUILD_ID', 'tapuziel-no-op');
fs.writeFileSync('.next/index.html', `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>תפוזיאל: שרת, לא אתר סטטי</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;max-width:44rem;margin:8vh auto;padding:0 1.5rem;line-height:1.7;color:#1f2937;background:#fff7ed}
  h1{color:#c2410c}
  code{background:#ffedd5;padding:.1em .4em;border-radius:4px;direction:ltr;display:inline-block}
  .en{direction:ltr;text-align:left;border-top:1px solid #fdba74;margin-top:2.5rem;padding-top:1.5rem;color:#4b5563}
</style>
</head>
<body>
<h1>🍊 תפוזיאל הותקן — אבל האחסון הזה מגיש קבצים, לא מריץ שרת</h1>
<p>אם אתם רואים את הדף הזה, צינור הפריסה פרסם את תיקיית הפלט של "הבנייה"
כאתר סטטי. תפוזיאל הוא <strong>שרת Node.js חי</strong> (‎<code>node src/server.js</code>‎)
— אין לו פלט בנייה, וסוג הפריסה הנוכחי לא מסוגל להריץ אותו.</p>
<p><strong>התיקון:</strong> צרו את האפליקציה מחדש כ-<strong>Express.js / Node.js</strong>
(לא Next/React/סטטי), עם פקודת בנייה ריקה ונקודת כניסה ‎<code>src/server.js</code>‎.
אם הספק לא מציע סוג כזה — האחסון הזה לא יכול להריץ את תפוזיאל; נדרש
VPS או כל שרת שמריץ תהליך Node. המדריך המלא: ‎<code>docs/DEPLOY.md</code>‎ במאגר.</p>
<div class="en">
<p><strong>Tapuziel is a live Node.js server, not a static site.</strong>
This hosting mode published the build output directory as flat files, which can
never run it. Re-create the app as an <strong>Express.js/Node.js</strong> app
(empty build command, entry <code>src/server.js</code>), or use a host that runs
a Node process (VPS, Docker — see <code>docs/DEPLOY.md</code>).</p>
</div>
</body>
</html>
`);

console.log(
  'Tapuziel has no build step — the server renders pages itself. ' +
  'A decoy .next/ was created: a Node pipeline will pass its output check and continue to `npm start` (node src/server.js); ' +
  'a static pipeline that publishes .next/ will serve a page explaining that this hosting mode cannot run Tapuziel. ' +
  'Static export: npm run export:static'
);

// ── deploy diagnostics (v2.13) — the build log is our only eye on the server.
// The wizard-skip class of bug is always "which SITE_ROOT is the app really
// using, and what does that root's config claim?" — so the build answers it
// out loud on every deploy. Read the log via the deployments API. Best-effort:
// a diagnostics failure must never fail a deploy.
try {
  const path = require('path');
  const probe = (label, p) => {
    try {
      const st = fs.statSync(p);
      console.log('[diag] ' + label + ': EXISTS' + (st.isDirectory() ? ' (dir: ' + fs.readdirSync(p).slice(0, 8).join(', ') + ')' : ''));
    } catch (e) { console.log('[diag] ' + label + ': absent'); }
  };
  const src = process.cwd(); // .builds/source
  const publicHtml = path.resolve(src, '..', '..', 'public_html');
  probe('source/.tapuz-root', path.join(src, '.tapuz-root'));
  probe('public_html/.tapuz-root', path.join(publicHtml, '.tapuz-root'));
  probe('public_html/config/site.json', path.join(publicHtml, 'config', 'site.json'));
  probe('public_html/db', path.join(publicHtml, 'db'));
  probe('~/tapuz-data', path.join(process.env.HOME || '/home/<hostinger-user>', 'tapuz-data'));
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(publicHtml, 'config', 'site.json'), 'utf8'));
    console.log('[diag] tree config: setupDone=' + cfg.setupDone + ' title=' + JSON.stringify(cfg.title || ''));
  } catch (e) { /* no tree config */ }
  try {
    const dataCfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME || '/home/<hostinger-user>', 'tapuz-data', 'config', 'site.json'), 'utf8'));
    console.log('[diag] tapuz-data config: setupDone=' + dataCfg.setupDone + ' title=' + JSON.stringify(dataCfg.title || ''));
  } catch (e) { console.log('[diag] tapuz-data config: absent'); }
  console.log('[diag] paths.js resolves SITE_ROOT=' + require(path.join(src, 'src', 'paths')).SITE_ROOT);
} catch (e) {
  console.log('[diag] diagnostics failed: ' + e.message);
}

// ── public_html shadow cleanup (v2.13): the panel's static layer serves
// public_html files BEFORE the Node app, and the old git-flow deploys copied
// the repo's dev-export artifacts (index/home/about html + css/main.css)
// in there — permanently shadowing the live site's real pages and theme CSS
// (the sidebar fix shipped three times and never showed: this was why).
// Remove exactly those known artifact names, loudly; never touch anything
// else in public_html. Best-effort — cleanup must never fail a deploy.
try {
  const path = require('path');
  const publicHtml = path.resolve(process.cwd(), '..', '..', 'public_html');
  const staleArtifacts = [
    'index.html', 'home.html', 'about.html', 'articles.html',
    'contact.html', 'first-article.html', path.join('css', 'main.css')
  ];
  for (const rel of staleArtifacts) {
    const p = path.join(publicHtml, rel);
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        console.log('[clean] public_html/' + rel + ' removed (stale dev-export shadow)');
      }
    } catch (e) {
      console.log('[clean] public_html/' + rel + ': ' + e.message);
    }
  }
} catch (e) {
  console.log('[clean] shadow cleanup failed: ' + e.message);
}
