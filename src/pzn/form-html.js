'use strict';

/**
 * Shared form HTML (v0.58) — one renderer for both paths so the compile output
 * and the published-site output can never diverge:
 *   - src/pzn/modules/registry.js  (form/field compile, from AST nodes)
 *   - src/renderer.js              (case 'form', from block.data)
 *
 * Everything is escaped here; the field `name` is reduced to a safe token (it
 * becomes an HTML attribute AND the submitted key). Zero JS — a plain <form>
 * that posts to the owner's own action URL (their backend / Formspree / a
 * future Tapuz leads endpoint). safeHref blocks javascript: actions.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

const FIELD_TYPES = ['text', 'email', 'tel', 'textarea', 'select', 'checkbox'];

function safeName(v, fallback) {
  const s = String(v || '').replace(/[^\w-]/g, '');
  return s || fallback;
}

function isTruthy(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

/**
 * One form field → HTML.
 * @param {object} props {label,name,type,placeholder,required,options}
 * @param {string} [idAttr] pre-escaped ` id="…"` (or '')
 * @param {string} [clsExtra] pre-escaped extra class (leading space) (or '')
 */
function renderField(props = {}, idAttr = '', clsExtra = '') {
  const p = props;
  const type = FIELD_TYPES.includes(p.type) ? p.type : 'text';
  const name = escapeAttr(safeName(p.name, 'field'));
  const req = isTruthy(p.required) ? ' required' : '';
  const ph = p.placeholder ? ` placeholder="${escapeAttr(p.placeholder)}"` : '';
  const star = isTruthy(p.required) ? ' <span class="bent-field-req">*</span>' : '';
  const labelText = p.label ? escapeHtml(p.label) : '';

  let control;
  if (type === 'textarea') {
    control = `<textarea id="${name}" name="${name}"${ph}${req}></textarea>`;
  } else if (type === 'select') {
    const opts = String(p.options || '')
      .split(',').map((o) => o.trim()).filter(Boolean)
      .map((o) => `<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`)
      .join('');
    control = `<select id="${name}" name="${name}"${req}>${opts}</select>`;
  } else if (type === 'checkbox') {
    control = `<input type="checkbox" id="${name}" name="${name}"${req}>`;
  } else {
    control = `<input type="${type}" id="${name}" name="${name}"${ph}${req}>`;
  }

  const label = labelText ? `<label class="bent-field-label" for="${name}">${labelText}${star}</label>` : '';
  // a checkbox reads better with the label AFTER the box
  const inner = type === 'checkbox' ? `${control}${label}` : `${label}${control}`;
  return `<div${idAttr} class="bent-field bent-field-${type}${clsExtra}">${inner}</div>`;
}

/**
 * The <form> shell around already-rendered field HTML.
 * @param {object} props {action,method,submit}
 * @param {string} fieldsHtml
 * @param {{ idAttr?: string, cls?: string, dir?: string }} [opts] pre-escaped attrs
 */
function renderForm(props = {}, fieldsHtml = '', opts = {}) {
  // empty action = the built-in inbox (v0.81): submissions land in
  // /admin/inbox instead of POSTing into the void of a static page URL
  const action = safeHref(props.action || '/api/form');
  const actionAttr = action && action !== '#' ? ` action="${escapeAttr(action)}"` : '';
  const method = props.method === 'get' ? 'get' : 'post';
  const submit = escapeHtml(props.submit || 'שליחה');
  // honeypot: bots fill every field; humans never see this one. The server
  // pretends success and drops the submission when it arrives non-empty.
  const honeypot = '<input type="text" name="_hp" class="bent-hp" tabindex="-1" autocomplete="off" aria-hidden="true">';
  // opts.extra is the renderer's pre-built style attr (block-attrs.js); the
  // block's class tokens ride opts.cls INSIDE class="", its id opts.idAttr.
  return `<form${opts.idAttr || ''} class="bent-form${opts.cls || ''}"${opts.extra || ''}${actionAttr} method="${method}"${opts.dir || ''}>` +
    honeypot + fieldsHtml +
    `<button type="submit" class="bent-form-submit">${submit}</button></form>`;
}

/** Convenience for the renderer: whole form from block.data (fields array). */
function renderFormFromData(data = {}, dir = '', attrs = {}) {
  const fields = (data.fields || []).map((f) => renderField(f || {})).join('');
  return renderForm(data, fields, blockOpts(dir, attrs));
}

module.exports = { renderField, renderForm, renderFormFromData, safeName, FIELD_TYPES };
