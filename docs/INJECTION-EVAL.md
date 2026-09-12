# Injection eval — the packs against the owner's model

Model endpoint: `http://127.0.0.1:1234/v1` (tapuz-qwen) · 1 runs per pack · run at 2026-09-12T21:27:55.031Z

Every pack the CMS generates is sent through the CMS's own pipeline (`src/ai.js generate()`) and every reply is judged by the REAL admin door. **Landed** = the door accepted the reply; **clean** = accepted with no repair and no warning. The target is 99.9% landed; clean is the quality of the prompt.

| Pack | Runs | Landed | Clean | Repairs | Warnings | Avg s |
|---|---|---|---|---|---|---|
| theme-designer | 1 | 1 (100%) | 0 (0%) | 3 | 0 | 188 |

## What the doors had to do (most frequent first)

- `a stray quote after a tag name removed` × 1
- `<bent-hero> "overlay" → 0` × 1
- `<bent-columns> not allowed here → moved after its container` × 1

## Refusals

- none

Raw replies: `C:\Users\<user>\AppData\Local\Temp\tapuz-eval\replies`
