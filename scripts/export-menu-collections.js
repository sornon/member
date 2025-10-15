#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DRINKS_DAY_ORDER = [
  'coffee',
  'snack',
  'ws',
  'sig',
  'soft',
  'rose',
  'white',
  'red',
  'rum',
  'rare',
  'easter'
];

const DRINKS_NIGHT_ORDER = [
  'ws',
  'sig',
  'rum',
  'snack',
  'white',
  'red',
  'rose',
  'rare',
  'soft',
  'coffee',
  'easter'
];

function printUsageAndExit(message) {
  if (message) {
    console.error(`\n${message}\n`);
  }
  console.error(`Usage: node export-menu-collections.js --source <menu-data.js> [--out <dir>]`);
  process.exit(1);
}

function resolveOptions(argv) {
  const options = {};
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--source' || arg === '-s') {
      const value = args[i + 1];
      if (!value) {
        printUsageAndExit('Missing value for --source');
      }
      options.source = value;
      i += 1;
      continue;
    }
    if (arg === '--out' || arg === '-o') {
      const value = args[i + 1];
      if (!value) {
        printUsageAndExit('Missing value for --out');
      }
      options.outputDir = value;
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsageAndExit();
    }
    printUsageAndExit(`Unknown argument: ${arg}`);
  }
  return options;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function getDrinkCategoryOrder(now = new Date()) {
  const hour = now.getHours();
  return hour >= 9 && hour < 17 ? DRINKS_DAY_ORDER : DRINKS_NIGHT_ORDER;
}

function sortDrinkCategories(categories, now = new Date()) {
  if (!Array.isArray(categories)) {
    return [];
  }
  const order = getDrinkCategoryOrder(now);
  const position = order.reduce((acc, id, index) => {
    acc[id] = index;
    return acc;
  }, {});
  return [...categories].sort((a, b) => {
    const indexA = position[a.id];
    const indexB = position[b.id];
    if (typeof indexA === 'number' && typeof indexB === 'number') {
      return indexA - indexB;
    }
    if (typeof indexA === 'number') {
      return -1;
    }
    if (typeof indexB === 'number') {
      return 1;
    }
    return 0;
  });
}

function extractSectionsFromRaw(raw, now = new Date()) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw.sections) && raw.sections.length) {
    return raw.sections
      .map((section) => {
        const id = typeof section.id === 'string' ? section.id.trim() : '';
        const title = typeof section.title === 'string' ? section.title.trim() : '';
        if (!id || !title) {
          return null;
        }
        const categories = ensureArray(section.categories);
        return {
          id,
          title,
          categories: id === 'drinks' ? sortDrinkCategories(categories, now) : categories,
          items: ensureArray(section.items),
          extras: ensureArray(section.extras)
        };
      })
      .filter(Boolean);
  }
  const sections = [];
  const drinksCategories = ensureArray(raw.categories);
  const drinksItems = ensureArray(raw.items);
  const legacySoftDrinks = ensureArray(raw.softDrinks);
  if (drinksCategories.length || drinksItems.length || legacySoftDrinks.length) {
    sections.push({
      id: 'drinks',
      title: '酒水',
      categories: sortDrinkCategories(drinksCategories, now),
      items: drinksItems,
      extras: legacySoftDrinks.map((drink) => ({
        item: {
          ...drink,
          desc: drink.desc || '',
          img: drink.img || ''
        },
        overrides: { cat: (drink.cat || drink.categoryId || 'soft').trim() || 'soft' }
      }))
    });
  }
  const diningCategories = ensureArray(raw.diningCategories);
  const diningItems = ensureArray(raw.diningItems);
  if (diningCategories.length || diningItems.length) {
    sections.push({
      id: 'dining',
      title: '用餐',
      categories: diningCategories,
      items: diningItems,
      extras: []
    });
  }
  return sections;
}

function normalizeCategory(category) {
  if (!category || typeof category !== 'object') {
    return null;
  }
  const id = typeof category.id === 'string' ? category.id.trim() : '';
  const name = typeof category.name === 'string' ? category.name.trim() : '';
  if (!id || !name) {
    return null;
  }
  const sortOrder = Number.isFinite(category.sortOrder) ? Number(category.sortOrder) : null;
  return { id, name, sortOrder };
}

function normalizeItem(rawItem, defaults = {}) {
  if (!rawItem || typeof rawItem !== 'object') {
    return null;
  }
  const itemId = typeof rawItem.id === 'string' ? rawItem.id.trim() : '';
  const categoryId = typeof rawItem.cat === 'string'
    ? rawItem.cat.trim()
    : typeof rawItem.categoryId === 'string'
    ? rawItem.categoryId.trim()
    : typeof defaults.categoryId === 'string'
    ? defaults.categoryId.trim()
    : '';
  const sectionId = typeof rawItem.section === 'string'
    ? rawItem.section.trim()
    : typeof defaults.sectionId === 'string'
    ? defaults.sectionId.trim()
    : '';
  const title = typeof rawItem.title === 'string' ? rawItem.title.trim() : '';
  if (!itemId || !sectionId || !categoryId || !title) {
    return null;
  }
  const minQuantitySource = [
    rawItem.minQuantity,
    rawItem.minimum,
    rawItem.min,
    rawItem.minQty,
    defaults.minQuantity,
    1
  ];
  const minQuantity = minQuantitySource.reduce((acc, value) => {
    if (Number.isFinite(acc) && acc > 0) {
      return acc;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.floor(numeric);
    }
    return acc;
  }, NaN);

  const normalized = {
    sectionId,
    categoryId,
    itemId,
    title,
    desc: typeof rawItem.desc === 'string' ? rawItem.desc.trim() : '',
    img: typeof rawItem.img === 'string' ? rawItem.img.trim() : '',
    status: rawItem.status === 'inactive' ? 'inactive' : 'active',
    sortOrder: Number.isFinite(rawItem.sortOrder) ? Number(rawItem.sortOrder) : null,
    minQuantity: Number.isFinite(minQuantity) && minQuantity > 0 ? minQuantity : 1,
    variants: Array.isArray(rawItem.variants)
      ? rawItem.variants.map((variant) => ({
          label: typeof variant.label === 'string' ? variant.label.trim() : '',
          unit: typeof variant.unit === 'string' ? variant.unit.trim() : '',
          price: Number.isFinite(variant.price) ? Number(variant.price) : 0
        }))
      : []
  };
  normalized.variants = normalized.variants.filter((variant) => variant.label && variant.unit && variant.price > 0);
  if (!normalized.variants.length) {
    return null;
  }
  return normalized;
}

function buildDocuments(raw) {
  const now = new Date();
  const generatedAt = now.toISOString();
  const sections = extractSectionsFromRaw(raw, now);
  const sectionDocs = [];
  const categoryDocs = [];
  const itemDocs = [];

  sections.forEach((section, sectionIndex) => {
    const sectionId = section.id;
    const sectionName = section.title;
    const sectionDoc = {
      _id: sectionId,
      sectionId,
      name: sectionName,
      sortOrder: section.sortOrder || (sectionIndex + 1) * 100,
      status: section.status === 'inactive' ? 'inactive' : 'active',
      createdAt: generatedAt
    };
    sectionDocs.push(sectionDoc);

    const categories = ensureArray(section.categories)
      .map((cat) => normalizeCategory(cat))
      .filter(Boolean);
    categories.forEach((category, categoryIndex) => {
      const categoryDoc = {
        _id: `${sectionId}_${category.id}`,
        sectionId,
        categoryId: category.id,
        name: category.name,
        sortOrder:
          Number.isFinite(category.sortOrder) && category.sortOrder !== null
            ? category.sortOrder
            : (categoryIndex + 1) * 100,
        status: 'active',
        createdAt: generatedAt
      };
      if (sectionId === 'drinks') {
        const dayIndex = DRINKS_DAY_ORDER.indexOf(category.id);
        if (dayIndex >= 0) {
          categoryDoc.daySortOrder = (dayIndex + 1) * 100;
        }
        const nightIndex = DRINKS_NIGHT_ORDER.indexOf(category.id);
        if (nightIndex >= 0) {
          categoryDoc.nightSortOrder = (nightIndex + 1) * 100;
        }
      }
      categoryDocs.push(categoryDoc);
    });

    const normalizedItems = [];
    ensureArray(section.items).forEach((item, index) => {
      const normalized = normalizeItem(item, {
        sectionId,
        categoryId: item.cat,
        sortOrder: (index + 1) * 100
      });
      if (normalized) {
        if (!Number.isFinite(normalized.sortOrder) || normalized.sortOrder === null) {
          normalized.sortOrder = (index + 1) * 100;
        }
        normalizedItems.push(normalized);
      }
    });

    ensureArray(section.extras).forEach((extra, extraIndex) => {
      if (!extra) {
        return;
      }
      if (extra.item) {
        const overrides = extra.overrides || {};
        const normalized = normalizeItem(
          { ...extra.item, ...overrides },
          {
            sectionId,
            categoryId: overrides.cat || extra.item.cat,
            minQuantity: overrides.minQuantity || extra.item.minQuantity,
            sortOrder: (normalizedItems.length + extraIndex + 1) * 100
          }
        );
        if (normalized) {
          if (!Number.isFinite(normalized.sortOrder) || normalized.sortOrder === null) {
            normalized.sortOrder = (normalizedItems.length + extraIndex + 1) * 100;
          }
          normalizedItems.push(normalized);
        }
      } else {
        const normalized = normalizeItem(extra, {
          sectionId,
          categoryId: extra.cat,
          sortOrder: (normalizedItems.length + extraIndex + 1) * 100
        });
        if (normalized) {
          if (!Number.isFinite(normalized.sortOrder) || normalized.sortOrder === null) {
            normalized.sortOrder = (normalizedItems.length + extraIndex + 1) * 100;
          }
          normalizedItems.push(normalized);
        }
      }
    });

    normalizedItems.forEach((item, itemIndex) => {
      const doc = {
        _id: `${sectionId}_${item.categoryId}_${item.itemId}`,
        sectionId,
        categoryId: item.categoryId,
        itemId: item.itemId,
        title: item.title,
        desc: item.desc,
        img: item.img,
        variants: item.variants,
        minQuantity: item.minQuantity,
        sortOrder: Number.isFinite(item.sortOrder) && item.sortOrder !== null ? item.sortOrder : (itemIndex + 1) * 100,
        status: item.status === 'inactive' ? 'inactive' : 'active',
        createdAt: generatedAt
      };
      itemDocs.push(doc);
    });
  });

  return { sectionDocs, categoryDocs, itemDocs };
}

function loadLegacyMenu(filePath) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Menu file not found: ${absolute}`);
  }
  const content = fs.readFileSync(absolute, 'utf8');
  const match = content.match(/export\s+const\s+menuData\s*=\s*(\{[\s\S]*?\});/);
  if (!match) {
    throw new Error('Unable to locate `export const menuData = {...}` in source file');
  }
  let jsonText = match[1];
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Failed to parse menu data as JSON: ${error.message}`);
  }
}

function main() {
  const options = resolveOptions(process.argv);
  const source = options.source
    ? path.resolve(options.source)
    : path.resolve(__dirname, '../miniprogram/shared/menu-data.legacy.js');
  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.resolve(__dirname, '../dist/menu-catalog-seed');

  const rawMenu = loadLegacyMenu(source);
  const { sectionDocs, categoryDocs, itemDocs } = buildDocuments(rawMenu);

  if (!sectionDocs.length) {
    throw new Error('No section data found in legacy menu file');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'menuSections.json'), sectionDocs.map((doc) => JSON.stringify(doc)).join('\n'), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'menuCategories.json'), categoryDocs.map((doc) => JSON.stringify(doc)).join('\n'), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'menuItems.json'), itemDocs.map((doc) => JSON.stringify(doc)).join('\n'), 'utf8');

  console.log('Generated seed files:');
  console.log(` - ${path.join(outputDir, 'menuSections.json')}`);
  console.log(` - ${path.join(outputDir, 'menuCategories.json')}`);
  console.log(` - ${path.join(outputDir, 'menuItems.json')}`);
}

try {
  main();
} catch (error) {
  console.error(`\n[export-menu-collections] ${error.message}`);
  process.exit(1);
}
