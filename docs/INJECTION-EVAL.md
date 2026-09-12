# Injection eval — the packs against the owner's model

Model endpoint: `http://127.0.0.1:1234/v1` (tapuz-qwen) · 1 runs per pack · run at 2026-09-12T21:21:10.604Z

Every pack the CMS generates is sent through the CMS's own pipeline (`src/ai.js generate()`) and every reply is judged by the REAL admin door. **Landed** = the door accepted the reply; **clean** = accepted with no repair and no warning. The target is 99.9% landed; clean is the quality of the prompt.

| Pack | Runs | Landed | Clean | Repairs | Warnings | Avg s |
|---|---|---|---|---|---|---|
| theme-designer | 1 | 0 (0%) | 0 (0%) | 0 | 0 | 308 |

## What the doors had to do (most frequent first)

- nothing — every reply was clean

## Refusals

- theme-designer #1: MODEL: לא הצלחתי להתחבר למודל המקומי ב-http://127.0.0.1:1234/v1/chat/completions — ודאו ש-LM Studio (או Ollama) רץ ושהשרת המקומי דולק. פרטים: fetch failed

Raw replies: `C:\Users\<user>\AppData\Local\Temp\tapuz-eval\replies`
