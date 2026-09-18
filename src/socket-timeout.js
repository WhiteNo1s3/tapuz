'use strict';

/**
 * server.js caps idle sockets at 30 s (S4, slow-loris) — and a model
 * legitimately says nothing for minutes. A route that waits on a model lifts
 * the cap for ITS socket and puts it back when the response is out;
 * headersTimeout / requestTimeout still guard the intake, and every such
 * route sits behind the admin gate.
 *
 * Born in routes/inject.js (v2.28, the runner). v2.44 moved it here because
 * the copilot's chat route needed it just as much and never had it: on a
 * server-side courier (מודל מקומי, a cloud key) any turn the model took more
 * than 30 s over lost its connection — the owner saw a network error, the
 * turn ran on without them, and its proposal waited in a queue nobody could
 * reach. Found by the copilot battery (2026-09-18, Gemma 4 31B): a page takes
 * 27–35 s to write, so the same scenario passed and failed on the same day.
 */
function liftSocketTimeout(req, res, ms) {
  const sock = req.socket;
  if (!sock || typeof sock.setTimeout !== 'function') return;
  const prev = Number(sock.timeout) > 0 ? Number(sock.timeout) : 0;
  try { sock.setTimeout(Math.max(prev, ms)); } catch (e) { return; }
  res.on('finish', () => { try { if (prev) sock.setTimeout(prev); } catch (e) { /* socket gone */ } });
}

module.exports = { liftSocketTimeout };
