# מדריך פריסה לשרת — תפוזיאל

> **עברית קודם, אנגלית אחר כך.** כמו המוצר עצמו.
> אותו יצרן, אותה חברה: **Shaltiel Industries / WhiteNo1se**.

---

## 0. הדבר החשוב ביותר: תפוזיאל הוא **שרת**, לא אתר סטטי

זו הטעות שמפילה את רוב הפריסות הראשונות.

**לתפוזיאל אין שלב בנייה בכלל.** `npm run build` קיים רק כרשת ביטחון: הוא
no-op שמדפיס הסבר, יוצר `‎.next/‎` פיתיון (כדי שצינור שהוגדר בטעות כ-Next.js
יעבור את בדיקת תיקיית הפלט וימשיך לפקודת ההרצה `npm start`), ומצליח מיד.
`npm run export:static` הוא **ייצוא תוכן**: הוא לוקח את הדפים
ה*מפורסמים* מ-SQLite וכותב HTML לתוך `public/` הקיים. הוא לא מייצר `dist/`,
לא `out/`, ולא `build/`, ואין שום צורך להריץ אותו בפריסה — השרת מרנדר דפים
בעצמו.

| מה שרצים | מה מקבלים |
|-----------|-----------|
| `node src/server.js` | **המערכת המלאה** — `/admin`, בונה הדפים, CRM, טפסים, WhatsApp, קופיילוט |
| `npm run export:static` | רק HTML סטטי של הדפים המפורסמים. אין אדמין, אין CRM, אין קליטת טפסים |

לכן: בחרו בספק שמריץ **תהליך Node חי** (VPS, Docker, Render/Railway web service,
systemd) — לא "Static Site".

### המלכודת: `ERROR: No output directory found after build`

לשגיאה הזאת **שתי סיבות שונות לגמרי**. שתיהן נראות אותו דבר בלוג.

#### סיבה 1 — הבאג שלנו (תוקן)

`db/*.db` נמצא ב-`.gitignore` (וזה נכון — מסד הנתונים שלכם הוא לא קוד).
לכן שרת שעושה `git clone` מקבל מסד **ריק**. הגרסה הישנה של `exportAll()`
הסיקה מזה ש"כל דף מיוצא הוא דף מת" ומחקה את כל ה-HTML ב-`public/`, כולל
`index.html` — ואז הספק דיווח שאין תיקיית פלט, כי לא נשאר אתר.

היום `exportAll()` **נעצר** כשאין דפים מפורסמים, ומדפיס:

```
[export] no published pages in the database — leaving <dir> untouched ...
```

אם אתם רואים את השורה הזאת בלוג הבנייה, היא לא שגיאה — היא אומרת:
*"המסד ריק, לכן לא נגעתי בקבצים."*

#### סיבה 2 — הספק חושב שאנחנו אתר סטטי (זו הנפוצה)

וזו הסיבה שהשגיאה עשויה להופיע **גם אחרי התיקון של סיבה 1**.

פלטפורמות עם זיהוי אוטומטי (Hostinger "Deploy Web App", Netlify, Vercel,
Cloudflare Pages) קוראות את `package.json` ומחפשות סקריפט בשם `build`. אם
הוא קיים הן מסיקות *"פרויקט עם שלב בנייה → יש תיקיית פלט"*, מריצות אותו,
ואז מחפשות `dist/` · `build/` · `out/` — שתפוזיאל לעולם לא מייצר.

**לכן הסקריפט נקרא `export:static` ולא `build`.** השם הישן היה הזמנה לזיהוי
שגוי: הוא תיאר "בנייה" בזמן שמדובר בייצוא תוכן. בלי סקריפט `build` בעץ,
הזיהוי האוטומטי לא מציע שלב בנייה מלכתחילה, והמלכודת נסגרת בשורש.

אם הפריסה שלכם **כבר** מוגדרת עם פקודת בנייה ותיקיית פלט (הגדרה שנשמרה
מניסיון קודם), הן לא ייעלמו לבד — צריך למחוק את שני השדות ידנית ולהצביע על
נקודת הכניסה `src/server.js`. ראו §3א.

---

## 1. דרישות

| רכיב | גרסה |
|------|------|
| **Node.js** | **24 LTS ("Krypton") ומעלה** |
| מקום בדיסק | דיסק **קבוע** (persistent) ל-`db/`, `config/`, `public/`, העלאות |

Node 18 ו-20 הגיעו ל-**סוף חיים** ואינם נתמכים. Node 26 הוא `Current`
ועוד לא LTS — לשרת פרודקשן אנחנו נשארים על 24.

התלויות `better-sqlite3` ו-`sharp` הן נייטיב. יש להן קבצים מוכנים מראש
ל-linux/amd64 ול-linux/arm64; פלטפורמה אחרת תקמפל, ולכן ה-Dockerfile מחזיק
שלב בנייה נפרד עם `python3 make g++`.

---

## 2. הדרך המהירה — Docker Compose

```bash
git clone https://github.com/WhiteNo1s3/tapuz.git && cd tapuz
export TAPUZ_ADMIN_SECRET=$(openssl rand -hex 32)   # שמרו את זה
docker compose up -d --build
```

היכנסו ל-`http://localhost:3000/admin` — אשף ההתקנה יקבל אתכם.

הנתונים יושבים על ה-volume בשם `tapuz-data`, **לא בתוך ה-image**. אפשר לבנות
מחדש ולפרוס שוב כמה שרוצים בלי לאבד תוכן.

---

## 3א. Hostinger — hPanel Node.js (Deploy Web App)

hPanel מזהה את הפריימוורק **מתוך `package.json`**, מציע פקודת בנייה ותיקיית
פלט, ואז נכשל כי לתפוזיאל אין כזו. זה בדיוק מקור `No output directory found
after build` (סיבה 2 למעלה). ההגדרות הנכונות:

| שדה ב-hPanel | ערך |
|---------------|-----|
| Framework | **Express.js** (או **Other**) — לא פריימוורק סטטי |
| Build command | **ריק. למחוק לגמרי** |
| Output / publish directory | **ריק. למחוק לגמרי** |
| Install command | `npm ci --omit=dev` |
| Entry point / startup file | `src/server.js` |
| Start command | `npm start` |
| Node version | **24** (הגבוה ביותר שמוצע; המינימום שלנו) |

משתני סביבה (Environment Variables ב-hPanel):

```
NODE_ENV=production
TAPUZ_ROOT=/home/<user>/tapuz-data
TAPUZ_ADMIN_SECRET=<openssl rand -hex 32>
TAPUZ_TRUST_PROXY=1
```

את `PORT` **לא** מגדירים — הפלטפורמה מזריקה אותו, ו-`src/server.js` קורא
`process.env.PORT`.

### שלוש מלכודות ספציפיות ל-hPanel

1. **`TAPUZ_ROOT` חייב לשבת מחוץ לתיקיית ה-git.** hPanel מושך מחדש בכל
   push ומריץ התקנה. אם הנתונים יושבים בתוך ה-clone, פריסה אחת יכולה למחוק
   את `db/tapuz.db` ואת כל התמונות שהעליתם. תיקייה אחות (`~/tapuz-data`) —
   לא `~/app/db`.
2. **תלויות נייטיב.** `better-sqlite3` ו-`sharp` מורידות בינארי מוכן מראש
   שתואם לגרסת ה-Node. אם הבנייה נופלת עם `node-gyp` — כמעט תמיד זו גרסת
   Node שאין לה prebuild. החליפו לגרסה יציבה (24) והריצו התקנה מחדש.
3. **`GET /` יחזיר 404 עד שהאשף ירוץ.** זה תקין. תמיד בודקים דרך
   `/admin`, לא דרך השורש — אחרת נראה כאילו הפריסה נכשלה כשהיא דווקא הצליחה.

לוגים: **Deployments → הפריסה שנכשלה → החץ → Build logs.** שם רואים מה
באמת רץ, ולא מה שחשבנו שרץ.

### 3ב. Hostinger — פריסת ארכיון (API / MCP), בלי git

**הוכח חי ב-2026-07-31** (<live-site>). לצד
זרימת ה-git של hPanel יש ל-Hostinger מסלול פריסה מארכיון —
`POST .../nodejs/builds/archive` (או כלי ה-MCP `hosting_deployJsApplication`)
— שמזהה נכון מ-`package.json`: ‏`app_type: express`,‏ entry ‏`src/server.js`.
בניגוד לזרימת ה-git, כאן אין הגדרה ישנה ששורדת מניסיון קודם.

הארכיון: **קבצים עוקבים בלבד, בלי מצב האתר.** המאגר עוקב אחרי אתר פיתוח
(`config/`, `pages/`, `content/`, `db/`) בתור fixtures; אם הם נשלחים, השרת
יורש `setupDone: true` — האשף לא יופיע לבעלים החדש — וגם טוקני agent של
פיתוח דולפים. לכן:

```bash
git ls-files -z | grep -zEv '^(config|pages|content|db)/' > /tmp/filelist.nul
tar --null -czf /tmp/tapuziel-deploy.tgz -T /tmp/filelist.nul   # ‎~2.3MB, תקרה 50MB
```

שתי נקודות שנשארות נכונות גם כאן:

1. **`TAPUZ_ROOT` מחוץ לעץ הפריסה** (משתני סביבה ב-hPanel) — פריסה חוזרת
   מחליפה את עץ המקור, ובלעדיו `db/` והעלאות נמחקים איתו.
2. פריסה ראשונה נבדקת דרך `/admin` (יפנה ל-create-account), לא דרך `/`.

### ⚠️ המלכודת הקטלנית: אינטגרציית git ישנה עם auto-deploy

אם האתר חובר פעם ל-GitHub דרך hPanel (זרימת ה-git שנכשלה), החיבור הזה
**נשאר חי גם אחרי שעברתם לפריסת ארכיון** — וכל `git push` מפעיל מחדש את
הצינור השבור (app_type ‏next, ‏git) שדורס את שרת ה-Express הרץ. הסימפטום:
הפריסה עובדת, ואז "נעלמת" דקות אחרי push — ‏`/admin` מחזיר 503 והשורש
מגיש את הפיתיון. ההיסטוריה ב-hosting_listJsDeployments מסגירה את זה:
פריסות `source_type: git` שאף אחד לא הריץ, בדקות שאחרי כל push.

**התיקון (חד-פעמי, ב-hPanel בלבד — אין לזה API):** Websites → האתר →
Deployments / Git → נתקו את הריפו (או כבו auto-deploy). עד אז — כל push
שובר את פרודקשן, ופריסת הארכיון היא רק החייאה זמנית.

בונוס מהצינור השבור: פריסות ה-git ממזגות שאריות לעץ (index.html ישן,
`config/site.json` עם `setupDone: true` מה-clone) במקום להחליף אותו —
עוד סיבה ל-`TAPUZ_ROOT` חיצוני, שמנטרל את כל השאריות האלה בבת אחת.

---

## 3. VPS רגיל + systemd

```bash
sudo adduser --system --group --home /opt/tapuz tapuz
sudo -u tapuz git clone https://github.com/WhiteNo1s3/tapuz.git /opt/tapuz/app
cd /opt/tapuz/app
sudo -u tapuz npm ci --omit=dev
sudo -u tapuz mkdir -p /opt/tapuz/data
```

`/etc/systemd/system/tapuz.service`:

```ini
[Unit]
Description=Tapuziel CMS
After=network.target

[Service]
Type=simple
User=tapuz
Group=tapuz
WorkingDirectory=/opt/tapuz/app
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=TAPUZ_ROOT=/opt/tapuz/data
Environment=TAPUZ_TRUST_PROXY=1
EnvironmentFile=/opt/tapuz/tapuz.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5

# הקשחה — התהליך כותב רק לתיקיית הנתונים שלו
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/tapuz/data

[Install]
WantedBy=multi-user.target
```

`/opt/tapuz/tapuz.env` (הרשאות `600`, בבעלות `tapuz`):

```
TAPUZ_ADMIN_SECRET=<openssl rand -hex 32>
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now tapuz
sudo journalctl -u tapuz -f
```

---

## 4. פרוקסי הפוך ו-TLS

תפוזיאל מאזין ב-HTTP בלבד. את ה-TLS מסיים הפרוקסי.

**Caddy** (הכי קצר — תעודה אוטומטית):

```
tapuz.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**nginx**:

```nginx
server {
    listen 443 ssl http2;
    server_name tapuz.example.com;

    client_max_body_size 12m;   # תואם לתקרת ההעלאות של האדמין

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # חובה — ראו למטה
    }
}
```

שתי נקודות שחייבות להתלכד:

1. **`X-Forwarded-Proto`** — לפיו `src/auth.js` מחליט שהחיבור מאובטח ומסמן את
   עוגיית הסשן כ-`Secure`. בלעדיו ההתחברות תתנהג כאילו היא על HTTP.
2. **`TAPUZ_TRUST_PROXY=1`** — רק *אחרי* שיש פרוקסי אמיתי. הדגל הזה גורם
   לאפליקציה להאמין ל-`X-Forwarded-For`; אם השרת חשוף ישירות לאינטרנט,
   לקוח יוכל לזייף את הכותרת ולעקוף הגבלות קצב ונעילות לפי IP.
   `src/http-util.js` לוקח בכוונה את ה-hop **הימני ביותר** מהשרשרת.

---

## 5. משתני סביבה

| משתנה | ברירת מחדל | למה |
|--------|-------------|-----|
| `PORT` | `3000` | פורט ההאזנה |
| `TAPUZ_ROOT` | תיקיית החבילה | **הדיסק הקבוע** — `db/`, `config/`, `public/`, העלאות |
| `NODE_ENV` | — | `production` בפרודקשן: מונע דליפת stack traces בשגיאות |
| `TAPUZ_ADMIN_SECRET` | נוצר לקובץ | מפתח חתימת הסשנים. בסביבה עם יותר מ-instance אחד — חובה, ומשותף |
| `TAPUZ_ADMIN_PATH` | `/admin` | מזיז את האדמין לנתיב פחות ניחוש (`/studio`) |
| `TAPUZ_TRUST_PROXY` | `0` | `1` **רק** מאחורי פרוקסי הפוך שבשליטתכם |
| `TAPUZ_FORM_MAX` | `10` | תקרת שליחות טופס לחלון (`src/routes/form-capture.js`) |
| `TAPUZ_TRACK_MAX` | `120` | תקרת אירועי פיקסל (`src/routes/crm-track.js`) |
| `TAPUZ_COLLECT_MAX` | `120` | תקרת איסוף (`src/server.js`) |
| `TAPUZ_CS_MAX` | `12` | תקרת הודעות צ׳אט (`src/routes/crm-track.js`) |
| `TAPUZ_WA_HOOK_MAX` | `300` | תקרת webhook של WhatsApp (`src/routes/wa-webhook.js`) |

סודות (SMTP, WhatsApp, מפתחות AI, סיסמאות אדמין) **לא** נכנסים ל-git — הם
נכתבים ל-`config/*.json` תחת `TAPUZ_ROOT`, וכולם כבר ב-`.gitignore`.

---

## 6. גיבוי

הכול יושב תחת `TAPUZ_ROOT`. גיבוי = להעתיק את התיקייה.

המסד עובד ב-WAL, ולכן **אין להעתיק את `tapuz.db` בזמן ריצה** — תקבלו קובץ
קרוע. תפוזיאל כבר לוקח snapshot יומי עם `VACUUM INTO` (מדף של 7, ראו
`src/db.js` · `backupIfStale`). לגיבוי חיצוני:

```bash
sqlite3 /opt/tapuz/data/db/tapuz.db ".backup '/backup/tapuz-$(date +%F).db'"
tar czf /backup/tapuz-config-$(date +%F).tgz -C /opt/tapuz/data config public
```

---

## 7. שדרוג

```bash
cd /opt/tapuz/app
sudo -u tapuz git pull
sudo -u tapuz npm ci --omit=dev
sudo systemctl restart tapuz
```

מיגרציות הסכימה רצות מעצמן בעלייה (`initialize()` ב-`src/db.js`, הכול
`CREATE TABLE IF NOT EXISTS` / הוספת עמודות) — אין צעד ידני.

ב-Docker: `docker compose up -d --build`. ה-volume שורד.

---

## 8. בדיקה שהכול עלה

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://tapuz.example.com/admin
# 302 → השרת חי, טרם הוגדר מנהל (או שאתם לא מחוברים). זה תקין.

curl -sS https://tapuz.example.com/pzn-schema.json | head -c 120
# הסכמה הציבורית — מוכיחה שהאפליקציה עצמה עונה, לא רק הפרוקסי
```

`GET /` יחזיר **404** עד שאשף ההתקנה יפרסם דף בית. זה תקין בהתקנה טרייה —
ולכן גם ה-`HEALTHCHECK` ב-Dockerfile בודק את `/admin` ולא את `/`.
