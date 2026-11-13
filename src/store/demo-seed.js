'use strict';

/**
 * The demo shop (חנות הדברים שאינם) — a live fake shop.
 *
 * Two callers, one catalog:
 *   - scripts/seed-demo-store.js --apply, for a machine with a shell
 *   - maybeDemoStore() on boot, only when TAPUZ_DEMO_STORE=1
 *
 * A .tapuz-root pin chooses WHERE the data root is (the same way every boot
 * finds it). It does not arm this seed. TAPUZ_DEMO_STORE=1 is the only arm.
 * payments.json is never written — sandbox keys stay the owner's.
 *
 * The demo has a VERSION (v2.69: version 2), kept in config/seeded.json as
 * two markers: "demo-store" (it is a demo) and "demo-store-v2" (it has been
 * through the step to version 2). What a boot with the flag does:
 *
 *   an empty root            → version 2 is seeded, both markers
 *   a version 1 demo         → upgradeDemo(): each part moves to version 2
 *                              only while it is still exactly what version 1
 *                              wrote; a part the owner changed is kept and
 *                              named in the log. Then the second marker —
 *                              once, so a boot never asks again about a
 *                              decision the owner made
 *   a version 2 demo         → nothing (the checkout page is re-exported if
 *                              the payment choices baked into it went stale)
 *   an unmarked root that IS the version 1 demo by content (it was seeded
 *   with the script, which wrote no marker before v2.69)
 *                            → adopted: the first marker is written, then
 *                              the upgrade above
 *   any other root           → nothing is written, byte for byte. A sign of
 *                              a site, or an inventory that fails, is logged
 *
 * housekeeping() is what keeps a public fake shop presentable: orders older
 * than a day are cancelled (their stock comes back) and forget who placed
 * them, and a demo product that sold out is put back on the shelf.
 *
 * Copy and pictures are original. Nothing here is a third-party mark.
 */

const fs = require('fs');
const path = require('path');
const { ASSETS_DIR, CONFIG_DIR, SITE_ROOT, PUBLIC_DIR, DB_DIR } = require('../paths');

const DEMO_MARKER_ID = 'demo-store';
const DEMO_V2_MARKER_ID = 'demo-store-v2';
const DEMO_VERSION = 2;
const FILE_SIGNS = ['auth.json', 'site.json', 'menus.json', 'theme-overrides.json', 'seeded.json'];

// Version 1's catalog, character for character as 2.68 applied it. It is no
// longer seeded; it is what "is this demo still untouched?" is asked against
// (see v1Catalog below), so it must never be edited.
const CATALOG_V1 = `
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

// Version 2: twenty-four products, four to a category, so a grid of two or
// four columns is always whole rows. Six categories with a picture and a line
// each, two of them under "זמן ומקום"; brands, tags, four featured, five with
// options, sale prices, one sold out. The first payment is the `demo` kind —
// the one a visitor can actually finish — and PayPal's sandbox stays second.
// The three dearest products are one to an order: two of them would be more
// than a single order can hold.
const CATALOG = `
<bent-store version="1" name="חנות הדברים שאינם" currency="ILS">
  <bent-store-rules vat="18" vat-included="true" thanks="תודה. זו הדגמה: ההזמנה נרשמה, וכסף אמיתי לא עבר." />
  <bent-shelf id="huge" label="דברים גדולים מדי" image="/assets/demo2-cat-huge.svg" summary="מה שלא נכנס במעלית, וגם לא בתקציב." />
  <bent-shelf id="small" label="דברים קטנים" image="/assets/demo2-cat-small.svg" summary="קטנים מספיק כדי לאבד, יקרים מספיק כדי לחפש." />
  <bent-shelf id="quiet" label="שקט" image="/assets/demo2-cat-quiet.svg" summary="מוצרים שלא משמיעים קול. גם לא כשמשלמים עליהם." />
  <bent-shelf id="weather" label="מזג אוויר" image="/assets/demo2-cat-weather.svg" summary="תחזית: מעונן חלקית, עם סיכוי להחזר כספי." />
  <bent-shelf id="timeplace" label="זמן ומקום" image="/assets/demo2-cat-timeplace.svg" summary="נמכר לפי דקה, נמסר באיחור." />
  <bent-shelf id="time" label="זמן" parent="timeplace" summary="שעות, ימים ודקות, חדשים ומשומשים." />
  <bent-shelf id="place" label="מקום" parent="timeplace" summary="יעדים שעוד לא סומנו במפה." />
  <bent-shelf id="home" label="לבית שאין" image="/assets/demo2-cat-home.svg" summary="רהיטים וכלים לחדרים שעוד לא נבנו." />
  <bent-sku id="diy-mountain" title="הר להרכבה עצמית" price="3333333" shelf="huge" brand="שאלתיאל תעשיות" tags="הרכבה עצמית, גדול, מתנה" featured="true" max="1" image="/assets/demo2-diy-mountain.svg" badge="9,000,000 חלקים" summary="תשעה מיליון חלקים. מפתח אלן אחד.">
    הר שלם, מפורק לסלעים ממוספרים, עם חוברת של 4,000 עמודים ושלג בשקית נפרדת.

    הפסגה מגיעה במשלוח נפרד, כי היא עדיין בדרך.
    <bent-variant id="hill" label="גבעה" price="333333" stock="5" />
    <bent-variant id="mountain" label="הר" price="3333333" stock="2" />
    <bent-variant id="range" label="רכס שלם" price="9999999" stock="1" />
  </bent-sku>
  <bent-sku id="five-more-minutes" title="עוד חמש דקות" price="5" shelf="time" brand="סימחה ובניו, שענים" tags="זמן, בוקר, רב־מכר" featured="true" image="/assets/demo2-five-more-minutes.svg" badge="רב־מכר" summary="המוצר היחיד שכולם כבר ביקשו.">
    חמש דקות נוספות, לשימוש בבוקר, בסוף סרט או רגע לפני שיוצאים.

    אינן מצטברות. ניסינו.
    <bent-variant id="moment" label="רק עוד רגע" price="1" />
    <bent-variant id="five" label="חמש דקות" price="5" />
    <bent-variant id="ten" label="עשר דקות" price="9" />
  </bent-sku>
  <bent-sku id="named-cloud" title="עננה עם שם פרטי" price="1000001" stock="2" shelf="weather" brand="לילית מטאורולוגיה" tags="גדול, מתנה, נדיר" featured="true" max="1" image="/assets/demo2-named-cloud.svg" badge="מוגזם" summary="השם נבחר אחרי התשלום.">
    עננה קטנה שמרחפת מעל השולחן ומסרבת להוריד גשם בתוך הבית.

    המחיר עגול בכוונה, ועוד שקל, כדי שאי אפשר יהיה להתעלם ממנו.
  </bent-sku>
  <bent-sku id="music-cancelling" title="אוזניות שמבטלות מוזיקה" price="1280" was="1600" shelf="quiet" brand="WhiteNo1se" tags="שקט, טכנולוגיה, חדש" featured="true" image="/assets/demo2-music-cancelling.svg" badge="חדש" summary="הרעש נשאר. רק השיר נעלם.">
    אוזניות שמסננות החוצה כל מנגינה ומשאירות את המקדחה של השכנים בחדות מלאה.

    סוללה לשלושים שעות של כלום מוזיקלי.
    <bent-variant id="black" label="שחור" stock="8" />
    <bent-variant id="white" label="לבן" stock="6" />
    <bent-variant id="clear" label="שקוף" stock="0" />
  </bent-sku>
  <bent-sku id="pet-stone" title="אבן מחמד מאולפת למחצה" price="42000" stock="6" shelf="huge" brand="שאלתיאל תעשיות" tags="חיות מחמד, רגוע" image="/assets/demo2-pet-stone.svg" badge="רגועה" summary="יושבת. זה כל התרגיל.">
    אבן חלקה שלמדה לשבת בלי לזוז, ומתמידה בזה כבר כמה עידנים.

    אוכל לא כלול, כי היא לא אוכלת.
  </bent-sku>
  <bent-sku id="room-elephant" title="פיל בחדר, דגם סלוני" price="250000" stock="1" shelf="huge" brand="שאלתיאל תעשיות" tags="משפחה, גדול" image="/assets/demo2-room-elephant.svg" badge="כולם רואים" summary="כולם יודעים שהוא שם. אף אחד לא מזכיר אותו.">
    פיל בגודל מלא, מותאם לסלון ממוצע ולשיחה משפחתית אחת שנדחית כבר שנים.

    הנושא עצמו לא כלול. אותו תביאו מהבית.
  </bent-sku>
  <bent-sku id="starter-black-hole" title="חור שחור למתחילים" price="9999999" stock="3" shelf="huge" brand="שאלתיאל תעשיות" tags="חלל, גדול, אחסון" max="1" image="/assets/demo2-starter-black-hole.svg" badge="לא להתקרב" summary="בולע אור, זמן ואת הוראות ההפעלה.">
    חור שחור קטן וביתי, לאנשים שתמיד רצו מקום לשים בו דברים ולא לראות אותם שוב.

    אין מדיניות החזרות. זה לא עניין של מדיניות.
  </bent-sku>
  <bent-sku id="left-sock" title="גרב שמאלית יחידה, חגיגית" price="0.13" was="40" stock="40" shelf="small" brand="סטודיו פז" tags="ביגוד, מתנה" image="/assets/demo2-left-sock.svg" badge="כמעט חינם" summary="שמאל בלבד. הימנית יצאה לטיול.">
    גרב אחת, רקומה בחוט שלא קיים, לאירועים שבהם מספיקה רגל אחת.

    מגיעה בקופסה גדולה מהגרב.
  </bent-sku>
  <bent-sku id="blank-card" title="כרטיס ביקור לבן משני הצדדים" price="0.50" stock="500" shelf="small" brand="סטודיו פז" tags="משרד, נייר" image="/assets/demo2-blank-card.svg" summary="השם שלכם לא מופיע, וגם לא שלנו.">
    כרטיס עבה, נקי, בלי אות. מתאים למי שכבר אמרו הכול.

    אין לוגו, אין טלפון, אין כתובת אתר.
  </bent-sku>
  <bent-sku id="full-stop" title="נקודה" price="0.01" shelf="small" brand="סטודיו פז" tags="משרד, פיסוק" image="/assets/demo2-full-stop.svg" badge="סוף" summary="סוף משפט, באריזה אישית.">
    נקודה אחת, שחורה ועגולה, מוכנה לשימוש בסוף כל משפט שנמשך יותר מדי.

    פסיקים נמכרים בנפרד, ובכמויות.
    <bent-variant id="one" label="נקודה" price="0.01" />
    <bent-variant id="colon" label="נקודתיים (זוג)" price="0.02" />
    <bent-variant id="ellipsis" label="שלוש נקודות" price="0.03" />
  </bent-sku>
  <bent-sku id="buttonhole" title="חור של כפתור, בלי הכפתור" price="2.50" stock="120" shelf="small" brand="סטודיו פז" tags="ביגוד, תפירה" image="/assets/demo2-buttonhole.svg" summary="הכפתור אבד. החור נשאר נאמן.">
    לולאה תפורה היטב שמחכה לכפתור שלא יחזור.

    מתאימה לחולצות, למעילים ולאנשים עם סבלנות.
  </bent-sku>
  <bent-sku id="bottled-quiet" title="דממה בבקבוק, 500 מ״ל" price="777777.77" stock="3" shelf="quiet" brand="WhiteNo1se" tags="שקט, נדיר" image="/assets/demo2-bottled-quiet.svg" badge="שקט" summary="לנער בעדינות. לא לשמוע כלום.">
    חצי ליטר של שקט שנאסף בחדר אחרי שכולם יצאו.

    הפקק נשאר סגור. זה כל המוצר.
  </bent-sku>
  <bent-sku id="used-whisper" title="לחישה משומשת" price="64" stock="9" shelf="quiet" brand="WhiteNo1se" tags="שקט, יד שנייה" image="/assets/demo2-used-whisper.svg" summary="נאמרה פעם אחת, בזהירות.">
    לחישה יד שנייה במצב טוב. הבעלים הקודמים לא זוכרים מה היה בה.

    לא ניתן להגביר. זו לא תקלה.
  </bent-sku>
  <bent-sku id="dnd-sign" title="שלט ״נא להפריע בשקט״" price="18" stock="60" shelf="quiet" brand="WhiteNo1se" tags="שקט, משרד" image="/assets/demo2-dnd-sign.svg" summary="דו־צדדי. הצד השני ריק.">
    שלט לדלת, למי שלא רוצה לסגור אותה לגמרי.

    נתלה בלי מסמר, נופל בלי רעש.
  </bent-sku>
  <bent-sku id="mountain-air" title="שקית אוויר הררית, ריקה" price="4.20" stock="80" shelf="weather" brand="לילית מטאורולוגיה" tags="טבע, מתנה" image="/assets/demo2-mountain-air.svg" summary="נארזה בפסגה. נפתחה בדרך למטה.">
    שקית נייר ובה הרוח שהייתה אמורה להישאר בהר.

    אם שומעים משהו כשפותחים, זה היה משלוח של מישהו אחר.
  </bent-sku>
  <bent-sku id="bw-rainbow" title="קשת בענן בשחור־לבן" price="129" stock="25" shelf="weather" brand="לילית מטאורולוגיה" tags="טבע, קלאסי" image="/assets/demo2-bw-rainbow.svg" badge="קלאסי" summary="שבעה גוונים של אפור.">
    קשת שלמה, מקצה לקצה, בגרסה שמתאימה לכל סלון ולכל מצב רוח.

    הסיר עם הזהב לא כלול. גם הוא אפור.
  </bent-sku>
  <bent-sku id="yesterday-umbrella" title="מטרייה לגשם של אתמול" price="59.90" was="89.90" stock="31" shelf="weather" brand="לילית מטאורולוגיה" tags="טבע, חורף" image="/assets/demo2-yesterday-umbrella.svg" summary="נפתחת יום אחד מאוחר מדי.">
    מטרייה אמינה שמגינה היטב מפני כל טיפה שכבר ירדה.

    מומלצת לאנשים שנזכרים בדברים במדרגות.
  </bent-sku>
  <bent-sku id="extra-tuesday" title="יום שלישי נוסף" price="240" stock="4" shelf="time" brand="סימחה ובניו, שענים" tags="זמן, נדיר" image="/assets/demo2-extra-tuesday.svg" summary="נכנס בין שלישי לרביעי. לא חובה להשתמש.">
    יום שלם, עשרים וארבע שעות, בלי פגישות ובלי שמישהו יודע עליו.

    לא ניתן להמרה ליום שישי. גם את זה ניסינו.
  </bent-sku>
  <bent-sku id="used-yesterday" title="אתמול, משומש במצב טוב" price="86.40" stock="1" shelf="time" brand="סימחה ובניו, שענים" tags="זמן, יד שנייה" image="/assets/demo2-used-yesterday.svg" badge="יד שנייה" summary="בעלים קודמים: כולם.">
    אתמול שלם, עם סימני שימוש קלים בסביבות הצהריים.

    נמכר כמות שהוא. אי אפשר לשנות בו כלום, וזה חלק מהקסם.
  </bent-sku>
  <bent-sku id="nowhere-map" title="מפה אל מקום שלא קיים" price="15" stock="0" shelf="place" brand="סימחה ובניו, שענים" tags="מסע, נייר" image="/assets/demo2-nowhere-map.svg" badge="אזל" summary="הקו מקווקו כי היעד לא הסכים.">
    מפה מצוירת ביד אל נקודה שהקרטוגרף מחק ברגע האחרון.

    אזלה, וזה מתאים לה: אי אפשר להגיע גם כשהיא במלאי.
  </bent-sku>
  <bent-sku id="chair-manual" title="הוראות הרכבה לכיסא שכבר הורכב" price="999.99" was="1000000" stock="1" shelf="home" brand="בן נגרות" tags="הרכבה עצמית, נייר" image="/assets/demo2-chair-manual.svg" badge="מאוחר" summary="שלב 1: לשבת. אין שלב 2.">
    חוברת מסודרת לכיסא שעומד בחדר ומחכה שלא יפרקו אותו בטעות.

    הציורים מקדימים את הברגים.
  </bent-sku>
  <bent-sku id="wall-less-door" title="דלת בלי קיר" price="1450" shelf="home" brand="בן נגרות" tags="רהיטים, עץ" image="/assets/demo2-wall-less-door.svg" summary="נפתחת לשני הכיוונים. מובילה לאותו מקום.">
    דלת עץ מלא עם משקוף, ידית ומנעול, שעומדת באמצע החדר ומחכה לדפיקה.

    קיר נמכר בנפרד. לא אצלנו.
    <bent-variant id="inward" label="נפתחת פנימה" stock="4" />
    <bent-variant id="outward" label="נפתחת החוצה" stock="3" />
  </bent-sku>
  <bent-sku id="shelf-shelf" title="מדף למדפים" price="320" stock="18" shelf="home" brand="בן נגרות" tags="רהיטים, אחסון" image="/assets/demo2-shelf-shelf.svg" badge="מטא" summary="סוף־סוף מקום לשים בו את המדפים.">
    מדף רחב ויציב שנועד להחזיק מדפים אחרים, עד שיימצא להם קיר.

    החנות הזו מסודרת במדפים. זה לא מקרי.
  </bent-sku>
  <bent-sku id="shy-mirror" title="מראה ביישנית" price="780" stock="5" shelf="home" brand="בן נגרות" tags="רהיטים, עיצוב" image="/assets/demo2-shy-mirror.svg" summary="משקפת רק כשלא מסתכלים.">
    מראה באיכות גבוהה שמפנה את המבט ברגע שמתקרבים אליה.

    מצוינת למסדרונות ולאנשים שממהרים.
  </bent-sku>
  <bent-ship id="pickup" label="איסוף מהמחסן הדמיוני" price="0" address="false" note="המחסן נמצא מאחורי הדלת שכבר פתחתם." />
  <bent-ship id="thought" label="משלוח על גבי מחשבה" price="250" free-over="500000" note="יוצא לדרך כשחושבים עליו חזק. כתובת כן נדרשת, בשביל הנימוס." />
  <bent-ship id="pigeon" label="דואר יונים, בלי היונה" price="12" note="המעטפה מגיעה. איך — לא שאלנו." />
  <bent-pay id="pretend" kind="demo" label="כסף של משחק קופסה">משלמים בשטרות מהמשחק. ההזמנה נרשמת, כסף אמיתי לא עובר.</bent-pay>
  <bent-pay id="paypal" kind="paypal" label="PayPal — ארגז חול">כפתור הבדיקה של PayPal. לא נגבה שקל אמיתי.</bent-pay>
  <bent-coupon code="HALFJOKE" percent="50" min="1" note="חצי הנחה על בדיחה שלמה" />
  <bent-coupon code="PAZ10" percent="10" note="עשרה אחוזים, בלי סיבה" />
  <bent-coupon code="WHITENO1SE" free-shipping="true" note="משלוח בשקט, בחינם" />
  <bent-coupon code="SIMHA" amount="5" min="50" note="חמישה שקלים של שמחה" />
</bent-store>
`.trim();

function svgV1(body, bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180" role="img">
  <rect width="240" height="180" rx="28" fill="${bg}"/>
  ${body}
</svg>
`;
}

// Version 1's eight pictures, kept only so a version 1 root can still be
// built (applyDemoV1). Version 2's art is src/store/demo-art.js.
const ARTS_V1 = {
  'demo-left-sock.svg': svgV1('<path d="M78 36h46v62h-18l-10 46H74l-8-46H56V36h22z" fill="#6d28d9"/><path d="M86 48h30v8H86z" fill="#e8b84a"/><circle cx="168" cy="58" r="22" fill="#e8b84a"/><circle cx="168" cy="58" r="8" fill="#fff8ee"/>', '#f4e9ff'),
  'demo-named-cloud.svg': svgV1('<ellipse cx="120" cy="100" rx="70" ry="28" fill="#fff"/><ellipse cx="92" cy="86" rx="28" ry="22" fill="#fff"/><ellipse cx="140" cy="80" rx="36" ry="26" fill="#fff"/><circle cx="120" cy="52" r="8" fill="#e8b84a"/><path d="M108 118h24" stroke="#e8b84a" stroke-width="4" stroke-linecap="round"/>', '#6d28d9'),
  'demo-mountain-air.svg': svgV1('<path d="M24 150 L90 48 L130 110 L168 70 L220 150 Z" fill="#1c1430"/><circle cx="188" cy="40" r="16" fill="#e8b84a"/>', '#fff8ee'),
  'demo-pet-stone.svg': svgV1('<ellipse cx="120" cy="108" rx="54" ry="36" fill="#6b6280"/><ellipse cx="100" cy="96" rx="16" ry="10" fill="#eadfce"/><circle cx="92" cy="92" r="3" fill="#1c1430"/><circle cx="108" cy="92" r="3" fill="#1c1430"/>', '#f4e9ff'),
  'demo-bottled-quiet.svg': svgV1('<path d="M104 28h32v18h-8l-6 18v78a22 22 0 0 1-44 0V64l-6-18h-8V28h40z" fill="#1c1430" fill-opacity="0.85"/><rect x="108" y="20" width="24" height="12" rx="3" fill="#e8b84a"/>', '#fff8ee'),
  'demo-blank-card.svg': svgV1('<rect x="48" y="40" width="144" height="100" rx="12" fill="#fff" stroke="#6d28d9" stroke-width="3"/><rect x="64" y="58" width="40" height="6" rx="3" fill="#eadfce"/>', '#f4e9ff'),
  'demo-chair-manual.svg': svgV1('<path d="M70 40h70v14H70zM78 54h8v70h-8zM124 54h8v70h-8zM62 124h86v10H62z" fill="#6d28d9"/><rect x="150" y="36" width="40" height="56" rx="4" fill="#fff" stroke="#e8b84a" stroke-width="3"/>', '#fff8ee'),
  'demo-nowhere-map.svg': svgV1('<path d="M40 130 C80 40, 160 40, 200 120" fill="none" stroke="#6d28d9" stroke-width="4" stroke-dasharray="8 8"/><circle cx="200" cy="120" r="8" fill="none" stroke="#e8b84a" stroke-width="3"/>', '#fff8ee')
};

// ── the words and the look ─────────────────────────────────────────────

const SITE_TITLE = 'חנות הדברים שאינם';
const DESCRIPTION_V1 = 'חנות הדגמה של תפוזיאל. המחירים מומצאים. התשלום הוא ארגז חול של PayPal — לא כסף אמיתי.';
const DESCRIPTION = 'חנות הדגמה של Tapuziel. המוצרים והמחירים מומצאים, והתשלום בכסף של משחק — כסף אמיתי לא עובר.';
const FOOTER_LINE = 'חנות הדגמה של Tapuziel — Shaltiel Enterprises';
const HOME_PATH = 'home';
// The store setting holdHours: an order nobody paid gives its stock back
// after two hours (orders.housekeeping). A demo-PAID order keeps its stock
// until housekeeping() below resets the shop.
const HOLD_HOURS = 2;

// One palette for both versions (a smoke pins the purple). Version 2 needs
// no new theme key: with a content column of 1100px the header and the
// footer follow the column, and the transparent art sits on the theme's one
// picture tint (--media-bg, which rests on lightBg).
const PALETTE = {
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
};

function saveLook(description) {
  require('../theme').saveThemeSettings({
    siteTitle: SITE_TITLE,
    description,
    logo: { type: 'text', text: SITE_TITLE },
    overrides: JSON.parse(JSON.stringify(PALETTE))
  });
}

// What version 1 wrote on its shop page — which was its home page too.
// "Did the owner edit the home page?" is asked against these bytes.
const SHOP_SOURCE_V1 = [
  '<bent-banner tone="brand">הדגמה של חנות תפוזיאל — המחירים מומצאים, ו-PayPal כאן הוא ארגז חול</bent-banner>',
  '<bent-heading level="1" align="center">חנות הדברים שאינם</bent-heading>',
  '<bent-text align="center">חנות הדגמה של תפוזיאל. המחירים מומצאים בכוונה, והתשלום הוא ארגז חול של PayPal — לא כסף אמיתי.</bent-text>',
  '<bent-features columns="3">',
  '<bent-feature title="מחירים מומצאים">שקל וקצת, או מיליון ועוד שקל. אף מחיר כאן אינו מחיר של חנות אמיתית.</bent-feature>',
  '<bent-feature title="ארגז חול">הכפתור של PayPal רץ מול ארגז החול. אישור בדף הזה לא מעביר כסף.</bent-feature>',
  '<bent-feature title="בלי מותגים">הציורים והמשפטים נכתבו לחנות הזו. אין כאן סימן של חנות אחרת.</bent-feature>',
  '</bent-features>',
  '<bent-shop filter="true" columns="3"></bent-shop>'
].join('\n');

function escAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Version 2's home page. Every grid is whole rows on the content column:
 * six category tiles in three columns, four featured, four new. The hero is
 * a band from edge to edge under the header (the theme's hero CARD is
 * narrower than the column, and a narrow card under a column-wide banner
 * reads as two widths); the banner under it says in one breath what is
 * invented and that the payment is pretend.
 */
function homeSource(shopUrl) {
  const shop = escAttr(shopUrl);
  return [
    '<bent-hero width="full">',
    '<bent-heading level="1" align="center">חנות הדברים שאינם</bent-heading>',
    '<bent-text align="center">כל מה שאין, במקום אחד.</bent-text>',
    `<bent-button href="${shop}" align="center">לכל המוצרים</bent-button>`,
    '</bent-hero>',
    '<bent-banner tone="brand" align="center">חנות הדגמה של Tapuziel — מחירים מומצאים, והתשלום בכסף של משחק. כסף אמיתי לא עובר.</bent-banner>',
    '<bent-shelves id="categories" columns="3" title="קטגוריות"></bent-shelves>',
    '<bent-shop featured="true" columns="4" limit="4" title="הנבחרים"></bent-shop>',
    '<bent-shop sort="new" columns="4" limit="4" title="חדשים בחנות"></bent-shop>',
    '<bent-features columns="3">',
    '<bent-feature title="מה כאן מזויף">המוצרים, המחירים והמלאי. שקל וקצת, או מיליון ועוד שקל — אף מחיר כאן אינו מחיר של חנות אמיתית.</bent-feature>',
    '<bent-feature title="איך משלמים בכאילו">בקופה בוחרים ״כסף של משחק קופסה״, ובדף ההזמנה לוחצים ״לשלם בכסף דמיוני״. ההזמנה נרשמת, וכסף אמיתי לא עובר.</bent-feature>',
    '<bent-feature title="מה כאן אמיתי">האתר. קטלוג, קטגוריות, עגלה, קופה והזמנות — הכול אתר Tapuziel אחד, בלי תוסף ובלי שירות חיצוני.</bent-feature>',
    '</bent-features>',
    `<bent-cta title="כל הקטלוג, בדף אחד" buttontext="לכל המוצרים" url="${shop}" align="center">חיפוש, מיון וסינון לפי קטגוריה — כמו בחנות אמיתית, רק בלי המוצרים.</bent-cta>`
  ].join('\n');
}

const SHOP_SOURCE = [
  '<bent-heading level="1" align="center">כל המוצרים</bent-heading>',
  '<bent-text align="center">כל מה שאין, לפי קטגוריה, מחיר או שם. המחירים מומצאים; העגלה אמיתית.</bent-text>',
  '<bent-shop filter="true" search="true" sorter="true" columns="4" page-size="12"></bent-shop>'
].join('\n');

/** A catalog string, read: its products, shelves, payments and coupons as the document says them. */
function docOf(text) {
  return require('../bentml/store-dialect').parseStoreDoc(text).doc;
}

/**
 * Version 2's pictures (src/store/demo-art.js), under names version 1 never
 * used: a CDN in front of a live site may go on serving an old
 * demo-<name>.svg, so the new art is demo2-<name>.svg.
 */
function artFiles() {
  const { ART } = require('./demo-art');
  return Object.entries(ART).map(([name, body]) => [name.replace(/^demo-/, 'demo2-'), body]);
}

function writeArt(files) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  for (const [name, body] of files) fs.writeFileSync(path.join(ASSETS_DIR, name), body, 'utf8');
}

// ── the markers ────────────────────────────────────────────────────────

const MARKER_FILE = path.join(CONFIG_DIR, 'seeded.json');

/**
 * config/seeded.json — the content seed keeps its own package ids in the
 * same file, so it is read whole and written back whole. A file that is
 * there and cannot be read is `corrupt`: nothing is decided from it and it
 * is never overwritten.
 * @returns {{ state: 'missing'|'ok'|'corrupt', data: object }}
 */
function readMarkers() {
  const r = require('../json-file').readJson(MARKER_FILE);
  if (r.state === 'missing') return { state: 'missing', data: {} };
  if (r.state !== 'ok' || !r.data || typeof r.data !== 'object' || Array.isArray(r.data)) return { state: 'corrupt', data: {} };
  return { state: 'ok', data: r.data };
}

function writeMarkers(ids) {
  const now = readMarkers();
  if (now.state === 'corrupt') throw new Error('config/seeded.json cannot be read — left as it is');
  const marker = now.data;
  const stamp = new Date().toISOString();
  for (const id of ids) if (!marker[id]) marker[id] = stamp;
  require('../json-file').writeAtomic(MARKER_FILE, JSON.stringify(marker, null, 2));
}

// A root is a demo from the seed's first write; the marker records it at the
// end, once everything landed. In between, the pages the seed exports must
// already offer the demo payment (src/store/demo-pay.js asks isDemoSite()).
let seedingNow = false;

/** Is this site a demo shop? The one answer — src/store/demo-pay.js asks here. */
function isDemoSite() {
  if (seedingNow) return true;
  const m = readMarkers().data;
  return !!(m[DEMO_MARKER_ID] || m[DEMO_V2_MARKER_ID]);
}

/** 0 = not a demo, 1 = the 2.68 demo, 2 = this one. */
function demoVersion() {
  const m = readMarkers().data;
  if (m[DEMO_V2_MARKER_ID]) return 2;
  return m[DEMO_MARKER_ID] ? 1 : 0;
}

// ── "is it still what the seed wrote?" ─────────────────────────────────

/**
 * Is the store's catalog exactly the catalog `text`?
 *
 * The question is put to the store's own planner: the document is planned
 * against the store (nothing is written), and the answer is yes when
 *   - the plan has nothing to add, nothing to change and nothing to hide —
 *     every product of the document is in the store field for field, and no
 *     other active product is;
 *   - the store holds no product at all outside the document (a hidden or a
 *     draft one counts), no category outside it and no coupon outside it;
 *   - the plan's preview lists no category to add or change, no coupon to
 *     add, change or switch off, and no settings line — which covers the
 *     shop's name, the VAT rules, the thank-you sentence, the shipping
 *     methods and the payment methods.
 * Stock is left out of the question: the document is planned without its
 * stock attributes, and an absent stock keeps the store's. Stock is moved by
 * visitors' orders; a demo that sold a sock is not a demo its owner edited.
 * @returns {{ same: boolean, why: string }}
 */
function catalogIs(store, text) {
  const doc = docOf(text);
  const planned = store.document.planDocument(text.replace(/ stock="[^"]*"/g, ''));
  const pv = planned.preview;
  if (!doc || !planned.ok || !pv) return { same: false, why: 'the document could not be planned' };
  const why = [];
  if (pv.added.length) why.push('missing: ' + pv.added.map((p) => p.id).join(', '));
  if (pv.changed.length) why.push('changed: ' + pv.changed.map((p) => p.id).join(', '));
  if (pv.invalid.length) why.push('unreadable: ' + pv.invalid.map((p) => p.id).join(', '));
  if (pv.hidden.length || store.catalog.countProducts().total !== doc.products.length) why.push('products the demo never had');
  if (pv.shelvesAdded.length || pv.shelvesChanged.length || store.catalog.listShelves().length !== doc.shelves.length) why.push('categories differ');
  const c = pv.coupons;
  if (c.added.length || c.changed.length || c.off.length || store.coupons.listCoupons().length !== (doc.coupons || []).length) why.push('coupons differ');
  if (pv.settings.length) why.push('shop rules, shipping or payments differ');
  return { same: why.length === 0, why: why.join('; ') };
}

/** Which catalog the store holds: version 1's, version 2's, or one the owner made his own. */
function catalogState(store) {
  const v1 = catalogIs(store, CATALOG_V1);
  if (v1.same) return { state: 'v1', why: '' };
  if (catalogIs(store, CATALOG).same) return { state: 'v2', why: '' };
  return { state: 'edited', why: v1.why };
}

/** Does the page hold exactly this source — the draft AND what is live? Byte for byte. */
function sourceIs(fullPath, text) {
  const pages = require('../pages');
  const want = require('../pzn-source').toPznSource(text).source;
  return pages.getPageSource(fullPath, 'draft') === want && pages.getPageSource(fullPath, 'published') === want;
}

/**
 * The home and shop pages. Version 1: the shop page is crowned as the home
 * page, carries version 1's source, and no page lives at `home`. Version 2:
 * `home` is crowned and both pages carry version 2's source.
 */
function pagesState(store) {
  const pages = require('../pages');
  const s = store.settings.loadSettings();
  const crowned = String(require('../config').loadConfig().homepage || '');
  const shop = pages.getPageByFullPath(s.pages.shop);
  const front = pages.getPageByFullPath(HOME_PATH);
  const live = (p) => !!p && p.status === 'published';
  if (s.pages.shop === 'shop' && crowned === 'shop' && live(shop) && !front && sourceIs('shop', SHOP_SOURCE_V1)) return 'v1';
  if (crowned === HOME_PATH && live(shop) && live(front) && sourceIs(s.pages.shop, SHOP_SOURCE) &&
    sourceIs(HOME_PATH, homeSource(pages.publicUrlFor(s.pages.shop)))) return 'v2';
  return 'edited';
}

// Version 1 never wrote a menu itself: opening the store added "חנות" to the
// one link a new site starts with.
const MENU_V1 = [{ label: 'דף הבית', url: '/' }, { label: 'חנות', type: 'page', target: 'shop' }];

/**
 * Version 2's menu: דף הבית · כל המוצרים · קטגוריות ▾. The home page and the
 * shop are two pages now, so no address is listed twice; "קטגוריות" leads to
 * the tiles on the home page and opens the category pages under it.
 */
function menuV2(store) {
  const s = store.settings.loadSettings();
  const live = store.pages.liveShelfUrls();
  const kids = store.catalog.listShelves({ visible: true })
    .filter((sh) => sh.depth === 0 && sh.total > 0)
    .map((sh) => (live.has(sh.slug)
      ? { label: sh.label, type: 'page', target: store.pages.shelfPath(sh.slug) }
      : { label: sh.label, type: 'custom', url: store.pages.shopLink(s, 'shelf', sh.slug) }));
  return [
    { label: 'דף הבית', type: 'custom', url: '/' },
    { label: 'כל המוצרים', type: 'page', target: s.pages.shop },
    { label: 'קטגוריות', type: 'custom', url: '/#categories', children: kids }
  ];
}

function menuShape(items) {
  const shape = (list) => (list || []).map((it) => [it.label, it.type, it.target, it.url, shape(it.children)]);
  return JSON.stringify(shape(require('../menus').normalizeItems(items)));
}

function menuState(store) {
  const menus = require('../menus');
  if ((menus.getMenuLocations().main || 'main') !== 'main') return 'edited';
  const now = menuShape(menus.getMenu('main'));
  if (now === menuShape(MENU_V1)) return 'v1';
  if (now === menuShape(menuV2(store))) return 'v2';
  return 'edited';
}

// ── the writers (the fresh seed and the upgrade share them) ────────────

/** The demo payment as version 2's catalog words it. */
function demoMethod() {
  const m = (docOf(CATALOG).payments || []).find((p) => p.kind === 'demo');
  return { id: m.id, kind: 'demo', label: m.label, details: m.details, phone: '', url: '' };
}

/**
 * Version 2's catalog, planned — before a picture or a theme is written. A
 * catalog that would not land whole must leave the root exactly as it was:
 * a half-seeded root is one every later boot refuses.
 */
function planV2(store) {
  const planned = store.document.planDocument(CATALOG);
  if (!planned.ok) return { ok: false, hard: true, message: planned.errors.map((e) => e.message).join(' · ') || 'הקטלוג לא נקרא' };
  const bad = planned.warnings.filter((w) => w.hard).map((w) => w.message);
  if (planned.preview.invalid.length) return { ok: false, hard: true, message: bad.join(' · ') };
  return { ok: true, hard: bad.length > 0, message: bad.join(' · ') };
}

function applyV2(store, force) {
  const applied = store.document.applyDocument(CATALOG, { force: !!force, reason: 'demo-v2' });
  if (!applied.ok) return { ok: false, code: applied.code || 'APPLY', message: applied.message || 'הקטלוג לא נקלט' };
  // a setting, not a document attribute: an owner's own number is kept
  if (!store.settings.loadSettings().holdHours) store.settings.saveSettings({ holdHours: HOLD_HOURS });
  return { ok: true };
}

function writePagesV2(store) {
  const pages = require('../pages');
  const s = store.settings.loadSettings();
  const shopPath = s.pages.shop;
  if (!pages.getPageByFullPath(shopPath)) return { ok: false, code: 'NO_SHOP', message: 'דף החנות לא נוצר' };
  // the browser tab and a search result name the shop, not "דף הבית" / "חנות"
  pages.savePageSource(shopPath, SHOP_SOURCE, { publish: true, meta: { seoTitle: 'כל המוצרים — ' + SITE_TITLE } });
  if (!pages.getPageByFullPath(HOME_PATH)) {
    pages.createPage({ title: 'דף הבית', slug: HOME_PATH, blocks: [], status: 'draft' });
  }
  pages.savePageSource(HOME_PATH, homeSource(pages.publicUrlFor(shopPath)), {
    publish: true,
    meta: { seoTitle: SITE_TITLE + ' — חנות הדגמה של Tapuziel', description: DESCRIPTION }
  });
  const { loadConfig, saveConfig } = require('../config');
  const cfg = loadConfig();
  cfg.homepage = HOME_PATH;
  cfg.language = cfg.language || 'he';
  saveConfig(cfg);
  // every product and category trail starts at the home page, and another
  // page was just crowned: the pages the catalog owns are written again
  if (s.open) store.pages.syncCatalogPages();
  return { ok: true };
}

/** Through the menus API, the way the store adds its own link: a backup first. */
function writeMenuV2(store) {
  const menus = require('../menus');
  try { menus.backupMenus('demo-store:v2'); } catch (e) { /* a missing backup must not block the menu */ }
  menus.saveMenu(menus.getMenuLocations().main || 'main', menuV2(store));
}

function saveFooterLine() {
  const { loadConfig, saveConfig } = require('../config');
  const cfg = loadConfig();
  cfg.footer = { ...(cfg.footer || {}), text: FOOTER_LINE };
  saveConfig(cfg);
}

// ── seeding an empty root ──────────────────────────────────────────────

function emptyRootOrRefusal() {
  if (process.env.TAPUZ_DEMO_STORE !== '1') {
    return { ok: false, code: 'NOT_EXPLICIT', message: 'הדגמת החנות רצה רק עם TAPUZ_DEMO_STORE=1, ורק על שורש ריק' };
  }
  const probe = require('../seed-content').inspectRoot();
  if (!probe.empty || !probe.confident) return { ok: false, code: 'NOT_EMPTY', message: probe.reason };
  return null;
}

/**
 * Seed version 2. The caller must have proved the root is empty; this
 * checks again and writes nothing when the proof is missing. Both markers
 * are written here, once everything landed — so the script and the boot
 * leave the same root.
 * @returns {{ ok: boolean, code?: string, message?: string, version?: number, products?: number, homepage?: string }}
 */
function applyDemo() {
  const refused = emptyRootOrRefusal();
  if (refused) return refused;
  const store = require('./index');
  seedingNow = true;
  try {
    const plan = planV2(store);
    if (!plan.ok || plan.hard) return { ok: false, code: 'CATALOG', message: plan.message || 'הקטלוג לא נקלט' };
    writeArt(artFiles());
    saveLook(DESCRIPTION);
    const applied = applyV2(store, false);
    if (!applied.ok) return applied;
    store.flip(true);
    const built = writePagesV2(store);
    if (!built.ok) return built;
    writeMenuV2(store);
    saveFooterLine();
    writeMarkers([DEMO_MARKER_ID, DEMO_V2_MARKER_ID]);
  } finally {
    seedingNow = false;
  }
  require('../export').exportAll();
  return { ok: true, version: DEMO_VERSION, products: store.catalog.countProducts().total, homepage: HOME_PATH };
}

/**
 * Version 1, as 2.68 seeded it — kept callable so the step to version 2 can
 * be proved against a version 1 root (scripts/smoke-store-demo.js). Nothing
 * in the product calls it. `marker: false` is the root the 2.68 SCRIPT left
 * behind: a demo that carries no marker.
 */
function applyDemoV1({ marker = true } = {}) {
  const refused = emptyRootOrRefusal();
  if (refused) return refused;
  writeArt(Object.entries(ARTS_V1));
  saveLook(DESCRIPTION_V1);
  const store = require('./index');
  const applied = store.document.applyDocument(CATALOG_V1);
  if (!applied.ok) return { ok: false, code: applied.code || 'APPLY', message: applied.message || 'הקטלוג לא נקלט' };
  store.flip(true);
  const pages = require('../pages');
  if (!pages.getPageByFullPath('shop')) return { ok: false, code: 'NO_SHOP', message: 'דף החנות לא נוצר' };
  pages.savePageSource('shop', SHOP_SOURCE_V1, { publish: true });
  const { loadConfig, saveConfig } = require('../config');
  const cfg = loadConfig();
  cfg.homepage = 'shop';
  cfg.language = cfg.language || 'he';
  saveConfig(cfg);
  require('../export').exportAll();
  if (marker) writeMarkers([DEMO_MARKER_ID]);
  return { ok: true, version: 1, products: store.catalog.countProducts().total, homepage: 'shop' };
}

// ── version 1 → version 2 ──────────────────────────────────────────────

/**
 * The step to version 2, on a root that carries the first marker and not
 * the second.
 *
 * Each part moves only while it is still exactly what version 1 wrote. A
 * part that is already version 2 (an upgrade that was cut short) counts as
 * done; anything else is the owner's, is kept, and is named in the log:
 *
 *   catalog      catalogIs(CATALOG_V1) — the rule is written there. Version
 *                2 is then applied as the whole catalog: the eight old
 *                products keep their row and their orders, stock goes back
 *                to the catalog's numbers, nothing is deleted.
 *   pages        only together with the catalog (they are written FOR it:
 *                the featured strip, the six tiles, the payment the info
 *                card names), and only while the shop page — version 1's
 *                home page — is byte for byte version 1's, it is still the
 *                crowned home page and nothing lives at `home`.
 *   menu         only together with the pages (with the shop still crowned,
 *                version 2's menu would list one address twice), and only
 *                while the menu is exactly version 1's two links.
 *   description  while it is version 1's sentence.
 *   footer       while the footer text is empty.
 * The palette and the site title are the same in both versions and are not
 * written. Orders are never touched.
 *
 * One exception to "kept": an OPEN shop whose checkout offers no way to pay
 * at all is given the demo payment even when its catalog is kept. A shop
 * that cannot take an order is a broken shop, and adding a method removes
 * nothing.
 *
 * The second marker is written once the step has RUN, whatever was kept —
 * a boot never asks again about a decision the owner made.
 * @returns {{ ok: boolean, code?: string, parts?: object }}
 */
function upgradeDemo() {
  if (process.env.TAPUZ_DEMO_STORE !== '1' || demoVersion() !== 1) return { ok: false, code: 'NOT_VERSION_1' };
  const store = require('./index');
  const parts = {};
  let wrote = false;
  const done = (part) => { parts[part] = 'upgraded'; };
  const kept = (part, why) => { parts[part] = 'kept'; console.log(`[demo-store] v2: ${part} kept — ${why}`); };

  const cat = catalogState(store);
  if (cat.state === 'v2') done('catalog');
  else if (cat.state === 'edited') kept('catalog', 'the owner edited it (' + cat.why + ')');
  else {
    const plan = planV2(store);
    if (!plan.ok) kept('catalog', 'version 2 could not be planned: ' + plan.message);
    else {
      writeArt(artFiles());
      const applied = applyV2(store, true);
      if (applied.ok) { done('catalog'); wrote = true; } else kept('catalog', 'version 2 was refused: ' + applied.message);
    }
  }

  if (parts.catalog !== 'upgraded') kept('pages', 'they are written for the version 2 catalog, and the catalog was kept');
  else {
    const state = pagesState(store);
    if (state === 'v2') done('pages');
    else if (state === 'edited') kept('pages', 'the owner edited the home page');
    else {
      const built = writePagesV2(store);
      if (built.ok) { done('pages'); wrote = true; } else kept('pages', built.message);
    }
  }

  if (parts.pages !== 'upgraded') kept('menu', 'it follows the pages, and the pages were kept');
  else {
    const state = menuState(store);
    if (state === 'v2') done('menu');
    else if (state === 'edited') kept('menu', 'the owner edited it');
    else { writeMenuV2(store); done('menu'); wrote = true; }
  }

  const { loadConfig, saveConfig } = require('../config');
  const cfg = loadConfig();
  let words = false;
  if (cfg.description === DESCRIPTION_V1) { cfg.description = DESCRIPTION; words = true; done('description'); }
  else if (cfg.description === DESCRIPTION) done('description');
  else kept('description', 'the owner rewrote it');
  const footer = (cfg.footer && cfg.footer.text) || '';
  if (!footer) { cfg.footer = { ...(cfg.footer || {}), text: FOOTER_LINE }; words = true; done('footer'); }
  else if (footer === FOOTER_LINE) done('footer');
  else kept('footer', 'the owner wrote one');
  if (words) { saveConfig(cfg); wrote = true; }

  const s = store.settings.loadSettings();
  if (s.open && !store.paypal.offeredPayments(s).length && !s.payments.some((m) => m.kind === 'demo')) {
    store.settings.saveSettings({ payments: [demoMethod()].concat(s.payments) });
    parts.payment = 'added';
    wrote = true;
    console.log('[demo-store] v2: demo payment added — the checkout offered no way to pay');
  }

  writeMarkers([DEMO_MARKER_ID, DEMO_V2_MARKER_ID]);
  if (wrote) require('../export').exportAll();
  console.log('[demo-store] v2: ' + Object.keys(parts).map((k) => k + ' ' + parts[k]).join(', '));
  return { ok: true, parts };
}

// ── an unmarked version 1 demo ─────────────────────────────────────────

// a database larger than this is not looked into (the look copies it whole);
// version 1's own database is well under a megabyte
const PROBE_MAX_BYTES = 256 * 1024 * 1024;

function v1Fingerprint() {
  const money = require('./money');
  return docOf(CATALOG_V1).products
    .map((p) => ({ slug: p.id, title: p.title, price: money.toMinor(p.price) }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

/**
 * A first look at an unmarked root's catalog that cannot change the root.
 *
 * The database is COPIED out of the root (with its write-ahead log, when
 * one was left: the 2.68 script exited without closing, so its whole
 * catalog can sit in the log) and the copy is what gets opened. Opening the
 * file itself — even read-only — leaves a -wal and a -shm file beside a WAL
 * database, and opening it through ../db creates or migrates it; a living
 * site that is not the demo must stay byte for byte what it was. Only a
 * root whose products are version 1's eight, by id, name and price, goes on
 * to the real question (catalogIs), which is asked through the store.
 */
function looksLikeV1Demo() {
  const os = require('os');
  const file = path.join(DB_DIR, 'tapuz.db');
  let dir = '';
  let copy = null;
  try {
    const sizeOf = (f) => { try { return fs.statSync(f).size; } catch (e) { return -1; } };
    const size = sizeOf(file);
    const log = Math.max(sizeOf(file + '-wal'), 0);
    if (size < 0 || size + log > PROBE_MAX_BYTES) return false;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-demo-look-'));
    fs.copyFileSync(file, path.join(dir, 'tapuz.db'));
    if (log > 0) fs.copyFileSync(file + '-wal', path.join(dir, 'tapuz.db-wal'));
    copy = new (require('better-sqlite3'))(path.join(dir, 'tapuz.db'), { readonly: true, fileMustExist: true });
    const rows = copy.prepare('SELECT slug, title, price FROM store_products ORDER BY slug').all();
    const want = v1Fingerprint();
    return rows.length === want.length &&
      rows.every((r, i) => r.slug === want[i].slug && r.title === want[i].title && r.price === want[i].price);
  } catch (e) {
    // no database, not a database, no catalog in it: not the demo
    return false;
  } finally {
    if (copy) { try { copy.close(); } catch (e) { /* nothing was held */ } }
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the system's own sweep takes it */ } }
  }
}

/**
 * The 2.68 SCRIPT seeded a demo and wrote no marker (only the boot did), so
 * such a root is a living site that nothing calls a demo: the demo payment
 * is never offered on it and the upgrade never reaches it. It is adopted —
 * given the first marker — only when its catalog is version 1's by the very
 * rule the upgrade uses (catalogIs). Anything else is somebody's site — one
 * product renamed, a ninth product, an empty catalog — and nothing at all
 * is written.
 */
function adoptUnmarkedV1(markers) {
  if (markers.state === 'corrupt') return false;
  // a database this process already has open has nothing left to protect
  const opened = !!require.cache[require.resolve('../db')];
  if (!opened && !looksLikeV1Demo()) return false;
  if (catalogState(require('./index')).state !== 'v1') return false;
  writeMarkers([DEMO_MARKER_ID]);
  return true;
}

/** Filesystem half of inspectRoot, without opening the database. */
function filesystemProbe() {
  const signs = [];
  const errors = [];
  try {
    for (const f of FILE_SIGNS) if (fs.existsSync(path.join(CONFIG_DIR, f))) signs.push('config/' + f);
    for (const d of ['pages', 'content']) {
      const p = path.join(SITE_ROOT, d);
      if (fs.existsSync(p) && fs.readdirSync(p).length) signs.push(d + '/');
    }
  } catch (e) { errors.push('filesystem: ' + e.message); }
  if (errors.length) return { empty: false, confident: false, reason: 'could not establish that the root is empty (' + errors.join('; ') + ')' };
  if (signs.length) return { empty: false, confident: true, reason: 'the root already holds a site (' + signs.join(', ') + ')' };
  return { empty: true, confident: true, reason: 'empty root' };
}

// ── the checkout page ──────────────────────────────────────────────────

/** The payment ids baked into an exported checkout page, in order; null when there is no page. */
function bakedPayments(file) {
  let html;
  try { html = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  const ids = [];
  const radio = /<input\b[^>]*\bname="payment"[^>]*>/g;
  let m;
  while ((m = radio.exec(html))) {
    const v = /\bvalue="([^"]*)"/.exec(m[0]);
    if (v) ids.push(v[1]);
  }
  return ids;
}

/**
 * The static checkout is baked at export time, and what the shop OFFERS can
 * change without a save: PayPal's keys arrive in the environment, or leave
 * it. A boot of a demo compares the payments on the exported page with the
 * ones offered now and republishes that one page when they differ. (The
 * shopper's script also rebuilds the choices from the live quote, so a
 * cached copy of the old page is right too.) The page is the store's own
 * checkout page, wherever the settings say it lives, and only while it is
 * published.
 */
function refreshDemoCheckout() {
  const store = require('./index');
  const s = store.settings.loadSettings();
  if (!s.open) return { refreshed: false, reason: 'the shop is closed' };
  const full = s.pages.checkout;
  const page = require('../pages').getPageByFullPath(full);
  if (!page || page.status !== 'published') return { refreshed: false, reason: 'the checkout page is not published' };
  const exporter = require('../export');
  const offered = store.paypal.offeredPayments(s).map((m) => m.id);
  const baked = bakedPayments(path.join(PUBLIC_DIR, exporter.publicHtmlName(full)));
  if (baked && baked.join('\n') === offered.join('\n')) return { refreshed: false, reason: 'the checkout already offers what the shop offers' };
  try {
    exporter.exportPage(full);
    console.log('[demo-store] checkout republished: it now offers ' + (offered.join(', ') || 'nothing'));
    return { refreshed: true };
  } catch (e) {
    console.error('[demo-store] checkout export failed: ' + e.message);
    return { refreshed: false, reason: e.message };
  }
}

// ── a shop that restocks itself and forgets its visitors ───────────────

function resetHours() {
  const n = Number(process.env.TAPUZ_DEMO_RESET_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

/** The stock version 2's catalog gives each product (or each of its options) that is counted. */
function catalogStock() {
  const out = [];
  const counted = (v) => /^\d+$/.test(String(v));
  for (const p of docOf(CATALOG).products) {
    if (p.variants.length) {
      for (const v of p.variants) if (counted(v.stock)) out.push({ sku: p.id, variant: v.id, stock: Number(v.stock) });
    } else if (counted(p.stock)) {
      out.push({ sku: p.id, variant: '', stock: Number(p.stock) });
    }
  }
  return out;
}

/**
 * A public fake shop sells itself out — three of this, one of that, and
 * anyone may order — and collects whatever name and phone a visitor types.
 * So, on a demo site, while the flag is set (the server calls this shortly
 * after boot and every hour):
 *   - an order older than TAPUZ_DEMO_RESET_HOURS (24) is cancelled through
 *     the orders module, which gives its stock and its coupon use back;
 *   - such an order then forgets who placed it — name, mail, phone, address
 *     and note, the same fields an erasure request clears. Its number, its
 *     items and its sums stay;
 *   - a demo product (or option) whose stock is below the catalog's number
 *     and that no order still holds is put back to that number.
 * An order younger than the window is never touched. Nothing runs without
 * the flag, and nothing runs on a site that is not a demo.
 * @returns {{ cancelled: number, scrubbed: number, restocked: number }}
 */
function housekeeping() {
  const out = { cancelled: 0, scrubbed: 0, restocked: 0 };
  if (process.env.TAPUZ_DEMO_STORE !== '1') return out;
  try {
    if (!isDemoSite()) return out;
    const store = require('./index');
    const { db } = require('../db');
    // julianday() reads both SQLite's own CURRENT_TIMESTAMP form and an ISO stamp
    const before = new Date(Date.now() - resetHours() * 60 * 60 * 1000).toISOString();

    const stale = db.prepare("SELECT number FROM store_orders WHERE status != 'cancelled' AND julianday(created_at) < julianday(?) ORDER BY id LIMIT 500").all(before);
    for (const o of stale) {
      try {
        store.orders.setStatus(o.number, 'cancelled', { notify: false, note: 'חנות ההדגמה מתאפסת' });
        out.cancelled++;
      } catch (e) {
        console.error('[demo-store] could not cancel order ' + o.number + ': ' + e.message);
      }
    }

    const forget = db.prepare(`
      UPDATE store_orders SET customer_name = 'נמחק — חנות הדגמה', customer_email = '', customer_phone = '',
        address = '{}', note = '', contact_id = NULL, erased = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    const known = db.prepare('SELECT id, number FROM store_orders WHERE erased = 0 AND julianday(created_at) < julianday(?) ORDER BY id LIMIT 500').all(before);
    for (const o of known) {
      try {
        // one order, by its number: an erasure by person (orders.eraseForSubject)
        // would reach that person's younger orders too
        if (typeof store.orders.eraseOrder === 'function') store.orders.eraseOrder(o.number);
        else {
          db.transaction(() => {
            forget.run(o.id);
            store.gateway.eraseForOrder(o.id);
            store.orders.addEvent(o.id, 'erased', 'פרטי המזמין נמחקו — חנות ההדגמה לא שומרת פרטי מבקרים');
          })();
        }
        out.scrubbed++;
      } catch (e) {
        console.error('[demo-store] could not scrub order ' + o.number + ': ' + e.message);
      }
    }

    const held = db.prepare(`
      SELECT 1 FROM store_order_items i JOIN store_orders o ON o.id = i.order_id
      WHERE o.status != 'cancelled' AND i.product_id = ? AND COALESCE(i.variant, '') = ? LIMIT 1
    `);
    for (const want of catalogStock()) {
      const p = store.catalog.getProductBySlug(want.sku);
      if (!p) continue;
      const row = want.variant ? p.variants.find((v) => v.code === want.variant) : p;
      // not counted (null) is the owner's choice and is left alone
      if (!row || row.stock === null || row.stock === undefined || row.stock >= want.stock) continue;
      if (held.get(p.id, want.variant)) continue;
      store.catalog.setStock(p.slug, want.variant, want.stock);
      out.restocked++;
    }

    if (out.cancelled || out.scrubbed || out.restocked) {
      console.log(`[demo-store] housekeeping: cancelled ${out.cancelled}, scrubbed ${out.scrubbed}, restocked ${out.restocked}`);
      // the sold-out marks on the static pages follow the stock that came back
      if (out.cancelled || out.restocked) store.scheduleRefresh();
    }
  } catch (e) {
    console.error('[demo-store] housekeeping failed: ' + e.message);
  }
  return out;
}

// ── boot ───────────────────────────────────────────────────────────────

/**
 * Boot entry. TAPUZ_DEMO_STORE=1 is the only arm. A pin is not an arm.
 * Never throws.
 * @returns {{ ran: boolean, reason?: string, version?: number, products?: number, homepage?: string, upgraded?: boolean, adopted?: boolean, parts?: object, checkout?: object }}
 */
function maybeDemoStore() {
  if (process.env.TAPUZ_DEMO_STORE !== '1') return { ran: false, reason: 'not armed' };
  try {
    const markers = readMarkers();
    if (markers.data[DEMO_V2_MARKER_ID]) {
      return { ran: false, reason: 'already applied', checkout: refreshDemoCheckout() };
    }
    if (markers.data[DEMO_MARKER_ID]) {
      return { ran: true, upgraded: true, parts: upgradeDemo().parts };
    }
    const files = filesystemProbe();
    if (!files.confident) {
      console.log('[demo-store] NOT applied: ' + files.reason);
      return { ran: false, reason: files.reason };
    }
    if (!files.empty) {
      if (!adoptUnmarkedV1(markers)) {
        console.log('[demo-store] NOT applied: ' + files.reason);
        return { ran: false, reason: files.reason };
      }
      console.log('[demo-store] adopted: an unmarked v1 demo');
      return { ran: true, adopted: true, upgraded: true, parts: upgradeDemo().parts };
    }
    const probe = require('../seed-content').inspectRoot();
    if (!probe.empty || !probe.confident) {
      console.log('[demo-store] NOT applied: ' + probe.reason);
      return { ran: false, reason: probe.reason };
    }
    const result = applyDemo();
    if (!result.ok) {
      console.log('[demo-store] NOT applied: ' + (result.message || result.code));
      return { ran: false, reason: result.message || result.code };
    }
    console.log('[demo-store] applied version=' + result.version + ' products=' + result.products + ' homepage=' + result.homepage);
    return { ran: true, version: result.version, products: result.products, homepage: result.homepage };
  } catch (e) {
    console.error('[demo-store] failed: ' + e.message);
    return { ran: false, reason: e.message };
  }
}

module.exports = {
  applyDemo,
  applyDemoV1,
  upgradeDemo,
  maybeDemoStore,
  housekeeping,
  isDemoSite,
  demoVersion,
  CATALOG,
  CATALOG_V1,
  DEMO_VERSION,
  DEMO_MARKER_ID,
  DEMO_V2_MARKER_ID
};
