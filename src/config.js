// Simple site config for Tapuz
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'site.json');

const DEFAULT_CONFIG = {
  title: "Tapuz",
  description: "אתר בנוי עם Tapuz CMS",
  baseUrl: "",
  defaultTheme: "default",
  language: "he"
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch (e) {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

module.exports = {
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG
};
