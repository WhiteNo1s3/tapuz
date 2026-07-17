'use strict';

/**
 * v0.81 QA gate — the forms inbox: the FORM module finally has a stomach.
 *
 * Store contract (size caps, honeypot-adjacent key stripping, read/delete
 * lifecycle) on a THROWAWAY site via TAPUZ_ROOT, plus the renderer contract
 * (default action = /api/form, honeypot present). Exit 1 on any failure.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// BEFORE any src require — src/paths.js resolves TAPUZ_ROOT at require time
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-inbox-'));
process.env.TAPUZ_ROOT = tmpRoot;

const forms = require('../src/forms');
const { renderFormFromData } = require('../src/pzn/form-html');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

// ── renderer contract ──
const html = renderFormFromData({ fields: [{ label: 'שם', name: 'name' }] }, 'rtl');
check(html.includes('action="/api/form"'), 'empty action defaults to the built-in inbox');
check(html.includes('name="_hp"') && html.includes('bent-hp'), 'honeypot field present and hidden');
check(renderFormFromData({ action: 'https://crm.example.com/x', fields: [] }, 'rtl')
  .includes('action="https://crm.example.com/x"'), 'explicit action still wins');

// ── store: save + strip + caps ──
const saved = forms.saveSubmission({
  page: 'צור-קשר',
  fields: { שם: 'דנה', אימייל: 'dana@example.com', הודעה: 'שלום!', _hp: '', _page: 'x' }
});
check(saved.ok === true, 'submission saved');
const got = forms.getSubmission(saved.id);
check(got && got.page === 'צור-קשר', 'page attribution stored');
check(got.fields['שם'] === 'דנה' && got.fields['הודעה'] === 'שלום!', 'fields stored verbatim');
check(!('_hp' in got.fields) && !('_page' in got.fields), 'internal _-keys stripped');
check(got.is_read === 0, 'lands unread');

check(forms.saveSubmission({ fields: {} }).ok === false, 'empty submission rejected');
check(forms.saveSubmission({ fields: { _hp: 'bot' } }).ok === false, 'only-internal keys → rejected');

const tooMany = {};
for (let i = 0; i < 45; i++) tooMany['f' + i] = 'x';
check(forms.saveSubmission({ fields: tooMany }).ok === false, 'field-count cap enforced');

const huge = { msg: 'א'.repeat(30000) };
const cappedSave = forms.saveSubmission({ fields: huge });
check(cappedSave.ok === true && forms.getSubmission(cappedSave.id).fields.msg.length <= 4000,
  'oversized value truncated, submission survives');

const arr = forms.saveSubmission({ fields: { בחירה: ['א', 'ב'] } });
check(forms.getSubmission(arr.id).fields['בחירה'] === 'א, ב', 'multi-select arrays joined');

// ── lifecycle: list / unread / read / delete ──
check(forms.listSubmissions()[0].id === arr.id, 'list is newest-first');
const unreadBefore = forms.unreadCount();
check(unreadBefore >= 3, 'unread count sees the new ones');
forms.markRead(saved.id, true);
check(forms.unreadCount() === unreadBefore - 1, 'markRead drops the count');
forms.markRead(saved.id, false);
check(forms.unreadCount() === unreadBefore, 'markRead(false) restores');
check(forms.deleteSubmission(saved.id) === true, 'delete works');
check(forms.getSubmission(saved.id) === null, 'deleted is gone');

// ── CSV export (v0.87) — the inbox as an Excel-ready spreadsheet ──
forms.saveSubmission({ page: 'landing', fields: { email: 'a@b.co', note: '=HYPERLINK("evil")' } });
forms.saveSubmission({ page: 'צור-קשר', fields: { שם: 'רות, "המנהלת"', הודעה: 'שורה\nשנייה' } });
const csv = forms.toCsv(forms.allSubmissions());
check(csv.charCodeAt(0) === 0xfeff, 'CSV opens with a UTF-8 BOM (Excel reads Hebrew)');
check(csv.includes('\r\n'), 'CSV uses CRLF rows');
const headRow = csv.slice(1).split('\r\n')[0];
check(headRow.startsWith('"id","created_at","page","read"'), 'fixed head columns first');
check(headRow.includes('"email"') && headRow.includes('"שם"'),
  'field columns are the union across different forms');
check(csv.includes('"רות, ""המנהלת"""'), 'quotes doubled, commas survive inside quotes');
check(csv.includes('שורה\nשנייה'), 'multiline value survives inside its quoted cell');
check(csv.includes('"\'=HYPERLINK'), 'formula injection neutralized (leading apostrophe)');
check(!/[^'"]=HYPERLINK/.test(csv), 'no unguarded formula cell anywhere');
check(forms.toCsv([]).slice(1).startsWith('"id"'), 'empty inbox exports a header-only sheet');
check(forms.allSubmissions().length === forms.listSubmissions({ limit: 500 }).length,
  'allSubmissions sees everything the list sees');

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}

console.log('');
if (failures) {
  console.log('SMOKE FORMS-INBOX: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE FORMS-INBOX: PASS');
