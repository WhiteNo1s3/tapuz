'use strict';

/**
 * Tapuziel — send to Geppetto. A development-mode Figma plugin.
 *
 * The owner's own Figma does the reading, so no access token ever leaves the
 * desktop: the plugin serializes the current page (or the selected frames)
 * into one JSON that Tapuziel's import door understands
 * (src/geppetto/figma.js → fromPluginExport) and the UI offers it as a
 * download and a copy.
 *
 * The node shape is the REST API's — same field names, children nested — so
 * the decoder that reads GET /v1/files/:key reads this too. Pictures travel as
 * data: URLs keyed by the paint's imageRef (a JPG no wider than 1600 px, PNG
 * when the picture needs transparency); vectors as SVG data: URLs keyed by the
 * node id. Budget: the import door accepts 12 MB, so the export stops adding
 * pictures at 11 MB and says so in `notes` — the nodes stay, their imageRef
 * simply has no entry, and the importer notes each picture it skips.
 *
 * serializeNode() is pure (no Figma calls) so scripts/smoke-geppetto-figma.js
 * can feed it a mocked tree in Node; every Figma call sits in the async edge
 * (collectImages / collectVariables) or in the guarded bootstrap at the end.
 * The sandbox is a plain ES2019 engine: no optional chaining here on purpose.
 */

var EXPORT_FORMAT = 'tapuz-figma';
var EXPORT_VERSION = 1;
var MAX_IMAGE_BYTES = 5 * 1024 * 1024; // one picture
var MAX_TOTAL_BYTES = 11 * 1024 * 1024; // the whole JSON — the door stops at 12 MB
var RASTER_MAX_WIDTH = 1600;

var CONTAINER_TYPES = ['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET', 'SECTION'];
var VECTOR_TYPES = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON'];
var LAYOUT_FIELDS = ['layoutMode', 'itemSpacing', 'counterAxisSpacing', 'layoutWrap', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'primaryAxisAlignItems', 'counterAxisAlignItems', 'gridColumnCount', 'gridRowCount', 'gridColumnGap', 'gridRowGap'];
var TEXT_SEGMENT_FIELDS = ['fontName', 'fontSize', 'fontWeight', 'textDecoration', 'textCase', 'fills', 'hyperlink', 'listOptions', 'indentation', 'letterSpacing', 'lineHeight'];

function newContext(opts) {
  return { mixed: opts && opts.mixed, images: {}, rasters: [], vectors: [], notes: [], bytes: 0, seenHash: {}, videoNoted: false };
}

/** figma.mixed is a symbol that means "the property differs inside the node". */
function plain(ctx, v) {
  return ctx.mixed !== undefined && v === ctx.mixed ? undefined : v;
}

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

function rgba(c, a) {
  if (!c || !isNum(c.r)) return undefined;
  return { r: c.r, g: c.g, b: c.b, a: isNum(a) ? a : isNum(c.a) ? c.a : 1 };
}

function copyMatrix(m) {
  return Array.isArray(m) && m.length === 2 ? [m[0].slice(0, 3), m[1].slice(0, 3)] : undefined;
}

function rect(bb) {
  return bb ? { x: bb.x, y: bb.y, width: bb.width, height: bb.height } : undefined;
}

function strip(o) {
  var out = {};
  for (var k in o) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  return out;
}

/** A Plugin API paint → the REST paint (imageHash → imageRef, videoHash → videoRef). */
function serializePaint(p, ctx, node) {
  var base = { type: p.type, visible: p.visible !== false, opacity: isNum(p.opacity) ? p.opacity : 1 };
  if (p.type === 'SOLID') return strip(Object.assign(base, { color: rgba(p.color, 1) }));
  if (p.type === 'IMAGE') {
    var hash = p.imageHash || null;
    if (hash && base.visible && !ctx.seenHash[hash]) {
      ctx.seenHash[hash] = true;
      ctx.rasters.push({ hash: hash, node: node, paint: p });
    }
    return strip(Object.assign(base, { scaleMode: p.scaleMode, imageRef: hash, imageTransform: p.scaleMode === 'CROP' || p.scaleMode === 'STRETCH' ? copyMatrix(p.imageTransform) : undefined, rotation: p.rotation }));
  }
  if (p.type === 'VIDEO') {
    if (!ctx.videoNoted) {
      ctx.videoNoted = true;
      ctx.notes.push('videos are not exported — Figma gives plugins no video bytes; add them in Tapuziel');
    }
    return strip(Object.assign(base, { scaleMode: p.scaleMode, videoRef: p.videoHash || null }));
  }
  if (p.type && p.type.indexOf('GRADIENT') === 0) {
    return strip(Object.assign(base, {
      gradientStops: (p.gradientStops || []).map(function (s) { return { color: rgba(s.color), position: s.position }; }),
      gradientTransform: copyMatrix(p.gradientTransform)
    }));
  }
  return base;
}

function serializeEffect(e) {
  return strip({ type: e.type, visible: e.visible !== false, color: rgba(e.color), offset: e.offset ? { x: e.offset.x, y: e.offset.y } : undefined, radius: e.radius, spread: e.spread });
}

/** cornerRadius is figma.mixed when the corners differ; then the four are listed. */
function serializeRadii(node, ctx) {
  var r = plain(ctx, node.cornerRadius);
  if (isNum(r) && r > 0) return { cornerRadius: r, rectangleCornerRadii: [r, r, r, r] };
  var four = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius];
  if (four.every(isNum) && four.some(function (v) { return v > 0; })) return { cornerRadius: Math.max.apply(null, four), rectangleCornerRadii: four };
  return {};
}

function segmentStyle(seg) {
  var fn = seg.fontName || {};
  var link = seg.hyperlink && seg.hyperlink.value ? (seg.hyperlink.type === 'NODE' ? { type: 'NODE', nodeID: String(seg.hyperlink.value) } : { type: 'URL', url: String(seg.hyperlink.value) }) : undefined;
  var lh = seg.lineHeight && seg.lineHeight.unit === 'PIXELS' ? seg.lineHeight.value : undefined;
  return strip({
    fontFamily: fn.family || '',
    fontStyle: fn.style || '',
    fontPostScriptName: null,
    fontWeight: isNum(seg.fontWeight) ? seg.fontWeight : undefined,
    fontSize: isNum(seg.fontSize) ? seg.fontSize : undefined,
    italic: /italic|oblique/i.test(fn.style || ''),
    textCase: seg.textCase || 'ORIGINAL',
    textDecoration: seg.textDecoration || 'NONE',
    letterSpacing: seg.letterSpacing && isNum(seg.letterSpacing.value) ? seg.letterSpacing.value : undefined,
    lineHeightPx: lh,
    hyperlink: link,
    fills: Array.isArray(seg.fills) ? seg.fills.map(function (p) { return serializePaint(p, { mixed: undefined, seenHash: {}, rasters: [], notes: [], videoNoted: true }, null); }) : undefined
  });
}

/**
 * TEXT → the REST text fields. getStyledTextSegments() hands back runs with
 * their own style; the first run is the base style, every different run gets
 * an index in styleOverrideTable, and characterStyleOverrides names the index
 * of each UTF-16 unit (exactly how the REST file and the Sites bundle do it).
 */
function serializeText(node, ctx) {
  var characters = String(node.characters || '');
  var segments = [];
  try {
    segments = typeof node.getStyledTextSegments === 'function' ? node.getStyledTextSegments(TEXT_SEGMENT_FIELDS) : [];
  } catch (e) {
    segments = [];
  }
  if (!segments.length) segments = [{ start: 0, end: characters.length, characters: characters, fontName: plain(ctx, node.fontName), fontSize: plain(ctx, node.fontSize), fontWeight: plain(ctx, node.fontWeight), fills: plain(ctx, node.fills), textCase: plain(ctx, node.textCase), textDecoration: plain(ctx, node.textDecoration), hyperlink: plain(ctx, node.hyperlink), listOptions: null, indentation: 0 }];
  var base = segmentStyle(segments[0]);
  var baseKey = JSON.stringify(base);
  var table = {};
  var keys = {};
  var next = 1;
  var overrides = new Array(characters.length);
  for (var i = 0; i < overrides.length; i++) overrides[i] = 0;
  segments.forEach(function (seg) {
    var st = segmentStyle(seg);
    var key = JSON.stringify(st);
    var idx = 0;
    if (key !== baseKey) {
      if (keys[key] === undefined) {
        keys[key] = next++;
        table[keys[key]] = st;
      }
      idx = keys[key];
    }
    for (var c = seg.start; c < seg.end && c < overrides.length; c++) overrides[c] = idx;
  });
  var lineTypes = [];
  var lineIndentations = [];
  var pos = 0;
  characters.split('\n').forEach(function (line) {
    var seg = null;
    for (var s = 0; s < segments.length; s++) if (segments[s].start <= pos && pos < segments[s].end) { seg = segments[s]; break; }
    if (!seg) seg = segments[segments.length - 1];
    var lt = seg.listOptions && seg.listOptions.type ? seg.listOptions.type : 'NONE';
    lineTypes.push(lt === 'ORDERED' || lt === 'UNORDERED' ? lt : 'NONE');
    lineIndentations.push(isNum(seg.indentation) ? seg.indentation : 0);
    pos += line.length + 1;
  });
  var style = Object.assign({}, base, strip({
    textAlignHorizontal: plain(ctx, node.textAlignHorizontal),
    textAlignVertical: plain(ctx, node.textAlignVertical),
    textAutoResize: plain(ctx, node.textAutoResize)
  }));
  return { characters: characters, style: style, characterStyleOverrides: overrides, styleOverrideTable: table, lineTypes: lineTypes, lineIndentations: lineIndentations, fills: base.fills || [] };
}

/** node.reactions → REST interactions (only what a website can do: open a URL, go to a frame). */
function serializeInteractions(node) {
  var out = [];
  var reactions = Array.isArray(node.reactions) ? node.reactions : [];
  reactions.forEach(function (r) {
    if (!r || !r.trigger) return;
    var acts = Array.isArray(r.actions) ? r.actions : r.action ? [r.action] : [];
    var kept = [];
    acts.forEach(function (a) {
      if (!a) return;
      if (a.type === 'URL' && a.url) kept.push(strip({ type: 'URL', url: String(a.url), openInNewTab: !!a.openInNewTab }));
      else if (a.type === 'NODE' && a.destinationId) kept.push({ type: 'NODE', destinationId: String(a.destinationId), navigation: a.navigation || 'NAVIGATE' });
    });
    if (kept.length) out.push({ trigger: { type: r.trigger.type }, actions: kept });
  });
  return out;
}

/**
 * One Figma node → its REST-shaped plain object, children included. Pure:
 * pictures and vectors are only REGISTERED on ctx; collectImages fetches them.
 */
function serializeNode(node, ctx) {
  var n = { id: String(node.id), name: String(node.name || ''), type: String(node.type || '') };
  if (node.visible === false) {
    n.visible = false;
    return n;
  }
  if (isNum(node.opacity) && node.opacity < 1) n.opacity = node.opacity;
  var bb = node.absoluteBoundingBox;
  if (bb) n.absoluteBoundingBox = rect(bb);
  else if (isNum(node.x) && isNum(node.width)) n.absoluteBoundingBox = { x: node.x, y: node.y, width: node.width, height: node.height };
  var rt = copyMatrix(node.relativeTransform);
  if (rt) n.relativeTransform = rt;
  if (isNum(node.rotation) && node.rotation) n.rotation = node.rotation;
  if (isNum(node.width) && isNum(node.height)) n.size = { x: node.width, y: node.height };
  var fills = plain(ctx, node.fills);
  if (Array.isArray(fills) && node.type !== 'TEXT') n.fills = fills.map(function (p) { return serializePaint(p, ctx, node); });
  var strokes = plain(ctx, node.strokes);
  if (Array.isArray(strokes) && strokes.length) {
    n.strokes = strokes.map(function (p) { return serializePaint(p, ctx, node); });
    var sw = plain(ctx, node.strokeWeight);
    n.strokeWeight = isNum(sw) ? sw : Math.max(node.strokeTopWeight || 0, node.strokeRightWeight || 0, node.strokeBottomWeight || 0, node.strokeLeftWeight || 0);
    if (node.strokeAlign) n.strokeAlign = node.strokeAlign;
  }
  var effects = plain(ctx, node.effects);
  if (Array.isArray(effects) && effects.length) n.effects = effects.map(serializeEffect);
  Object.assign(n, serializeRadii(node, ctx));
  if (typeof node.clipsContent === 'boolean') n.clipsContent = node.clipsContent;
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    LAYOUT_FIELDS.forEach(function (k) {
      var v = node[k];
      if (v !== undefined && v !== null && v !== ctx.mixed) n[k] = v;
    });
  }
  if (node.layoutPositioning && node.layoutPositioning !== 'AUTO') n.layoutPositioning = node.layoutPositioning;
  if (isNum(node.layoutGrow) && node.layoutGrow > 0) n.layoutGrow = node.layoutGrow;
  if (node.layoutAlign && node.layoutAlign !== 'INHERIT') n.layoutAlign = node.layoutAlign;
  if (node.type === 'TEXT') Object.assign(n, serializeText(node, ctx));
  var interactions = serializeInteractions(node);
  if (interactions.length) n.interactions = interactions;
  if (VECTOR_TYPES.indexOf(node.type) !== -1) {
    n.svgRef = n.id;
    ctx.vectors.push(node);
  }
  if (Array.isArray(node.children)) n.children = node.children.map(function (c) { return serializeNode(c, ctx); });
  return n;
}

// ── the async edge: bytes ─────────────────────────────────────────────────

var PNG_MAGIC = [137, 80, 78, 71];

function sniffMime(bytes) {
  if (!bytes || bytes.length < 12) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  return 'image/png';
}

/** Does the original picture carry transparency? PNG colour types 3/4/6, GIF
 * and WebP may; a JPEG never does. Read from the first bytes only. */
function bytesHaveAlpha(bytes) {
  if (!bytes || bytes.length < 26) return false;
  var isPng = PNG_MAGIC.every(function (b, i) { return bytes[i] === b; });
  if (isPng) return bytes[25] === 3 || bytes[25] === 4 || bytes[25] === 6;
  return sniffMime(bytes) === 'image/gif' || sniffMime(bytes) === 'image/webp';
}

function needsAlpha(r, originalBytes) {
  var node = r.node;
  if (!node) return true;
  if (['RECTANGLE', 'FRAME', 'INSTANCE', 'COMPONENT'].indexOf(node.type) === -1) return true;
  if (isNum(node.cornerRadius) ? node.cornerRadius > 0 : (node.topLeftRadius || node.topRightRadius || node.bottomLeftRadius || node.bottomRightRadius)) return true;
  if ((isNum(r.paint.opacity) && r.paint.opacity < 1) || (isNum(node.opacity) && node.opacity < 1)) return true;
  return bytesHaveAlpha(originalBytes);
}

function mb(n) {
  return (n / (1024 * 1024)).toFixed(1);
}

function toDataUrl(api, mime, bytes) {
  return 'data:' + mime + ';base64,' + api.base64Encode(bytes);
}

/**
 * Fetch the registered pictures within the budget. A leaf node is exported as
 * displayed (its crop, at most 1600 px wide); a container whose fill is the
 * picture keeps the ORIGINAL bytes, because exporting it would bake its
 * children into the background. Vectors go out as SVG.
 */
async function collectImages(ctx, api) {
  var stopped = false;
  var over = function (what) {
    ctx.notes.push('the export reached the ' + mb(MAX_TOTAL_BYTES) + ' MB limit at "' + what + '" — the pictures from there on were left out; add them in Tapuziel');
    stopped = true;
  };
  for (var i = 0; i < ctx.rasters.length && !stopped; i++) {
    var r = ctx.rasters[i];
    var label = r.node && r.node.name ? r.node.name : r.hash;
    try {
      var original = null;
      try {
        var img = api.getImageByHash(r.hash);
        original = img ? await img.getBytesAsync() : null;
      } catch (e) {
        original = null;
      }
      var hasKids = !!(r.node && Array.isArray(r.node.children) && r.node.children.length);
      var bytes;
      var mime;
      if (hasKids || !r.node || typeof r.node.exportAsync !== 'function') {
        bytes = original;
        mime = sniffMime(bytes);
      } else {
        var png = needsAlpha(r, original);
        var w = Math.max(1, Math.min(RASTER_MAX_WIDTH, Math.round(r.node.width || RASTER_MAX_WIDTH)));
        bytes = await r.node.exportAsync({ format: png ? 'PNG' : 'JPG', constraint: { type: 'WIDTH', value: w } });
        mime = png ? 'image/png' : 'image/jpeg';
      }
      if (!bytes || !bytes.length) {
        ctx.notes.push('picture on "' + label + '" could not be read');
        continue;
      }
      if (bytes.length > MAX_IMAGE_BYTES) {
        ctx.notes.push('picture on "' + label + '" skipped: ' + mb(bytes.length) + ' MB is over the ' + mb(MAX_IMAGE_BYTES) + ' MB limit');
        continue;
      }
      var url = toDataUrl(api, mime, bytes);
      if (ctx.bytes + url.length > MAX_TOTAL_BYTES) {
        over(label);
        break;
      }
      ctx.images[r.hash] = url;
      ctx.bytes += url.length;
    } catch (e) {
      ctx.notes.push('picture on "' + label + '" could not be exported: ' + (e && e.message ? e.message : e));
    }
  }
  for (var v = 0; v < ctx.vectors.length && !stopped; v++) {
    var node = ctx.vectors[v];
    try {
      var svg = await node.exportAsync({ format: 'SVG' });
      var svgUrl = toDataUrl(api, 'image/svg+xml', svg);
      if (ctx.bytes + svgUrl.length > MAX_TOTAL_BYTES) {
        over(node.name || node.id);
        break;
      }
      ctx.images[String(node.id)] = svgUrl;
      ctx.bytes += svgUrl.length;
    } catch (e) {
      ctx.notes.push('vector "' + (node.name || node.id) + '" could not be exported: ' + (e && e.message ? e.message : e));
    }
  }
  return ctx;
}

/** Local COLOR variables → [{ name, hex }] (the puppet's palette); best effort. */
async function collectVariables(api) {
  var out = [];
  try {
    if (!api.variables || typeof api.variables.getLocalVariablesAsync !== 'function') return out;
    var vars = await api.variables.getLocalVariablesAsync('COLOR');
    for (var i = 0; i < vars.length; i++) {
      var v = vars[i];
      var coll = await api.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
      var value = coll ? v.valuesByMode[coll.defaultModeId] : null;
      var hops = 0;
      while (value && value.type === 'VARIABLE_ALIAS' && hops++ < 5) {
        var target = await api.variables.getVariableByIdAsync(value.id);
        var tc = target ? await api.variables.getVariableCollectionByIdAsync(target.variableCollectionId) : null;
        value = target && tc ? target.valuesByMode[tc.defaultModeId] : null;
      }
      if (value && isNum(value.r)) {
        var hex = '#' + [value.r, value.g, value.b].map(function (c) { return ('0' + Math.round(c * 255).toString(16)).slice(-2); }).join('');
        out.push({ name: String(v.name || ''), hex: hex });
      }
    }
  } catch (e) {
    return out;
  }
  return out;
}

function assembleExport(parts) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    fileName: parts.fileName || '',
    fileKey: parts.fileKey || '',
    exportedAt: parts.exportedAt || new Date().toISOString(),
    pages: parts.pages || [],
    images: parts.images || {},
    variables: parts.variables || [],
    notes: parts.notes || []
  };
}

/** The frames to export: the selection, or every top-level container of the page. */
function pickNodes(page, scope) {
  var nodes = scope === 'selection' && page.selection ? page.selection.slice() : [];
  if (!nodes.length) nodes = (page.children || []).filter(function (n) { return CONTAINER_TYPES.indexOf(n.type) !== -1 && n.visible !== false; });
  return nodes;
}

async function buildExport(api, scope) {
  var page = api.currentPage;
  var nodes = pickNodes(page, scope);
  if (!nodes.length) throw new Error('Nothing to export: select a frame, or add one to this page.');
  var ctx = newContext({ mixed: api.mixed });
  var frames = nodes.map(function (n) { return serializeNode(n, ctx); });
  await collectImages(ctx, api);
  var variables = await collectVariables(api);
  return assembleExport({
    fileName: api.root && api.root.name ? api.root.name : '',
    fileKey: api.fileKey || '',
    pages: [{ id: String(page.id), name: String(page.name || ''), frames: frames }],
    images: ctx.images,
    variables: variables,
    notes: ctx.notes
  });
}

// ── bootstrap (inside Figma only) ─────────────────────────────────────────

if (typeof figma !== 'undefined' && figma && typeof figma.showUI === 'function') {
  figma.showUI(__html__, { width: 380, height: 500, themeColors: true });
  figma.ui.onmessage = async function (msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'close') {
      figma.closePlugin();
      return;
    }
    if (msg.type !== 'export') return;
    try {
      figma.ui.postMessage({ type: 'progress', text: 'Reading the ' + (msg.scope === 'selection' ? 'selection' : 'page') + '…' });
      var json = await buildExport(figma, msg.scope);
      var text = JSON.stringify(json);
      figma.ui.postMessage({
        type: 'export',
        text: text,
        fileName: (json.fileName || 'figma').replace(/[^\w.-]+/g, '-').toLowerCase() + '.tapuz-figma.json',
        stats: { frames: json.pages[0].frames.length, images: Object.keys(json.images).length, bytes: text.length, notes: json.notes }
      });
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: String(e && e.message ? e.message : e) });
    }
  };
  figma.ui.postMessage({ type: 'ready', page: figma.currentPage.name, selection: figma.currentPage.selection.length });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EXPORT_FORMAT: EXPORT_FORMAT,
    EXPORT_VERSION: EXPORT_VERSION,
    MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
    MAX_TOTAL_BYTES: MAX_TOTAL_BYTES,
    RASTER_MAX_WIDTH: RASTER_MAX_WIDTH,
    newContext: newContext,
    serializeNode: serializeNode,
    serializeText: serializeText,
    serializeInteractions: serializeInteractions,
    collectImages: collectImages,
    collectVariables: collectVariables,
    assembleExport: assembleExport,
    pickNodes: pickNodes,
    buildExport: buildExport
  };
}
