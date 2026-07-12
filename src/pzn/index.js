'use strict';

/**
 * benTML public API
 * -----------------
 * Invent the wheel: implement HTML as a language, while it is all HTML.
 */

const { parse } = require('./language/parse');
const { serialize, serializeFragment } = require('./language/serialize');
const { compile, compileFragment } = require('./language/compile');
const { validate, isValid } = require('./language/validate');
const ast = require('./language/ast');
const { BentError } = require('./language/errors');
const registry = require('./modules/registry');
const schemaApi = require('./builder/schema-api');
const ops = require('./builder/ops');
const bridge = require('./bridge/tapuz-json');
const site = require('./site/publish');
const siteBuild = require('./site/build');
const siteManifest = require('./site/manifest');
const loader = require('./loader/pzn-loader');
const commands = require('./modules/commands');

/**
 * Convenience: source string → public HTML
 * @param {string} source
 * @param {object} [context]
 */
function build(source, context) {
  const doc = parse(source);
  return compile(doc, context);
}

module.exports = {
  // language (benTML dialect; files are .pzn)
  parse,
  serialize,
  serializeFragment,
  compile,
  compileFragment,
  validate,
  isValid,
  build,
  BentError,
  ast,

  // modules
  getModule: registry.getModule,
  listModules: registry.listModules,
  moduleNames: registry.moduleNames,

  // page builder standard
  getToolbox: schemaApi.getToolbox,
  getSchema: schemaApi.getSchema,
  getAllSchemas: schemaApi.getAllSchemas,
  getDocumentSchema: schemaApi.getDocumentSchema,
  ops,

  // commands + perks (every module wired for agents)
  getCommand: commands.getCommand,
  getCommandCatalog: commands.getCommandCatalog,
  getAgentCommandSheet: commands.getAgentCommandSheet,

  // PZN loader — accept or build with user; visualize; no HTML source
  loadPzn: loader.loadPzn,
  loadBlank: loader.loadBlank,
  acceptPzn: loader.acceptPzn,
  applySource: loader.applySource,
  insertModule: loader.insertModule,
  buildPreviewHtml: loader.buildPreviewHtml,
  BLANK_PZN: loader.BLANK_PZN,
  PREVIEW_THEME_CSS: loader.PREVIEW_THEME_CSS,

  // site publish (single-dir pages → html, no manifest)
  publicFileName: site.publicFileName,
  compilePage: site.compilePage,
  publishSite: site.publishSite,

  // real site build (site.json manifest + .pzn + theme → public/)
  buildSite: siteBuild.buildSite,
  initSite: siteBuild.initSite,
  loadManifest: siteManifest.loadManifest,
  validateManifest: siteManifest.validateManifest,
  defaultManifest: siteManifest.defaultManifest,
  manifestRuntimeInfo: siteManifest.manifestRuntimeInfo,

  // bridge from Tapuz JSON era
  fromTapuzPage: bridge.fromTapuzPage,
  blockToModule: bridge.blockToModule
};
