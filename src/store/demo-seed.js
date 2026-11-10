'use strict';

/**
 * The demo shop, applied only when a caller has already decided this is a
 * new empty root AND set TAPUZ_DEMO_STORE=1 (scripts/seed-demo-store.js does
 * both, and only after --apply). Importing the module does nothing. Boot
 * does not import it. A pin does not set the flag.
 *
 * Copy and pictures are original. Nothing here is a third-party mark.
 * payments.json is not written — sandbox keys stay the owner's.
 */

const fs = require('fs');
const path = require('path');
const { ASSETS_DIR } = require('../paths');

const CATALOG = `
<bent-store version="1" name="חנות הדברים שאינם" currency="ILS">
  <bent-store-rules vat="18" vat-included="true" thanks="תודה. זו הדגמה: אם אישרתם בארגז החול, לא עבר כסף." />
  <bent-shelf id="small" label="דברים קטנים" />
  <bent-shelf id="huge" label="דברים גדולים מדי" />
  <bent-shelf id="quiet" label="שקט" />
  <bent-sku id="left-sock" title="גרב שמאלית יחידה, חגיגית" price="0.13" was="40" stock="40"
            shelf="small" image="/assets/demo-left-sock.svg" badge="כמעט חינם" summary="שמאל בלבד. הימנית יצאה לטיול.">
    גרב אחת, רקומה בחוט שלא קיים, לאירועים שבהם מספיק רגל אחת.

    מגיעה בקופסה גדולה מהגרב.
  </bent-sku>
  <bent-sku id="named-cloud" title="עננה עם שם פרטי" price="1000001" stock="2"
            shelf="huge" image="/assets/demo-named-cloud.svg" badge="מוגזם" summary="השם נבחר אחרי התשלום, בארגז החול.">
    עננה קטנה שמרחפת מעל השולחן ומסרבת להוריד גשם בתוך הבית.

    המחיר עגול בכוונה, ועוד שקל, כדי שאי אפשר יהיה להתעלם ממנו.
  </bent-sku>
  <bent-sku id="mountain-air" title="שקית אוויר הררית, ריקה" price="4.20" stock="80"
            shelf="small" image="/assets/demo-mountain-air.svg" summary="נארזה בפסגה. נפתחה בדרך למטה.">
    שקית נייר ובה הרוח שהייתה אמורה להישאר בהר.

    אם שומעים משהו כשפותחים — זו הייתה משלוח של מישהו אחר.
  </bent-sku>
  <bent-sku id="pet-stone" title="אבן מחמד מאולפת למחצה" price="42000" stock="6"
            shelf="huge" image="/assets/demo-pet-stone.svg" badge="רגועה" summary="יושבת. זה כל התרגיל.">
    אבן חלקה שלמדה לשבת בלי לזוז, ומתמידה בזה כבר כמה עידנים.

    אוכל לא כלול, כי היא לא אוכלת.
  </bent-sku>
  <bent-sku id="bottled-quiet" title="דממה בבקבוק, 500 מ״ל" price="777777.77" stock="3"
            shelf="quiet" image="/assets/demo-bottled-quiet.svg" badge="שקט" summary="לנער בעדינות. לא לשמוע כלום.">
    חצי ליטר של שקט שנאסף בחדר אחרי שכולם יצאו.

    הפקק נשאר סגור. זה כל המוצר.
  </bent-sku>
  <bent-sku id="blank-card" title="כרטיס ביקור לבן משני הצדדים" price="0.50" stock="500"
            shelf="small" image="/assets/demo-blank-card.svg" summary="השם שלכם לא מופיע, וגם לא שלנו.">
    כרטיס עבה, נקי, בלי אות. מתאים למי שכבר אמרו הכול.

    אין לוגו, אין טלפון, אין כתובת אתר.
  </bent-sku>
  <bent-sku id="chair-manual" title="הוראות הרכבה לכיסא שכבר הורכב" price="999.99" was="1000000" stock="1"
            shelf="quiet" image="/assets/demo-chair-manual.svg" badge="מאוחר" summary="שלב 1: לשבת. אין שלב 2.">
    חוברת מסודרת לכיסא שעומד בחדר ומחכה שלא יפרקו אותו בטעות.

    הציורים מקדימים את הברגים.
  </bent-sku>
  <bent-sku id="nowhere-map" title="מפה אל מקום שלא קיים" price="15" stock="0"
            shelf="quiet" image="/assets/demo-nowhere-map.svg" badge="אזל" summary="הקו מקווקו כי היעד לא הסכים.">
    מפה מצוירת ביד אל נקודה שהקרטוגרף מחק ברגע האחרון.

    אזלה, וזה מתאים לה: אי אפשר להגיע גם כשהיא במלאי.
  </bent-sku>
  <bent-ship id="pickup" label="איסוף מהמחסן הדמיוני" price="0" address="false" note="המחסן נמצא מאחורי הדלת שכבר פתחתם." />
  <bent-ship id="thought" label="משלוח על גבי מחשבה" price="250" free-over="500000" note="יוצא לדרך כשחושבים עליו חזק. כתובת כן נדרשת, בשביל הנימוס." />
  <bent-pay id="paypal" kind="paypal" label="PayPal — ארגז חול">כפתור הבדיקה של PayPal. לא נגבה שקל אמיתי.</bent-pay>
  <bent-coupon code="HALFJOKE" percent="50" min="1" note="חצי הנחה על בדיחה שלמה" />
</bent-store>
`.trim();

function svg(body, bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180" role="img">
  <rect width="240" height="180" rx="28" fill="${bg}"/>
  ${body}
</svg>
`;
}

const ARTS = {
  'demo-left-sock.svg': svg('<path d="M78 36h46v62h-18l-10 46H74l-8-46H56V36h22z" fill="#6d28d9"/><circle cx="168" cy="58" r="22" fill="#e8b84a"/>', '#f4e9ff'),
  'demo-named-cloud.svg': svg('<ellipse cx="120" cy="100" rx="70" ry="28" fill="#fff"/><ellipse cx="92" cy="86" rx="28" ry="22" fill="#fff"/><ellipse cx="140" cy="80" rx="36" ry="26" fill="#fff"/><circle cx="120" cy="52" r="8" fill="#e8b84a"/>', '#6d28d9'),
  'demo-mountain-air.svg': svg('<path d="M24 150 L90 48 L130 110 L168 70 L220 150 Z" fill="#1c1430"/><circle cx="188" cy="40" r="16" fill="#e8b84a"/>', '#fff8ee'),
  'demo-pet-stone.svg': svg('<ellipse cx="120" cy="108" rx="54" ry="36" fill="#6b6280"/><ellipse cx="100" cy="96" rx="16" ry="10" fill="#eadfce"/><circle cx="92" cy="92" r="3" fill="#1c1430"/><circle cx="108" cy="92" r="3" fill="#1c1430"/>', '#f4e9ff'),
  'demo-bottled-quiet.svg': svg('<path d="M104 28h32v18h-8l-6 18v78a22 22 0 0 1-44 0V64l-6-18h-8V28h40z" fill="#1c1430" fill-opacity="0.85"/><rect x="108" y="20" width="24" height="12" rx="3" fill="#e8b84a"/>', '#fff8ee'),
  'demo-blank-card.svg': svg('<rect x="48" y="40" width="144" height="100" rx="12" fill="#fff" stroke="#6d28d9" stroke-width="3"/><rect x="64" y="58" width="40" height="6" rx="3" fill="#eadfce"/>', '#f4e9ff'),
  'demo-chair-manual.svg': svg('<path d="M70 40h70v14H70zM78 54h8v70h-8zM124 54h8v70h-8zM62 124h86v10H62z" fill="#6d28d9"/><rect x="150" y="36" width="40" height="56" rx="4" fill="#fff" stroke="#e8b84a" stroke-width="3"/>', '#fff8ee'),
  'demo-nowhere-map.svg': svg('<path d="M40 130 C80 40, 160 40, 200 120" fill="none" stroke="#6d28d9" stroke-width="4" stroke-dasharray="8 8"/><circle cx="200" cy="120" r="8" fill="none" stroke="#e8b84a" stroke-width="3"/>', '#fff8ee')
};

function writeArt() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  for (const [name, body] of Object.entries(ARTS)) {
    fs.writeFileSync(path.join(ASSETS_DIR, name), body, 'utf8');
  }
}

/**
 * Apply the demo. Caller must have proved the root is empty; this checks
 * again and writes nothing when the proof is missing.
 * @returns {{ ok: boolean, code?: string, message?: string, products?: number, homepage?: string }}
 */
function applyDemo() {
  if (process.env.TAPUZ_DEMO_STORE !== '1') {
    return { ok: false, code: 'NOT_EXPLICIT', message: 'הדגמת החנות רצה רק עם TAPUZ_DEMO_STORE=1, ורק על שורש ריק' };
  }
  const probe = require('../seed-content').inspectRoot();
  if (!probe.empty || !probe.confident) {
    return { ok: false, code: 'NOT_EMPTY', message: probe.reason };
  }

  writeArt();
  const theme = require('../theme');
  theme.saveThemeSettings({
    siteTitle: 'חנות הדברים שאינם',
    description: 'חנות הדגמה של תפוזיאל. המחירים מומצאים. התשלום הוא ארגז חול של PayPal — לא כסף אמיתי.',
    logo: { type: 'text', text: 'חנות הדברים שאינם' },
    overrides: {
      colors: {
        primary: '#6d28d9',
        secondary: '#e8b84a',
        text: '#1c1430',
        muted: '#6b6280',
        border: '#eadfce',
        bg: '#fff8ee',
        lightBg: '#f4e9ff',
        surface: '#fffdf8'
      },
      style: { radius: 'round', shadow: 'soft', accent: 'gradient', buttons: 'filled' },
      layout: { maxWidth: '1100px' },
      fonts: { baseSize: '18px', google: [] }
    }
  });

  const store = require('./index');
  const applied = store.document.applyDocument(CATALOG);
  if (!applied.ok) {
    return { ok: false, code: applied.code || 'APPLY', message: applied.message || 'הקטלוג לא נקלט' };
  }
  store.flip(true);

  const pages = require('../pages');
  const shop = pages.getPageByFullPath('shop');
  if (!shop) return { ok: false, code: 'NO_SHOP', message: 'דף החנות לא נוצר' };
  pages.savePageSource('shop', [
    '<bent-heading level="1" align="center">חנות הדברים שאינם</bent-heading>',
    '<bent-text align="center">חנות הדגמה של תפוזיאל. המחירים מומצאים בכוונה, והתשלום הוא ארגז חול של PayPal — לא כסף אמיתי.</bent-text>',
    '<bent-shop filter="true" columns="3"></bent-shop>'
  ].join('\n'), { publish: true });

  const { loadConfig, saveConfig } = require('../config');
  const cfg = loadConfig();
  cfg.homepage = 'shop';
  cfg.language = cfg.language || 'he';
  saveConfig(cfg);
  require('../export').exportAll();

  return { ok: true, products: store.catalog.countProducts().total, homepage: 'shop' };
}

module.exports = { applyDemo, CATALOG };
