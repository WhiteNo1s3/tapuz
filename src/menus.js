const fs = require('fs');
const path = require('path');

const MENUS_PATH = path.join(__dirname, '..', 'config', 'menus.json');

function loadMenus() {
  try {
    if (fs.existsSync(MENUS_PATH)) {
      return JSON.parse(fs.readFileSync(MENUS_PATH, 'utf8'));
    }
  } catch (e) {}
  return {
    main: [
      { label: "דף הבית", url: "/" }
    ],
    footer: []
  };
}

function saveMenus(menus) {
  const dir = path.dirname(MENUS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MENUS_PATH, JSON.stringify(menus, null, 2), 'utf8');
}

function getMenu(name = 'main') {
  const menus = loadMenus();
  return menus[name] || [];
}

module.exports = {
  loadMenus,
  saveMenus,
  getMenu
};
