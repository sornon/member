import { StoneService } from '../../services/api';
import { formatStones } from '../../utils/format';

const DEFAULT_CATEGORY_KEY = 'general';
const DEFAULT_CATEGORY_LABEL = '奇珍异宝';

Page({
  data: {
    loading: true,
    items: [],
    categories: [],
    activeCategoryKey: '',
    activeCategoryIndex: 0,
    activeCategory: null,
    stoneBalance: 0,
    stoneBalanceText: '0',
    submittingId: '',
    showDetail: false,
    detailItem: null,
    error: ''
  },

  onShow() {
    this.bootstrap();
  },

  async bootstrap() {
    this.setData({ loading: true, error: '' });
    try {
      const [catalog, summary] = await Promise.all([
        StoneService.catalog(),
        StoneService.summary()
      ]);
      const items = this.normalizeCatalogItems(catalog);
      const categories = this.buildCategories(items);
      const { activeCategoryKey, activeCategoryIndex, activeCategory } =
        this.resolveActiveCategoryState(categories);
      this.applySummary(summary);
      this.setData({
        items,
        categories,
        activeCategoryKey,
        activeCategoryIndex,
        activeCategory,
        loading: false,
        error: ''
      });
    } catch (error) {
      console.error('[mall] bootstrap failed', error);
      this.setData({
        error: '商城暂时不可用，请稍后再试',
        loading: false
      });
    }
  },

  async handlePurchase(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    this.purchaseItem(id);
  },

  async handleModalPurchase() {
    const { detailItem } = this.data;
    if (!detailItem) {
      return;
    }
    this.purchaseItem(detailItem.id);
  },

  async purchaseItem(id) {
    if (!id || this.data.submittingId) {
      return;
    }
    const item = this.data.items.find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    this.setData({ submittingId: id });
    try {
      const result = await StoneService.purchase(id, 1);
      const summary = result && result.summary;
      if (summary) {
        this.applySummary(summary);
      } else {
        const nextBalance = Math.max(this.data.stoneBalance - item.price, 0);
        this.applySummary({ balance: nextBalance, stoneBalance: nextBalance });
      }
      if (!result || result.success === false) {
        const balanceSource = summary || result || {};
        const resolvedBalance = Number(
          balanceSource.balance ?? balanceSource.stoneBalance ?? this.data.stoneBalance
        );
        const normalizedBalance = Number.isFinite(resolvedBalance)
          ? Math.max(Math.floor(resolvedBalance), 0)
          : this.data.stoneBalance;
        const resolvedCost = Number((result && result.cost) || item.price || 0);
        const normalizedCost = Number.isFinite(resolvedCost)
          ? Math.max(Math.floor(resolvedCost), 0)
          : item.price;
        const shortfall = Math.max(normalizedCost - normalizedBalance, 0);
        const message =
          (result && result.message) ||
          (shortfall > 0 ? `灵石不足，还差${shortfall}灵石` : '灵石不足，无法兑换');
        wx.showToast({ title: message, icon: 'none' });
        return;
      }
      if (this.data.detailItem && this.data.detailItem.id === id) {
        this.setData({ showDetail: false, detailItem: null });
      }
      wx.showToast({ title: '兑换成功', icon: 'success' });
    } catch (error) {
      console.error('[mall] purchase failed', error);
      // 错误提示在 callCloud 中已处理，此处仅保持状态同步。
    } finally {
      this.setData({ submittingId: '' });
    }
  },

  handleCategoryChange(event) {
    const { key } = event.currentTarget.dataset || {};
    if (!key || key === this.data.activeCategoryKey) {
      return;
    }
    const { categories } = this.data;
    const index = Array.isArray(categories)
      ? categories.findIndex((item) => item.key === key)
      : -1;
    if (index === -1) {
      return;
    }
    const category = categories[index];
    this.setData({
      activeCategoryKey: key,
      activeCategoryIndex: index,
      activeCategory: category
    });
  },

  handleItemTap(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) {
      return;
    }
    const item = this.data.items.find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    this.setData({
      detailItem: item,
      showDetail: true
    });
  },

  handleModalClose() {
    if (!this.data.showDetail) {
      return;
    }
    this.setData({ showDetail: false, detailItem: null });
  },

  noop() {},

  applySummary(summary) {
    if (!summary || typeof summary !== 'object') {
      return;
    }
    const balance = Number(summary.balance ?? summary.stoneBalance ?? this.data.stoneBalance);
    if (!Number.isFinite(balance)) {
      return;
    }
    const normalized = Math.max(0, Math.floor(balance));
    this.setData({
      stoneBalance: normalized,
      stoneBalanceText: formatStones(normalized)
    });
  },

  normalizeCatalogItems(catalog) {
    if (!catalog || !Array.isArray(catalog.items)) {
      return [];
    }
    return catalog.items
      .map((item) => {
        const price = Math.max(0, Math.floor(Number(item.price) || 0));
        const icon = (item.icon || '🛒').trim();
        const iconUrl = (item.iconUrl || '').trim();
        const categoryKey = (item.category || DEFAULT_CATEGORY_KEY).trim() || DEFAULT_CATEGORY_KEY;
        const categoryLabel =
          (item.categoryLabel || '').trim() || DEFAULT_CATEGORY_LABEL;
        const categoryOrder = Number.isFinite(Number(item.categoryOrder))
          ? Number(item.categoryOrder)
          : null;
        const order = Number.isFinite(Number(item.order)) ? Number(item.order) : null;
        return {
          ...item,
          price,
          icon,
          iconUrl,
          iconText: icon && icon.length > 2 ? icon.slice(0, 2) : icon,
          category: categoryKey,
          categoryLabel,
          categoryOrder,
          order,
          description: item.description || '',
          effectLabel: item.effectLabel || ''
        };
      })
      .filter((item) => !!item.id);
  },

  buildCategories(items) {
    if (!Array.isArray(items) || !items.length) {
      return [];
    }
    const map = new Map();
    items.forEach((item) => {
      const key = item.category || DEFAULT_CATEGORY_KEY;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: item.categoryLabel || DEFAULT_CATEGORY_LABEL,
          order: Number.isFinite(item.categoryOrder)
            ? item.categoryOrder
            : Number.MAX_SAFE_INTEGER,
          items: []
        });
      }
      const category = map.get(key);
      if (
        Number.isFinite(item.categoryOrder) &&
        item.categoryOrder < category.order
      ) {
        category.order = item.categoryOrder;
      }
      category.items.push(item);
    });
    return Array.from(map.values())
      .map((category) => ({
        ...category,
        items: category.items.sort((a, b) => {
          const orderA = Number.isFinite(a.order)
            ? a.order
            : Number.MAX_SAFE_INTEGER;
          const orderB = Number.isFinite(b.order)
            ? b.order
            : Number.MAX_SAFE_INTEGER;
          if (orderA !== orderB) {
            return orderA - orderB;
          }
          return a.name.localeCompare(b.name);
        })
      }))
      .sort((a, b) => {
        if (a.order !== b.order) {
          return a.order - b.order;
        }
        return a.label.localeCompare(b.label);
      });
  },

  resolveActiveCategoryState(categories) {
    if (!Array.isArray(categories) || !categories.length) {
      return {
        activeCategoryKey: '',
        activeCategoryIndex: 0,
        activeCategory: null
      };
    }
    const fallbackKey = categories[0].key;
    const currentKey = this.data.activeCategoryKey;
    const targetKey = categories.some((category) => category.key === currentKey)
      ? currentKey
      : fallbackKey;
    const index = categories.findIndex((category) => category.key === targetKey);
    return {
      activeCategoryKey: targetKey,
      activeCategoryIndex: index,
      activeCategory: index >= 0 ? categories[index] : null
    };
  }
});
