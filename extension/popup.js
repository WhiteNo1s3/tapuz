'use strict';

/**
 * Tapuziel — מלווה ההעתקה (v0.4, Ben's realignment).
 *
 * The whole philosophy in one file: the extension does NOTHING on the LLM
 * sites. No content scripts, no DOM reading, no auto-send — the public chats
 * are our natural partners, and the user is the only one who acts there.
 * Our job is copy, paste, and looking good in orange:
 *
 *   1. the user types a thought → one button copies [roleplay pack + site
 *      vocabulary + real media + that thought] from THEIR Tapuziel
 *   2. they paste it into any chat THEY are logged into and press send
 *   3. they copy the reply, paste it here → create-from-source turns it
 *      into a real draft page (the server extracts/repairs; loose input ok)
 *
 * Zero host permissions: /agent/v1 speaks CORS (ACAO *), so the popup can
 * fetch any Tapuziel with only its bearer token. The token is stored in
 * extension storage and sent ONLY to the base URL the user configured.
 */

var $ = function (id) { return document.getElementById(id); };
var store = (typeof browser !== 'undefined' ? browser : chrome).storage.local;

function getCfg() {
  return new Promise(function (resolve) {
    store.get(['baseUrl', 'token', 'packSize'], function (c) { resolve(c || {}); });
  });
}
function setCfg(patch) {
  return new Promise(function (resolve) { store.set(patch, resolve); });
}

function status(id, msg, kind) {
  var el = $(id);
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.textContent = msg || '';
}

function normBase(raw) {
  var b = String(raw || '').trim().replace(/\/+$/, '');
  if (b && !/^https?:\/\//i.test(b)) b = 'http://' + b;
  return b;
}

function api(cfg, path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ Authorization: 'Bearer ' + cfg.token }, opts.headers || {});
  return fetch(cfg.baseUrl + path, opts);
}

// ── connect ──────────────────────────────────────────────────────────────

function markConnected(name) {
  $('conn-dot').classList.add('on');
  $('conn-label').textContent = 'מחובר: ' + name;
}

function testConnection(silent) {
  return getCfg().then(function (cfg) {
    if (!cfg.baseUrl || !cfg.token) {
      if (!silent) status('conn-status', 'מלאו כתובת וטוקן', 'err');
      $('connect-fold').open = true;
      return false;
    }
    return api(cfg, '/agent/v1/ping').then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) {
        markConnected(d.agent + ' · v' + d.version);
        if (!silent) status('conn-status', '✓ מחובר', 'ok');
        return true;
      }
      if (!silent) status('conn-status', d.error || 'הטוקן נדחה', 'err');
      $('connect-fold').open = true;
      return false;
    }).catch(function () {
      if (!silent) status('conn-status', 'אין תשובה מ-' + cfg.baseUrl + ' — האתר רץ?', 'err');
      $('connect-fold').open = true;
      return false;
    });
  });
}

$('btn-connect').addEventListener('click', function () {
  var baseUrl = normBase($('base-url').value);
  var token = $('token').value.trim();
  var patch = { baseUrl: baseUrl };
  if (token) patch.token = token; // empty field keeps the stored token
  setCfg(patch).then(function () {
    status('conn-status', 'בודק…');
    testConnection(false);
  });
});

// ── 1 · copy the pack + the user's thought ──────────────────────────────

$('btn-copy').addEventListener('click', function () {
  var brief = $('brief').value.trim();
  var size = $('pack-size').value;
  setCfg({ packSize: size });
  status('copy-status', 'מרכיב את החבילה…');
  getCfg().then(function (cfg) {
    if (!cfg.baseUrl || !cfg.token) {
      status('copy-status', 'קודם מתחברים למעלה', 'err');
      $('connect-fold').open = true;
      return;
    }
    var q = '/agent/v1/roleplay?size=' + encodeURIComponent(size) +
      (brief ? '&brief=' + encodeURIComponent(brief) : '');
    api(cfg, q).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (pack) {
      return navigator.clipboard.writeText(pack).then(function () {
        status('copy-status', '✓ הועתק (' + Math.round(pack.length / 1024) + 'KB) — הדביקו בצ׳אט ושלחו', 'ok');
      });
    }).catch(function (e) {
      status('copy-status', 'שגיאה: ' + e.message, 'err');
    });
  });
});

// ── 2 · the reply becomes a draft page ──────────────────────────────────

function createFromReply(update) {
  var source = $('reply').value.trim();
  if (!source) { status('create-status', 'מדביקים כאן את תשובת הבוט קודם', 'err'); return; }
  status('create-status', 'יוצר דף…');
  $('create-result').innerHTML = '';
  getCfg().then(function (cfg) {
    if (!cfg.baseUrl || !cfg.token) {
      status('create-status', 'קודם מתחברים למעלה', 'err');
      $('connect-fold').open = true;
      return;
    }
    var body = { source: source, publish: false };
    if (update) body.update = true;
    api(cfg, '/agent/v1/create-from-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (res) {
        var d = res.d;
        if (d.ok) {
          status('create-status',
            (d.created ? '✓ נוצר דף חדש' : '✓ הדף עודכן') +
            (d.repaired ? ' (תוקן אוטומטית — בדקו בבונה)' : '') + ' — טיוטה', 'ok');
          var a = document.createElement('a');
          a.className = 'result-link';
          a.href = cfg.baseUrl + '/admin/edit/' + encodeURIComponent(d.fullPath);
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = '🍊 לפתוח את "' + d.fullPath + '" בבונה';
          $('create-result').appendChild(a);
          return;
        }
        if (res.status === 409 && d.fullPath) {
          status('create-status', 'דף בשם "' + d.fullPath + '" כבר קיים', 'err');
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn ghost';
          b.textContent = '↻ עדכן את הדף הקיים';
          b.addEventListener('click', function () { createFromReply(true); });
          $('create-result').appendChild(b);
          return;
        }
        status('create-status', d.error || 'התשובה לא הכילה מסמך תקין', 'err');
      })
      .catch(function (e) { status('create-status', 'שגיאה: ' + e.message, 'err'); });
  });
}

$('btn-create').addEventListener('click', function () { createFromReply(false); });

// ── boot ────────────────────────────────────────────────────────────────

getCfg().then(function (cfg) {
  if (cfg.baseUrl) $('base-url').value = cfg.baseUrl;
  if (cfg.packSize) $('pack-size').value = cfg.packSize;
  if (cfg.baseUrl && cfg.token) testConnection(true);
  else $('connect-fold').open = true;
});
