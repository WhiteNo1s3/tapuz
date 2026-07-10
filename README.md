# Tapuziel

**תפוזיאל** — CMS פשוט, יפה, ובעברית. (Tapuz + שאלתיאל = התפוז עם הכנפיים)

- פלט HTML נקי
- עריכה ויזואלית בלי JSON
- תמיכה מלאה ב-RTL
- ייבוא מ-WordPress + Elementor
- בנייה סטטית

## התחלה מהירה

```bash
./bin/tapuz.js build          # בנה את האתר
./bin/tapuz.js serve          # צפה באתר ב-localhost:8080

node src/server.js            # פתח את הממשק (http://localhost:3000/admin)
```

## ייבוא מ-WordPress

1. באדמין שלך: Tools → Export → All content
2. הורד את הקובץ
3. 

```bash
./bin/tapuz.js import-wp ~/Downloads/your-export.xml
./bin/tapuz.js build
```

## עריכה

האדמין בנוי כך שלא תצטרך הסברים:
- לחץ "ערוך"
- הוסף בלוקים עם כפתורים (Hero, טקסט, כפתור, המלצה...)
- שמור


## Credits

Built by [WhiteNo1s3](https://github.com/WhiteNo1s3). Released under the MIT License.

