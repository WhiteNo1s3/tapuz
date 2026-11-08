'use strict';

/**
 * lmstudio-probe-shim (v2.45) — makes a llama.cpp / Ollama / vLLM server
 * answer the ONE route the copilot's window probe needs, so the battery can
 * be run against a runtime that is not LM Studio at the SAME tier LM Studio
 * gets.
 *
 * Why: `ai-window.probeLocalWindow` asks `GET /api/v0/models` for the loaded
 * context length. Only LM Studio serves that route; every other runtime is
 * planned on the 24K advisory number and pinned to the compact tier — it can
 * never promote to the full dictionary (the contract's rule). A battery run
 * on llama-server without this shim therefore measures the compact tier, not
 * the 32K rows in docs/LOCAL-LLM.md §5. The shim answers the probe with the
 * window the runtime was really loaded with and forwards every other request
 * byte-for-byte to the runtime. Nothing is cached, rewritten or retried.
 *
 * Harness only — never part of the product, never part of test:smoke.
 *
 *   node scripts/lmstudio-probe-shim.js --upstream=http://127.0.0.1:8080 --port=1234 \
 *        --model=gemma-4-E4B-it-qat-q4_0 --ctx=32768
 *   LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=gemma-4-E4B-it-qat-q4_0 npm run battery:copilot
 */

const http = require('http');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find((a) => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return dflt;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};

const UPSTREAM = new URL(String(flag('upstream', 'http://127.0.0.1:8080')));
const PORT = Number(flag('port', 1234)) || 1234;
const MODEL = String(flag('model', 'local-model'));
const CTX = Number(flag('ctx', 32768)) || 32768;
const MAX_CTX = Number(flag('max-ctx', CTX)) || CTX;
// a whole page can take a slow CPU runtime many minutes — the CMS's own local
// ceiling is 20 min, the battery's 25; the shim must never be the one to cut
const IDLE_MS = 30 * 60 * 1000;

const agent = new http.Agent({ keepAlive: false });

function probeAnswer() {
  return {
    object: 'list',
    data: [{
      id: MODEL,
      object: 'model',
      type: 'llm',
      publisher: 'shim',
      arch: 'unknown',
      compatibility_type: 'gguf',
      quantization: '',
      state: 'loaded',
      max_context_length: MAX_CTX,
      loaded_context_length: CTX
    }]
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://shim');
  if (req.method === 'GET' && url.pathname === '/api/v0/models') {
    const body = JSON.stringify(probeAnswer());
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    return res.end(body);
  }
  const headers = { ...req.headers, host: UPSTREAM.host };
  const up = http.request({
    hostname: UPSTREAM.hostname, port: UPSTREAM.port || 80, path: req.url, method: req.method, headers, agent
  }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  up.setTimeout(IDLE_MS, () => up.destroy(new Error('upstream idle')));
  up.on('error', (e) => {
    if (res.headersSent) return res.destroy();
    const body = JSON.stringify({ error: { message: 'shim: upstream ' + e.message } });
    res.writeHead(502, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  });
  req.pipe(up);
});
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = IDLE_MS;
server.requestTimeout = 0;

server.listen(PORT, '127.0.0.1', () => {
  console.log(`lmstudio-probe-shim: 127.0.0.1:${PORT} → ${UPSTREAM.origin} · model=${MODEL} · loaded_context_length=${CTX}`);
});
