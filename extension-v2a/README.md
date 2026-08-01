# Tapuziel Bridge V2 (alpha) — גשר למודל מקומי

> **מה זה:** תוסף דפדפן (Chrome / Firefox, MV3) שמחבר את דפי האדמין של
> תפוזיאל אל שרת LLM שרץ על המחשב שלך — LM Studio, Ollama, או כל שרת
> תואם-OpenAI על loopback. המודל לא נחשף לאינטרנט: הדפדפן שלך הוא הגשר.

## מה V2 הוא *לא*

**אין כאן מפתחות API, בכוונה.** V1 גדל BYOK בפופאפ (v0.73) ואז הוסר (v0.85):
מפתחות שייכים ל-CMS — הבעלים מגדיר פעם אחת בשרת, וכל worker משתמש בהם
בלי תפרים. V2 נולד מהלקח הזה ונשאר גשר בלבד. אם רוצים AI בענן — מגדירים
מפתח באתר, לא בתוסף.

## איך זה עובד

```
דף אדמין (האתר המאוחסן)          התוסף                        המחשב שלך
┌──────────────────────┐   postMessage   ┌──────────────┐   fetch   ┌───────────┐
│ קופיילוט / בונה דפים │ ──────────────► │ content      │ ────────► │ LM Studio │
│ "מקומי (דרך הדפדפן)" │ ◄────────────── │  ↕ background│ ◄──────── │ :1234     │
└──────────────────────┘                 └──────────────┘           └───────────┘
```

- הדף שולח `{ path, body }` — **רק** נתיב מרשימה סגורה
  (`/v1/chat/completions`, `/v1/models`). את המארח קובע התוסף, והוא
  loopback בלבד (אותה פילוסופיה כמו `isLoopbackHost` ב-`src/providers.js`).
- שום credential לא עובר בשום כיוון.
- החיבור לאתר הוא opt-in פר-דומיין: כפתור "חבר את האתר הפתוח" בפופאפ מבקש
  הרשאה לאותו origin בלבד ורושם שם את גשר-התוכן.

## פרוטוקול (לצד ה-CMS, שטרם נבנה)

```js
// גילוי: הגשר מכריז עם טעינה, ועונה לפינג
window.postMessage({ source: 'tapuziel-cms', type: 'tz-bridge-ping' }, location.origin);
// ← { source: 'tapuziel-bridge', type: 'tz-bridge-hello', version }

// בקשה
window.postMessage({
  source: 'tapuziel-cms', type: 'tz-local-llm', id: 'req-1',
  path: '/v1/chat/completions',
  body: { model: 'local', messages: [{ role: 'user', content: 'שלום' }] }
}, location.origin);
// ← { source: 'tapuziel-bridge', type: 'tz-local-llm-result', id: 'req-1', ok, status, data|error }
```

## התקנה (אלפא — טעינה ידנית)

- **Chrome:** `chrome://extensions` → Developer mode → Load unpacked → התיקייה הזאת.
- **Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `manifest.json`.
- ב-LM Studio: Developer → Start Server (פורט 1234 הוא ברירת המחדל של התוסף).

## מצב

אלפא. אין סטרימינג עדיין (תשובות חוזרות בבת אחת).

צד ה-CMS **קיים**: בקופיילוט (/admin/chat והמגירה בבונה) יש ספק
"מקומי — דרך הדפדפן (Bridge V2)". השרת מלחין כל קריאת מודל ומחזיר אותה
לדף כהמשך (`modelCall`); הדף מריץ אותה דרך הגשר ומחזיר את הפלט
(`step`); לולאת הכלים, שערי האישור והבריפינג נשארים כולם בשרת
(`src/ai.js` — browser-relay, `public/admin-bridge.js` — צד הדף).
