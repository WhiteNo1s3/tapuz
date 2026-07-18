'use strict';

/**
 * v1.00 QA gate — the lead pipeline: a form submission graduates into a
 * worked lead (status + private notes), the CRM half of "CMS/CRM" that was
 * missing since v0.81's forms inbox. Throwaway TAPUZ_ROOT (so the migration
 * in src/db.js runs against a fresh DB), plus a legacy-row check (a
 * submission written before this version has no status/notes columns set —
 * proves the migration default, not just a fresh-install default).
 * Exit 1 on any failure.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-crm-'));
process.env.TAPUZ_ROOT = tmpRoot;

const forms = require('../src/forms');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

// ── a new submission lands as a fresh, unworked lead ──
const lead = forms.saveSubmission({ page: 'צור-קשר', fields: { שם: 'דנה', אימייל: 'dana@example.com' } });
check(lead.ok === true, 'submission saved');
const got = forms.getSubmission(lead.id);
check(got.status === 'new', 'a new submission defaults to status "new"');
check(got.notes === '' || got.notes == null, 'a new submission has no notes yet');

// ── STATUSES / STATUS_LABELS: the pipeline vocabulary ──
check(forms.STATUSES.includes('new') && forms.STATUSES.includes('won') && forms.STATUSES.includes('lost'),
  'the pipeline covers new/won/lost at minimum');
check(forms.STATUSES.every((s) => typeof forms.STATUS_LABELS[s] === 'string' && forms.STATUS_LABELS[s].length > 0),
  'every status has a Hebrew label — none silently unlabeled in the admin UI');

// ── setStatus: valid transitions persist, invalid ones are rejected cleanly ──
check(forms.setStatus(lead.id, 'contacted') === true, 'valid status change succeeds');
check(forms.getSubmission(lead.id).status === 'contacted', 'the change actually persisted');
check(forms.setStatus(lead.id, 'qualified') === true, 'a lead can move through multiple stages');
check(forms.getSubmission(lead.id).status === 'qualified', 'latest stage persisted');

check(forms.setStatus(lead.id, 'made-up-status') === false, 'an unrecognized status is rejected');
check(forms.getSubmission(lead.id).status === 'qualified', 'a rejected status write does not corrupt the existing value');
check(forms.setStatus(999999, 'won') === false, 'setStatus on a missing id returns false, never throws');

// ── setNotes: private admin notes, capped, never a fields-column collision ──
check(forms.setNotes(lead.id, 'התקשרתי, מעוניינים בחבילה השנייה') === true, 'notes save');
check(forms.getSubmission(lead.id).notes === 'התקשרתי, מעוניינים בחבילה השנייה', 'notes persist verbatim');
check(forms.setNotes(lead.id, '') === true, 'notes can be cleared');
check(forms.getSubmission(lead.id).notes === '', 'cleared notes read back empty');

const hugeNotes = 'א'.repeat(10000);
forms.setNotes(lead.id, hugeNotes);
check(forms.getSubmission(lead.id).notes.length <= 4000, 'oversized notes are truncated, never crash the write');
check(forms.setNotes(lead.id, null) === true, 'null notes degrades to empty string, never throws');

// ── toCsv: the pipeline shows up in the export, existing columns unmoved ──
forms.setStatus(lead.id, 'won');
forms.setNotes(lead.id, 'סגור');
const csv = forms.toCsv(forms.allSubmissions());
const headRow = csv.slice(1).split('\r\n')[0];
check(headRow.startsWith('"id","created_at","page","read"'), 'existing fixed columns keep their position (no smoke-forms-inbox regression)');
check(headRow.includes('"status"') && headRow.includes('"notes"'), 'status and notes are exported columns');
check(csv.includes('"won"') && csv.includes('"סגור"'), 'the actual pipeline data appears in the export');

// ── a legacy row (written before this version, no explicit status set) still
//    reads as 'new' via the DB column default — the migration invariant ──
const { db } = require('../src/db');
const legacyId = db.prepare('INSERT INTO form_submissions (page, fields) VALUES (?, ?)')
  .run('legacy-page', JSON.stringify({ note: 'pre-v1.00 row' })).lastInsertRowid;
const legacy = forms.getSubmission(Number(legacyId));
check(legacy.status === 'new', 'a legacy row (status never explicitly set) reads as "new" via the column default');

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}

console.log('');
if (failures) {
  console.log('SMOKE CRM-PIPELINE: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE CRM-PIPELINE: PASS');
