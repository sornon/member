const MENU_VERSION = '2024-03-01';

const CATEGORIES = [
  {
    id: 'signature',
    name: '招牌必点',
    description: '老饕挚爱的镇店之作',
    order: 1
  },
  {
    id: 'hot-dishes',
    name: '热菜',
    description: '现点现做的热菜佳肴',
    order: 2
  },
  {
    id: 'snacks',
    name: '小食',
    description: '佐酒拍档或是间歇小点',
    order: 3
  },
  {
    id: 'drinks',
    name: '酒水茶饮',
    description: '醒神润喉的杯中物',
    order: 4
  }
];

const ITEMS = [
  {
    id: 'signature-snowflake-beef',
    categoryId: 'signature',
    name: '雪花牛小排',
    description: '特选谷饲雪花牛排，铁板急火锁汁。',
    price: 12800,
    unit: '份',
    spicy: 1,
    tags: ['牛肉', '铁板']
  },
  {
    id: 'signature-cherry-duck',
    categoryId: 'signature',
    name: '樱桃烟熏鸭胸',
    description: '低温慢煮配以桂花蜜酱，入口即化。',
    price: 9800,
    unit: '份',
    spicy: 0,
    tags: ['禽类']
  },
  {
    id: 'signature-matsutake-soup',
    categoryId: 'signature',
    name: '松茸灵芝汤',
    description: '云南鲜松茸搭配灵芝文火煨制，清润暖胃。',
    price: 16800,
    unit: '盅',
    spicy: 0,
    tags: ['汤品']
  },
  {
    id: 'hot-dishes-pepper-fish',
    categoryId: 'hot-dishes',
    name: '藤椒青麻鲜鱼',
    description: '高原冷水鱼佐以藤椒秘制油，麻香爽口。',
    price: 11800,
    unit: '份',
    spicy: 2,
    tags: ['鱼类', '川味']
  },
  {
    id: 'hot-dishes-black-garlic-ribs',
    categoryId: 'hot-dishes',
    name: '黑蒜慢炖排骨',
    description: '黑蒜酱汁裹匀排骨，慢火入味骨肉脱离。',
    price: 8800,
    unit: '份',
    spicy: 0,
    tags: ['猪肉', '炖菜']
  },
  {
    id: 'hot-dishes-seasonal-veg',
    categoryId: 'hot-dishes',
    name: '时蔬三味',
    description: '精选当季蔬菜，蒜蓉/清炒/白灼三种做法。',
    price: 5200,
    unit: '份',
    spicy: 0,
    tags: ['素食']
  },
  {
    id: 'snacks-truffle-fries',
    categoryId: 'snacks',
    name: '松露薯条',
    description: '法芙娜松露酱拌匀手切薯条，酥香迷人。',
    price: 3600,
    unit: '篮',
    spicy: 0,
    tags: ['炸物', '素食']
  },
  {
    id: 'snacks-crispy-shrimp',
    categoryId: 'snacks',
    name: '脆炸金钱虾饼',
    description: '手拍虾泥夹入肥膘，外酥里弹。',
    price: 4200,
    unit: '份',
    spicy: 1,
    tags: ['海鲜', '炸物']
  },
  {
    id: 'snacks-dragonbeard-candy',
    categoryId: 'snacks',
    name: '龙须酥拼盘',
    description: '传统手工龙须酥搭配坚果、玫瑰与抹茶三味。',
    price: 3200,
    unit: '份',
    spicy: 0,
    tags: ['甜品']
  },
  {
    id: 'drinks-aged-plum-wine',
    categoryId: 'drinks',
    name: '十年陈酿梅酒',
    description: '低温窖藏十年的南高梅酒，酸甜平衡。',
    price: 6800,
    unit: '壶',
    spicy: 0,
    tags: ['酒类']
  },
  {
    id: 'drinks-oolong-tea',
    categoryId: 'drinks',
    name: '武夷岩茶·大红袍',
    description: '武夷山核心产区传统炭焙，岩韵饱满。',
    price: 2600,
    unit: '壶',
    spicy: 0,
    tags: ['茶饮']
  },
  {
    id: 'drinks-cold-brew-coffee',
    categoryId: 'drinks',
    name: '冷萃耶加雪菲',
    description: '18小时低温冷萃，柑橘花香清爽提神。',
    price: 3200,
    unit: '杯',
    spicy: 0,
    tags: ['咖啡']
  }
];

function listMenuCatalog() {
  const sortedCategories = [...CATEGORIES].sort((a, b) => (a.order || 0) - (b.order || 0));
  return sortedCategories.map((category) => ({
    ...category,
    items: ITEMS.filter((item) => item.categoryId === category.id).map((item) => ({
      ...item
    }))
  }));
}

function getMenuItem(itemId) {
  if (!itemId) {
    return null;
  }
  const targetId = String(itemId).trim();
  if (!targetId) {
    return null;
  }
  return ITEMS.find((item) => item.id === targetId) || null;
}

function normalizeSelection(selection = []) {
  const aggregated = new Map();
  selection.forEach((entry) => {
    if (!entry) {
      return;
    }
    const itemId = typeof entry.itemId === 'string' ? entry.itemId.trim() : '';
    if (!itemId) {
      return;
    }
    const quantity = Number(entry.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return;
    }
    const existing = aggregated.get(itemId) || 0;
    aggregated.set(itemId, existing + Math.floor(quantity));
  });
  return Array.from(aggregated.entries())
    .map(([itemId, quantity]) => ({ itemId, quantity }))
    .filter((item) => item.quantity > 0);
}

module.exports = {
  MENU_VERSION,
  listMenuCatalog,
  getMenuItem,
  normalizeSelection
};
