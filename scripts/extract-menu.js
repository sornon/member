#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = path.resolve(__dirname, '../docs/lacasa-menu.html');
const OUTPUT_JSON = path.resolve(__dirname, '../miniprogram/shared/menu-data.json');
const OUTPUT_JS = path.resolve(__dirname, '../miniprogram/shared/menu-data.js');

function extractArray(code, name) {
  const pattern = new RegExp(`const\\s+${name}\\s*=\\s*(\\[[\\s\\S]*?\n\]);`);
  const match = code.match(pattern);
  if (!match) {
    throw new Error(`Unable to locate constant ${name} in menu source`);
  }
  const sandbox = { result: null };
  vm.createContext(sandbox);
  const script = new vm.Script(`result = ${match[1]}`);
  script.runInContext(sandbox, { timeout: 1000 });
  if (!Array.isArray(sandbox.result)) {
    throw new Error(`${name} is not an array after evaluation`);
  }
  return sandbox.result;
}

function main() {
  const html = fs.readFileSync(SOURCE, 'utf8');
  const categories = extractArray(html, 'CATS');
  const items = extractArray(html, 'MENU');
  const softDrinks = extractArray(html, 'SOFT_DRINKS');

  const payload = { categories, items, softDrinks, generatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(payload, null, 2), 'utf8');

  const jsContent = `export const menuData = ${JSON.stringify(payload, null, 2)};\nexport const categories = menuData.categories;\nexport const items = menuData.items;\nexport const softDrinks = menuData.softDrinks;\nexport default menuData;\n`;
  fs.writeFileSync(OUTPUT_JS, jsContent, 'utf8');
}

main();
