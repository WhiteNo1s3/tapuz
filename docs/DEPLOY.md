# מדריך פריסה לשרת — תפוזיאל

> **עברית קודם, אנגלית אחר כך.** כמו המוצר עצמו.
> אותו יצרן, אותה חברה: **Shaltiel Industries / WhiteNo1se**.

---

## 0. הדבר החשוב ביותר: תפוזיאל הוא **שרת**, לא אתר סטטי

זו הטעות שמפילה את רוב הפריסות הראשונות.

`npm run build` **לא בונה את האפליקציה**. הוא רק מייצא את הדפים ה*מפורסמים*
מתוך SQLite ל-HTML סטטי בתוך `public/`. הוא לא מייצר `dist/`, לא `out/`,
ולא `build/`.

| מה שרצים | מה מקבלים |
|-----------|-----------|
| `node src/server.js` | **המערכת המלאה** — `/admin`, בונה הדפים, CRM, טפסים, WhatsApp, קופיילוט |
| `npm run build` | רק HTML סטטי של הדפים המפורסמים. אין אדמין, אין CRM, אין קליטת טפסים |

לכן: בחרו בספק שמריץ **תהליך Node חי** (VPS, Docker, Render/Railway web service,
systemd) — לא "Static Site".

### המלכודת: `ERROR: No output directory found after build`

אם ראיתם את זה — זה היה באג אמיתי אצלנו, והוא **תוקן**.

`db/*.db` נמצא ב-`.gitignore` (וזה נכון — מסד הנתונים שלכם הוא לא קוד).
לכן שרת שעושה `git clone` מקבל מסד **ריק**. הגרסה הישנה של `exportAll()`
הסיקה מזה ש"כל דף מיוצא הוא דף מת" ומחקה את כל ה-HTML ב-`public/`, כולל
`index.html` — ואז הספק דיווח שאין תיקיית פלט, כי לא נשאר אתר.

היום `exportAll()` **נעצר** כשאין דפים מפורסמים, ומדפיס:

```
[export] no published pages in the database — leaving <dir> untouched ...
```

אם אתם רואים את השורה הזאת בלוג הבנייה, היא לא שגיאה — היא אומרת:
*"המסד ריק, לכן לא נגעתי בקבצים."* הפתרון הוא להריץ את אשף ההתקנה
ב-`/admin`, או להצביע עם `TAPUZ_ROOT` על התיקייה שבה יושב ה-`db/tapuz.db`
עם התוכן שלכם.

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
