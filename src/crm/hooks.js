'use strict';

/**
 * CRM extension hooks (v2.12) — enterprise expand, not a closed script.
 *
 * Verticals (restaurants, booking, …) and future packages subscribe here
 * without forking contacts/portal/admin. In-process only: same Node process,
 * same owner site. Listeners NEVER throw into the emitter (swallowed + log).
 *
 * Core emits (stable names — add, don't rename):
 *   contact.created | contact.updated | contact.erased
 *   portal.login | portal.register | portal.logout
 *   event.recorded | attrs.set | attrs.removed
 *   lifecycle.cards
 *
 * Usage:
 *   const hooks = require('./hooks');
 *   hooks.on('portal.login', ({ contactId, username }) => { … });
 *   // from a vertical package later — same bus, no CRM core edits
 */

const listeners = new Map(); // event → Set<fn>
const onceListeners = new Map();

function _set(map, event, fn) {
  const name = String(event || '').trim();
  if (!name || typeof fn !== 'function') return () => {};
  if (!map.has(name)) map.set(name, new Set());
  map.get(name).add(fn);
  return () => {
    const s = map.get(name);
    if (s) s.delete(fn);
  };
}

/** Subscribe. Returns unsubscribe(). */
function on(event, fn) {
  return _set(listeners, event, fn);
}

/** One-shot subscribe. */
function once(event, fn) {
  return _set(onceListeners, event, fn);
}

function off(event, fn) {
  const name = String(event || '').trim();
  const a = listeners.get(name);
  if (a) a.delete(fn);
  const b = onceListeners.get(name);
  if (b) b.delete(fn);
}

/**
 * Emit to all listeners. Order: permanent then once (once cleared after).
 * Always returns { ok, n, errors } — never throws.
 */
function emit(event, payload) {
  const name = String(event || '').trim();
  const out = { ok: true, n: 0, errors: [] };
  if (!name) return out;

  const run = (fn) => {
    try {
      fn(payload, name);
      out.n++;
    } catch (e) {
      out.ok = false;
      out.errors.push(String((e && e.message) || e));
      console.error('[crm.hooks] ' + name + ' listener failed:', (e && e.message) || e);
    }
  };

  const perms = listeners.get(name);
  if (perms) {
    for (const fn of Array.from(perms)) run(fn);
  }
  const onceSet = onceListeners.get(name);
  if (onceSet && onceSet.size) {
    const batch = Array.from(onceSet);
    onceSet.clear();
    for (const fn of batch) run(fn);
  }
  return out;
}

/** Introspection — admin/agent/docs. */
function listEvents() {
  const names = new Set([
    ...listeners.keys(),
    ...onceListeners.keys(),
    // documented core vocabulary even with zero subscribers
    'contact.created',
    'contact.updated',
    'contact.erased',
    'portal.login',
    'portal.register',
    'portal.logout',
    'event.recorded',
    'attrs.set',
    'attrs.removed',
    'lifecycle.cards'
  ]);
  return Array.from(names).sort();
}

function listenerCount(event) {
  const name = String(event || '').trim();
  return (listeners.get(name) || new Set()).size + (onceListeners.get(name) || new Set()).size;
}

/** Test helper — wipe all subscriptions. */
function _resetForTests() {
  listeners.clear();
  onceListeners.clear();
}

module.exports = {
  on,
  once,
  off,
  emit,
  listEvents,
  listenerCount,
  _resetForTests
};
