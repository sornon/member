const MENU_CATALOG = [
  {
    id: 'signature',
    name: '招牌菜',
    description: 'La Casa 经典人气菜肴',
    items: [
      {
        id: 'signature-asado',
        name: '阿根廷烤肉拼盘',
        description: '精选牛腹肉、香肠与香草腌制蔬菜的拼盘，搭配自制青酱。',
        price: 16800,
        unit: '份',
        tags: ['肉类', '分享'],
        spicy: '微辣'
      },
      {
        id: 'signature-risotto',
        name: '松露牛肝菌烩饭',
        description: '慢火熬制的牛肝菌汤底，加入意大利米与黑松露，口感丝滑浓郁。',
        price: 12800,
        unit: '份',
        tags: ['主食'],
        spicy: '不辣'
      },
      {
        id: 'signature-seafood',
        name: '西班牙海鲜饭',
        description: '以藏红花调味的经典海鲜饭，搭配大虾、青口与鱿鱼圈。',
        price: 15800,
        unit: '份',
        tags: ['主食', '海鲜'],
        spicy: '微辣'
      }
    ]
  },
  {
    id: 'tapas',
    name: '小食与塔帕斯',
    description: '佐酒分享的轻食与开胃小点',
    items: [
      {
        id: 'tapas-croquetas',
        name: '火腿芝士丸',
        description: '西班牙塞拉诺火腿与曼切戈芝士炸球，酥脆绵密。',
        price: 5200,
        unit: '份',
        tags: ['炸物'],
        spicy: '不辣'
      },
      {
        id: 'tapas-shrimp',
        name: '蒜香橄榄油虾',
        description: '新鲜大虾以蒜蓉、橄榄油与辣椒爆香，配上手工面包。',
        price: 6800,
        unit: '份',
        tags: ['海鲜'],
        spicy: '微辣'
      },
      {
        id: 'tapas-salad',
        name: '地中海沙拉',
        description: '混合生菜、羊乳酪与风干番茄，佐以柠檬橄榄油酱。',
        price: 4600,
        unit: '份',
        tags: ['素食'],
        spicy: '不辣'
      }
    ]
  },
  {
    id: 'beverage',
    name: '饮品与甜品',
    description: '特色调制鸡尾酒、咖啡与甜点',
    items: [
      {
        id: 'beverage-sangria',
        name: '自家秘制桑格利亚',
        description: '红酒搭配时令水果与香料，清爽易饮。',
        price: 3800,
        unit: '杯',
        tags: ['酒精'],
        spicy: '不辣'
      },
      {
        id: 'beverage-oldfashioned',
        name: '烟熏老式',
        description: '波本威士忌与自制糖浆调制，入口带有烟熏木香。',
        price: 4200,
        unit: '杯',
        tags: ['酒精'],
        spicy: '不辣'
      },
      {
        id: 'dessert-basque',
        name: '巴斯克芝士蛋糕',
        description: '焦香外皮与柔滑内层，使用进口奶油慢烤而成。',
        price: 4800,
        unit: '份',
        tags: ['甜点'],
        spicy: '不辣'
      }
    ]
  }
];

function cloneCatalog() {
  return MENU_CATALOG.map((category) => ({
    ...category,
    items: category.items.map((item) => ({ ...item }))
  }));
}

function buildItemIndex() {
  const index = new Map();
  MENU_CATALOG.forEach((category) => {
    category.items.forEach((item) => {
      index.set(item.id, { ...item, categoryId: category.id, categoryName: category.name });
    });
  });
  return index;
}

const ITEM_INDEX = buildItemIndex();

function getMenuCatalog() {
  return cloneCatalog();
}

function getMenuItemById(id) {
  if (!id) return null;
  return ITEM_INDEX.get(id) ? { ...ITEM_INDEX.get(id) } : null;
}

module.exports = {
  getMenuCatalog,
  getMenuItemById
};
