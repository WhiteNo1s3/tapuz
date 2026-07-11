'use strict';

/**
 * Builds the paste-into-blank-chat snippet (public/chat-snippet.txt).
 * Fast file write only — no servers.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'docs', 'chat-snippet.md');
const outTxt = path.join(__dirname, '..', 'public', 'chat-snippet.txt');
const outJson = path.join(__dirname, '..', 'public', 'chat-snippet.json');

const full = fs.readFileSync(src, 'utf8');
// Everything after the first horizontal rule is the paste body
const parts = full.split(/^---\s*$/m);
const pasteBody = (parts.length >= 2 ? parts.slice(1).join('\n---\n') : full).trim() + '\n';

fs.writeFileSync(outTxt, pasteBody, 'utf8');
fs.writeFileSync(
  outJson,
  JSON.stringify(
    {
      version: '0.1',
      purpose: 'Paste into any blank chat (ChatGPT, Grok, Gemini, DeepSeek, …)',
      notApi: true,
      pasteBody,
      noticeHe:
        'פתחו צ׳אט חדש ריק בבוט המועדף עליכם, הדביקו את הטקסט, ואז תארו את העמוד. את הפלט (BenTML) מדביקים בבונה הדף.',
      mediaPlaceholders: {
        image: '/uploads/PLACEHOLDER-….jpg',
        video: 'https://www.youtube.com/watch?v=PLACEHOLDER'
      }
    },
    null,
    2
  ) + '\n',
  'utf8'
);

console.log('Wrote', outTxt, '(' + pasteBody.length + ' chars)');
console.log('Wrote', outJson);
