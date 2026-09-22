'use strict';

/**
 * A design's fonts, made loadable (v2.56).
 *
 * Canva and Figma draw with hundreds of families; a Tapuziel theme loads
 * web fonts from Google Fonts only (theme.js — no font files are copied
 * from a design tool: Canva's own faces are licensed to Canva, not to the
 * site). So every family a design uses is answered with a Google family:
 * the same one when Google has it, the closest cousin when it does not
 * ("Canva Sans" → "DM Sans", "The Seasons" → "Playfair Display"), and a
 * category fallback when the name says nothing. A Hebrew design gets a
 * Hebrew-capable face (the theme's own shelf), because a Latin-only font
 * would drop every Hebrew letter to the system font.
 *
 * The map is data, not code — extend it when a design shows a family it
 * does not know, and the report says which families were substituted.
 */

// The families a theme can load: the Hebrew shelf and the Latin faces in
// src/theme.js (ONE list — a family mapped here that the theme cannot load
// would be a promise the site breaks).
let shelf = null;
function shelfLower() {
  if (!shelf) {
    const theme = require('../theme');
    shelf = new Map(Object.keys(theme.GOOGLE_FONTS).concat(Object.keys(theme.LATIN_FONTS)).map((f) => [f.toLowerCase(), f]));
  }
  return shelf;
}

// Families that are NOT on Google Fonts, answered with the closest Google cousin.
const COUSINS = {
  'canva sans': 'DM Sans', 'canva student font': 'Nunito', 'open sauce': 'Inter', 'open sauce one': 'Inter',
  'glacial indifference': 'Didact Gothic', 'tt hoves': 'Inter', 'tt norms': 'Nunito Sans', 'tt commons': 'Inter',
  'the seasons': 'Playfair Display', 'hatton': 'Playfair Display', 'garet': 'Montserrat', 'now': 'Montserrat',
  'kollektif': 'Montserrat', 'luciole': 'Atkinson Hyperlegible', 'codec pro': 'Nunito Sans', 'agrandir': 'Syne',
  'horizon': 'Michroma', 'brittany signature': 'Great Vibes', 'playlist script': 'Dancing Script',
  'more sugar': 'Fredoka', 'chloe': 'Cormorant', 'aileron': 'Inter', 'bogart': 'Fraunces', 'league spartan bold': 'League Spartan',
  'canva serif': 'Lora', 'dream avenue': 'Playfair Display', 'kiona': 'Montserrat', 'coco gothic': 'Poppins',
  'helvetica': 'Inter', 'helvetica neue': 'Inter', 'arial': 'Arimo', 'times new roman': 'Tinos', 'georgia': 'Lora',
  'futura': 'Jost', 'gotham': 'Montserrat', 'proxima nova': 'Figtree', 'avenir': 'Nunito Sans', 'avenir next': 'Nunito Sans',
  'sf pro': 'Inter', 'sf pro display': 'Inter', 'sf pro text': 'Inter', 'gilroy': 'Plus Jakarta Sans', 'circular': 'DM Sans',
  'graphik': 'Inter', 'neue haas grotesk': 'Inter', 'aktiv grotesk': 'Inter', 'suisse intl': 'Inter', 'sohne': 'Inter',
  'garamond': 'EB Garamond', 'baskerville': 'Libre Baskerville', 'didot': 'Bodoni Moda', 'bodoni': 'Bodoni Moda',
  'caslon': 'Libre Caslon Text', 'courier': 'Courier Prime', 'courier new': 'Courier Prime', 'menlo': 'Roboto Mono',
  'monaco': 'Roboto Mono', 'consolas': 'Inconsolata', 'segoe ui': 'Open Sans', 'calibri': 'Open Sans',
  'century gothic': 'Questrial', 'trebuchet ms': 'Fira Sans', 'verdana': 'PT Sans', 'tahoma': 'PT Sans',
  'brush script mt': 'Dancing Script', 'lucida handwriting': 'Kalam', 'rockwell': 'Roboto Slab', 'impact': 'Anton',
  // Canva's script and display faces, read back from real exports (their
  // names say nothing about their style, so the category guess cannot help)
  'halimun': 'Kaushan Script', 'hello paris': 'Great Vibes', 'amsterdam four': 'Great Vibes', 'magnolia script': 'Great Vibes',
  'beautiful script': 'Great Vibes', 'the nautigal': 'Great Vibes', 'sloop script': 'Great Vibes', 'la luxes script': 'Great Vibes',
  'autography': 'Sacramento', 'sunday': 'Satisfy', 'shelley script': 'Great Vibes', 'montserrat classic': 'Montserrat',
  'lemon milk': 'Montserrat', 'brandon grotesque': 'Raleway', 'lovelace': 'Playfair Display', 'arsenica': 'Fraunces',
  'aileron black': 'Inter', 'bw modelica': 'Plus Jakarta Sans', 'cooper hewitt': 'Work Sans', 'serenity': 'Cormorant',
  'bodoni fldisplay': 'Bodoni Moda', 'nexa': 'Montserrat', 'sanchez': 'Roboto Slab', 'league script': 'Dancing Script'
};

// Hebrew-capable answers (the theme's Hebrew shelf) by category.
const HEBREW = { sans: 'Heebo', serif: 'Frank Ruhl Libre', display: 'Secular One', script: 'Amatic SC', mono: 'Noto Sans Hebrew', rounded: 'Varela Round' };
const LATIN_FALLBACK = { sans: 'Inter', serif: 'Lora', display: 'Playfair Display', script: 'Dancing Script', mono: 'Space Mono', rounded: 'Nunito' };

const SERIF_HINT = /serif(?!.*sans)|garamond|baskerville|caslon|bodoni|didot|playfair|lora|merriweather|times|georgia|roman|cormorant|fraunces|prata|spectral|vollkorn|crimson|lustria|quattrocento(?! sans)|seasons|hatton|tinos|frank ruhl|david|slab/i;
const SCRIPT_HINT = /script|signature|hand|brush|vibes|allura|pacifico|satisfy|sacramento|parisienne|calligraph|marker|caveat|kalam|amatic/i;
const MONO_HINT = /mono|code|courier|typewriter|console|lekton/i;
const DISPLAY_HINT = /display|poster|black|fatface|bebas|anton|oswald|league gothic|headline|stencil/i;

function category(family) {
  const f = String(family || '');
  if (MONO_HINT.test(f)) return 'mono';
  if (SCRIPT_HINT.test(f)) return 'script';
  if (SERIF_HINT.test(f)) return 'serif';
  if (DISPLAY_HINT.test(f)) return 'display';
  if (/round/i.test(f)) return 'rounded';
  return 'sans';
}

/** 'Josefin Sans Regular' / 'Montserrat-Bold' / 'Inter: Semi Bold' → the family name. */
function cleanFamily(raw) {
  return String(raw || '')
    .replace(/["']/g, '')
    .split(':')[0]
    .replace(/[-_]/g, ' ')
    .replace(/\b(regular|italic|bold|semi ?bold|extra ?bold|light|thin|medium|black|heavy|book|oblique|variable|vf|web)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const GOOGLE_HEBREW = new Set(['Heebo', 'Rubik', 'Assistant', 'Varela Round', 'Frank Ruhl Libre', 'Secular One', 'Suez One', 'Alef',
  'Amatic SC', 'Karantina', 'Miriam Libre', 'David Libre', 'Noto Sans Hebrew', 'Noto Serif Hebrew', 'Noto Rashi Hebrew',
  'Bellefair', 'Arimo', 'Tinos', 'Bona Nova', 'Open Sans', 'IBM Plex Sans']);

/**
 * The Google family that answers a design family.
 * @param {string} family the design's own family name
 * @param {{ hebrew?: boolean }} [opts] the text is Hebrew → only Hebrew-capable faces
 * @returns {{ family: string, exact: boolean, from: string, category: string }}
 */
function mapFamily(family, opts = {}) {
  const from = String(family || '').trim();
  const clean = cleanFamily(from);
  const cat = category(clean || from);
  const pick = (name, exact) => ({ family: name, exact, from, category: cat });
  const direct = shelfLower().get(clean.toLowerCase()) || shelfLower().get(from.toLowerCase());
  if (direct && (!opts.hebrew || GOOGLE_HEBREW.has(direct))) return pick(direct, direct.toLowerCase() === from.toLowerCase() || direct.toLowerCase() === clean.toLowerCase());
  if (opts.hebrew) return pick(HEBREW[cat] || HEBREW.sans, false);
  const cousin = COUSINS[clean.toLowerCase()] || COUSINS[from.toLowerCase()];
  if (cousin) return pick(cousin, false);
  if (direct) return pick(direct, true);
  return pick(LATIN_FALLBACK[cat] || LATIN_FALLBACK.sans, false);
}

/** The CSS stack a theme writes for a mapped family. */
function stackFor(mapped) {
  const tail = {
    serif: 'Georgia, "Times New Roman", serif',
    script: 'cursive',
    mono: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
    display: 'system-ui, sans-serif',
    rounded: 'system-ui, sans-serif',
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'
  }[mapped.category] || 'sans-serif';
  return `"${mapped.family}", ${tail}`;
}

module.exports = { COUSINS, GOOGLE_HEBREW, mapFamily, stackFor, cleanFamily, category, shelfLower };
