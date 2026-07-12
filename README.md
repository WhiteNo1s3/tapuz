# Tapuziel

**תפוזיאל** — CMS פשוט, יפה, ובעברית. (Tapuz + שאלתיאל = התפוז עם הכנפיים)

**גרסה נוכחית: v0.47-alpha** · המפה המלאה: [docs/ROADMAP.md](docs/ROADMAP.md)

- פלט HTML נקי וסמנטי, RTL מלא
- **אשף התקנה מודרך** — מהרעיון לאתר חי בארבעה צעדים (שם → צבעים → דפים → תפריט)
- **בונה דפים ויזואלי** — מודולים (Hero, טקסט, תמונה, גלריה, וידאו, קוביות מאמרים...), גרירה, פיצול לטורים, פאנל מאפיינים בצד
- **מערכת מאמרים** — כל דף שמסומן "דף מאמר" מופיע אוטומטית בקוביות (תמונה + כותרת + תקציר)
- **יוצר ערכת נושא** — צבעים, גופנים, לוגו, מיקום תפריט — עם תצוגה חיה
- טיוטה ≠ פרסום, היסטוריית גרסאות עם שחזור, ספריית מדיה עם תיקיות
- ייבוא מ-WordPress + Elementor, בנייה סטטית
- **ידידותי לסוכני AI** — בלוקים כ-JSON מובנה, CLI מלא, סכמות מתועדות ([docs/block-schemas.md](docs/block-schemas.md))
- **פורמט `.pzn` פתוח** — תקן מתועד ([docs/pzn-spec.md](docs/pzn-spec.md)) + סכמה מכונתית ([docs/pzn-schema.json](docs/pzn-schema.json), גם ב-`GET /pzn-schema.json`). ה-RPM שלנו — כל אחד יכול לממש קורא/כותב
- **גשר AI (BYO)** — הדביקו את התשובה של ה-ChatGPT/Claude שלכם, או תוסף כרום ([extension/](extension/)) — בלי מפתחות

## התחלה מהירה

```bash
node src/server.js            # פתח את הממשק (http://localhost:3000/admin)
                              # התקנה ראשונה? האשף יקבל אתכם אוטומטית

./bin/tapuz.js build          # בנה את האתר הסטטי
./bin/tapuz.js serve          # צפה באתר ב-localhost:8080
```

לבדיקות מקומיות מהירות — במקום האשף אפשר לזרוע חשבון מנהל זמני:

```bash
npm run seed:admin            # יוצר/מאפס כניסה  admin / admin  (מקומי בלבד!)
```

> ⚠️ `admin/admin` היא סיסמת פיתוח חלשה. הסקריפט מסרב לרוץ עם `NODE_ENV=production`,
> נכתב רק ל-`config/auth.json` (מחוץ ל-git), והאפליקציה עצמה לא מכילה שום חשבון ברירת־מחדל.
> החליפו סיסמה לפני כל פריסה אמיתית.

אפשר להריץ מול כל תיקיית אתר עם `TAPUZ_ROOT` (ברירת מחדל: תיקיית החבילה):

```bash
TAPUZ_ROOT=/path/to/my-site node src/server.js
```

## CLI

```bash
./bin/tapuz.js create-page "כותרת" [slug]   # דף חדש
./bin/tapuz.js add-block <slug> <type>      # הוסף מודול לדף
./bin/tapuz.js list-pages / show / preview  # עיון
./bin/tapuz.js set-menu / set-logo          # תפריט ולוגו
./bin/tapuz.js import-wp <export.xml>       # ייבוא מ-WordPress
./bin/tapuz.js build / serve                # בנייה וצפייה
```

## ייבוא מ-WordPress

1. באדמין שלך: Tools → Export → All content
2. הורד את הקובץ

```bash
./bin/tapuz.js import-wp ~/Downloads/your-export.xml
./bin/tapuz.js build
```

## בדיקות

```bash
node scripts/smoke-drafts.js     # טיוטה/פרסום/שחזור
node scripts/smoke-render.js     # פלט HTML סמנטי
node scripts/smoke-sitemap.js    # תפריטים וקישורים
node scripts/smoke-articles.js   # מערכת המאמרים
node scripts/smoke-wizard.js     # אשף ההתקנה (רץ על תיקייה זמנית)
```

## Credits

Built by [WhiteNo1s3](https://github.com/WhiteNo1s3). Released under the MIT License.
