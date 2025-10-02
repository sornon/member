const MENU_CATEGORIES = [
  {
    id: 'aperitivo',
    name: '开胃小食',
    description: '以轻盈酸甜唤醒味蕾，搭配香槟或低度鸡尾酒的理想选择。',
    items: [
      {
        id: 'citrus-oyster',
        name: '柚香生蚝',
        price: 4800,
        description: '冷藏生蚝佐以粉红葡萄柚冻与指橘珍珠，亮泽酸度与海味平衡。',
        tags: ['海鲜', '冷盘']
      },
      {
        id: 'truffle-cauliflower',
        name: '松露花菜',
        price: 4200,
        description: '低温慢烤花菜搭配黑松露奶油与帕玛森雪花，香气浓郁。',
        tags: ['素食友好']
      },
      {
        id: 'iberico-ham',
        name: '伊比利亚火腿卷',
        price: 5200,
        description: '风干火腿卷入糖渍无花果与35月熟成芝士，层次丰富。',
        tags: ['咸香']
      }
    ]
  },
  {
    id: 'sharing',
    name: '佐酒分享',
    description: '以手工烟熏、腌制与慢煮技巧呈现的餐桌中心分享菜。',
    items: [
      {
        id: 'wagyu-tartare',
        name: '和牛塔塔',
        price: 8800,
        description: '澳洲M9和牛以刀工粗切，拌入烟熏蛋黄与清爽酸豆，附酥炸藜麦。',
        tags: ['牛肉', '招牌']
      },
      {
        id: 'sous-vide-octopus',
        name: '低温章鱼',
        price: 7600,
        description: '章鱼先以橄榄油浸煮再炭火封香，配以烤椒酱与柠檬蒜泥。',
        tags: ['海鲜']
      },
      {
        id: 'forest-mushroom',
        name: '菌菇拼盘',
        price: 6900,
        description: '多种季节菇类以迷迭香黄油慢煎，撒帕玛森与烤榛子碎。',
        tags: ['素食友好', '热食']
      }
    ]
  },
  {
    id: 'mains',
    name: '主菜精选',
    description: '以烟熏与慢火炖煮演绎的La Casa招牌主菜。',
    items: [
      {
        id: 'short-rib',
        name: '威士忌慢炖牛肋',
        price: 13800,
        description: '以本店威士忌烟熏12小时，再以低温慢炖至骨肉分离，佐烤根茎。',
        tags: ['慢煮', '人气']
      },
      {
        id: 'lobster-risotto',
        name: '龙虾烩饭',
        price: 12800,
        description: '以龙虾高汤与意大利米慢炖，黄油打发提升丝滑，点缀鱼子酱。',
        tags: ['海鲜', '米饭']
      },
      {
        id: 'lamb-chop',
        name: '香草羊排',
        price: 11800,
        description: '法式羊排以香草面包屑覆裹，搭配薄荷豌豆泥与酒渍小番茄。',
        tags: ['肉类']
      }
    ]
  },
  {
    id: 'dessert',
    name: '甜品压轴',
    description: '在木质烟熏香气中收束餐叙，甜而不腻的结尾。',
    items: [
      {
        id: 'basque-cheesecake',
        name: '巴斯克芝士',
        price: 5200,
        description: '微焦外壳锁住芝士流心，搭配自制牛奶焦糖与海盐。',
        tags: ['奶香']
      },
      {
        id: 'smoked-tiramisu',
        name: '烟熏提拉米苏',
        price: 4800,
        description: '以烟熏马斯卡彭与波本咖啡糖液堆叠，口感轻盈。',
        tags: ['招牌']
      },
      {
        id: 'citrus-panna-cotta',
        name: '柚香奶冻',
        price: 4500,
        description: '香草奶冻覆以粉柚雪葩与柚子蜜珠，冰凉爽口。',
        tags: ['清爽']
      }
    ]
  }
];

function buildItemMap() {
  const map = {};
  MENU_CATEGORIES.forEach((category) => {
    (category.items || []).forEach((item) => {
      map[item.id] = { ...item, categoryId: category.id };
    });
  });
  return map;
}

const MENU_ITEM_MAP = buildItemMap();

function listMenuCategories() {
  return MENU_CATEGORIES.map((category) => ({
    ...category,
    items: (category.items || []).map((item) => ({
      ...item,
      priceLabel: formatPrice(item.price)
    }))
  }));
}

function listMenuItems() {
  return Object.values(MENU_ITEM_MAP);
}

function findMenuItemById(id) {
  if (!id) {
    return null;
  }
  return MENU_ITEM_MAP[id] || null;
}

function formatPrice(price) {
  const amount = Number(price);
  if (!Number.isFinite(amount)) {
    return '¥0.00';
  }
  return `¥${(amount / 100).toFixed(2)}`;
}

module.exports = {
  MENU_CATEGORIES,
  listMenuCategories,
  listMenuItems,
  findMenuItemById,
  formatPrice
};
