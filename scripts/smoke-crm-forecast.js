'use strict';

/**
 * v1.12 QA gate — deal value + follow-up date: the rest of "advanced CRM
 * pipeline" (v1.00 shipped status+notes; this closes the gap the hunt list
 * kept naming). Throwaway TAPUZ_ROOT so the db.js migration runs fresh.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-crm-forecast-'));
process.env.TAPUZ_ROOT = tmpRoot;

const forms = require('../src/forms');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

const lead = forms.saveSubmission({ page: 'צור-קשר', fields: { שם: 'דנה' } });
check(lead.ok === true, 'submission saved');
check(forms.getSubmission(lead.id).value === null, 'a new lead has no value set (null, not 0 — 0 is a real answer)');
check(forms.getSubmission(lead.id).follow_up_at === null, 'a new lead has no follow-up date set');

// ── setValue ──
check(forms.setValue(lead.id, 5000) === true, 'setting a value succeeds');
check(forms.getSubmission(lead.id).value === 5000, 'the value persists');
check(forms.setValue(lead.id, 0) === true, 'zero is a valid value (a real, small deal — not "unset")');
check(forms.getSubmission(lead.id).value === 0, 'zero persists as zero, not null');
check(forms.setValue(lead.id, -100) === false, 'a negative value is rejected');
check(forms.setValue(lead.id, 'not a number') === false, 'a non-numeric value is rejected');
check(forms.getSubmission(lead.id).value === 0, 'a rejected value write leaves the previous value untouched');
check(forms.setValue(lead.id, '') === true, 'an empty string clears the value back to null');
check(forms.getSubmission(lead.id).value === null, 'cleared value reads back as null');
check(forms.setValue(999999, 100) === false, 'setValue on a missing id returns false, never throws');

// ── setFollowUp ──
check(forms.setFollowUp(lead.id, '2026-08-01') === true, 'setting a follow-up date succeeds');
check(forms.getSubmission(lead.id).follow_up_at === '2026-08-01', 'the date persists');
check(forms.setFollowUp(lead.id, 'not-a-date') === false, 'a malformed date string is rejected');
check(forms.setFollowUp(lead.id, '13/25/2026') === false, 'a non-ISO date format is rejected');
check(forms.getSubmission(lead.id).follow_up_at === '2026-08-01', 'a rejected date write leaves the previous date untouched');
check(forms.setFollowUp(lead.id, '') === true, 'an empty string clears the follow-up date');
check(forms.getSubmission(lead.id).follow_up_at === null, 'cleared follow-up reads back as null');

// ── listDueFollowUps ──
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

const overdueLead = forms.saveSubmission({ page: 'x', fields: { a: '1' } });
forms.setFollowUp(overdueLead.id, yesterday);
const todayLead = forms.saveSubmission({ page: 'x', fields: { a: '1' } });
forms.setFollowUp(todayLead.id, today);
const futureLead = forms.saveSubmission({ page: 'x', fields: { a: '1' } });
forms.setFollowUp(futureLead.id, nextWeek);
const closedOverdueLead = forms.saveSubmission({ page: 'x', fields: { a: '1' } });
forms.setFollowUp(closedOverdueLead.id, yesterday);
forms.setStatus(closedOverdueLead.id, 'won');

const due = forms.listDueFollowUps();
const dueIds = due.map((d) => d.id);
check(dueIds.includes(overdueLead.id), 'an overdue lead shows up in the due list');
check(dueIds.includes(todayLead.id), 'a lead due today shows up in the due list');
check(!dueIds.includes(futureLead.id), 'a lead due next week does NOT show up yet');
check(!dueIds.includes(closedOverdueLead.id), 'a WON lead with an overdue follow-up date is excluded — it is already closed');
check(due[0].follow_up_at <= due[due.length - 1].follow_up_at, 'due list is sorted soonest-first');

// ── pipelineSummary — a fresh throwaway root (not the one used above,
// which already has leads mixed across statuses; a clean root makes the
// per-bucket math checkable exactly rather than as deltas against
// whatever the earlier assertions left behind). ──
const summaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-crm-summary-'));
const { execFileSync } = require('child_process');
const summaryScript = `
  process.env.TAPUZ_ROOT = ${JSON.stringify(summaryRoot)};
  const forms = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'forms'))});
  const a = forms.saveSubmission({ page: 'x', fields: { a: '1' } });
  forms.setValue(a.id, 1000);
  forms.setStatus(a.id, 'contacted');
  const b = forms.saveSubmission({ page: 'x', fields: { a: '1' } });
  forms.setValue(b.id, 2000);
  forms.setStatus(b.id, 'qualified');
  const c = forms.saveSubmission({ page: 'x', fields: { a: '1' } });
  forms.setValue(c.id, 500);
  forms.setStatus(c.id, 'won');
  forms.saveSubmission({ page: 'x', fields: { a: '1' } }); // no value set, stays 'new'
  process.stdout.write(JSON.stringify(forms.pipelineSummary()));
`;
// a fresh process, not a require-cache trick — src/paths.js resolves
// TAPUZ_ROOT once at module load, so an in-process reset can silently keep
// writing into the FIRST throwaway root's db file instead of a new one.
// db.js logs "Database initialized successfully." to stdout on its own
// line ahead of our JSON — take the last non-empty line, not the whole output.
const summaryOut = execFileSync(process.execPath, ['-e', summaryScript], { encoding: 'utf8' });
const summaryLines = summaryOut.split('\n').map((l) => l.trim()).filter(Boolean);
const summary = JSON.parse(summaryLines[summaryLines.length - 1]);

check(Object.keys(summary).length === forms.STATUSES.length, 'every STATUSES key exists in the summary, even ones with zero leads');
check(summary.new.count === 1 && summary.new.value === 0, 'the untouched "new" lead (no value set) contributes 0, not null/NaN');
check(summary.contacted.count === 1 && summary.contacted.value === 1000, 'contacted bucket isolated correctly');
check(summary.qualified.count === 1 && summary.qualified.value === 2000, 'qualified bucket isolated correctly');
check(summary.won.count === 1 && summary.won.value === 500, 'won bucket isolated correctly');
check(summary.lost.count === 0 && summary.lost.value === 0, 'an empty bucket reports zero, not undefined/NaN');

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
try { fs.rmSync(summaryRoot, { recursive: true, force: true }); } catch (e) {}

console.log('');
if (failures) {
  console.log('SMOKE CRM-FORECAST: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE CRM-FORECAST: PASS');
