module.exports = {
  MENU_CATEGORIES: [
    {
      id: 'aperitivo',
      name: '开胃 Aperitivo',
      description: '轻盈咸点开启味蕾',
      items: [
        {
          id: 'gilda-skewer',
          name: '吉尔达咸鲜串',
          price: 2600,
          unit: '串',
          description: '青椒、橄榄与凤尾鱼的经典组合，佐酒首选。'
        },
        {
          id: 'truffle-popcorn',
          name: '松露爆米花',
          price: 1800,
          unit: '份',
          description: '黑松露黄油裹覆的现爆玉米花，香气四溢。'
        },
        {
          id: 'olive-marinate',
          name: '柠檬香草腌橄榄',
          price: 2200,
          unit: '碗',
          description: '西西里橄榄搭配新鲜柠檬皮与迷迭香。'
        },
        {
          id: 'anchovy-toast',
          name: '凤尾鱼番茄脆吐司',
          price: 2800,
          unit: '份',
          description: '低温慢烤小番茄配以腌凤尾鱼与酸面包。'
        }
      ]
    },
    {
      id: 'tapas',
      name: '塔帕斯 Tapas',
      description: '经典小份西班牙料理',
      items: [
        {
          id: 'octopus-gallega',
          name: '拉科鲁尼亚章鱼',
          price: 5800,
          unit: '份',
          description: '炭烤章鱼腿覆以烟熏辣椒粉与土豆泥。'
        },
        {
          id: 'wagyu-bikini',
          name: '和牛松露三明治',
          price: 6800,
          unit: '份',
          description: 'IBÉRICO 火腿与和牛油封搭配松露芝士。'
        },
        {
          id: 'mushroom-croquette',
          name: '菌菇松露可乐饼',
          price: 3600,
          unit: '两枚',
          description: '野生菌菇馅心，外酥内绵。'
        },
        {
          id: 'prawn-ajillo',
          name: '蒜香红虾',
          price: 5400,
          unit: '份',
          description: '西班牙红虾浸入橄榄油与蒜片慢煮，附面包片。'
        }
      ]
    },
    {
      id: 'pasta',
      name: '主食 Pasta',
      description: '每日鲜制手工面与饭',
      items: [
        {
          id: 'seafood-paella',
          name: '海鲜烩饭',
          price: 7800,
          unit: '份',
          description: '瓦伦西亚风味，藏红花与海鲜高汤慢煮。'
        },
        {
          id: 'cuttlefish-ink',
          name: '墨鱼汁宽面',
          price: 7200,
          unit: '份',
          description: '自制墨汁宽面搭配炭烤小章鱼与风干番茄。'
        },
        {
          id: 'porcini-risotto',
          name: '牛肝菌烩饭',
          price: 6800,
          unit: '份',
          description: '慢火搅拌的意式米配牛肝菌与帕玛森芝士。'
        },
        {
          id: 'lobster-bisque-pasta',
          name: '龙虾浓汤细面',
          price: 8800,
          unit: '份',
          description: '加拿大龙虾熬煮浓汤拌入手工细面。'
        }
      ]
    },
    {
      id: 'dessert-bar',
      name: '甜品与酒廊 Dessert & Bar',
      description: '圆满收官的甘甜与酒香',
      items: [
        {
          id: 'basque-cheesecake',
          name: '巴斯克芝士蛋糕',
          price: 3200,
          unit: '块',
          description: '微焦外皮与流心中心的经典甜点。'
        },
        {
          id: 'cava-sorbet',
          name: '卡瓦气泡雪葩',
          price: 2600,
          unit: '杯',
          description: '西班牙气泡酒打制的清爽雪葩。'
        },
        {
          id: 'single-origin-mocha',
          name: '单一产区摩卡',
          price: 2400,
          unit: '杯',
          description: '厄瓜多尔可可与手冲浓缩的复合香气。'
        },
        {
          id: 'smoked-oldfashioned',
          name: '烟熏古典鸡尾酒',
          price: 4200,
          unit: '杯',
          description: '橡木烟熏波本威士忌配以糖浆与苦精。'
        }
      ]
    }
  ]
};

module.exports.findMenuItemById = function findMenuItemById(itemId) {
  if (!itemId) {
    return null;
  }
  const normalized = String(itemId).trim();
  if (!normalized) {
    return null;
  }
  for (const category of module.exports.MENU_CATEGORIES) {
    const found = category.items.find((item) => item.id === normalized);
    if (found) {
      return { ...found, categoryId: category.id, categoryName: category.name };
    }
  }
  return null;
};
