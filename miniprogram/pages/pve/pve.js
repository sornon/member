import { PveService } from '../../services/api';

const ATTRIBUTES = [
  { key: 'hp', label: '气血' },
  { key: 'mp', label: '灵力' },
  { key: 'atk', label: '攻击' },
  { key: 'def', label: '防御' },
  { key: 'crit', label: '会心' },
  { key: 'agi', label: '身法' },
  { key: 'spi', label: '神识' }
];

const EQUIPMENT_SLOTS = [
  { key: 'weapon', label: '武器' },
  { key: 'armor', label: '护具' },
  { key: 'focus', label: '法器' },
  { key: 'accessory', label: '饰品' },
  { key: 'boots', label: '靴子' }
];

function buildSkillMap(skills = []) {
  return skills.reduce((map, skill) => {
    if (skill && skill.id) {
      map[skill.id] = skill;
    }
    return map;
  }, {});
}

function buildEquipmentEntries(equipment = {}) {
  return EQUIPMENT_SLOTS.map((slot) => ({
    slot: slot.label,
    key: slot.key,
    item: equipment[slot.key] || null
  }));
}

Page({
  data: {
    loading: true,
    profile: null,
    allocation: ATTRIBUTES.reduce((obj, item) => ({ ...obj, [item.key]: 0 }), {}),
    allocating: false,
    drawing: false,
    battling: false,
    lastBattleResult: null,
    selectedStageId: '',
    ATTRIBUTES,
    equipmentEntries: [],
    skillMap: {}
  },

  onShow() {
    this.fetchProfile();
  },

  async fetchProfile() {
    this.setData({ loading: true });
    try {
      const profile = await PveService.getProfile();
      this.applyProfile(profile);
      if (profile.lastDrawResults && profile.lastDrawResults.length) {
        this.showDrawResults(profile.lastDrawResults);
      }
    } catch (error) {
      this.setData({ loading: false });
    }
  },

  handleAllocationInput(event) {
    const { key } = event.currentTarget.dataset;
    const value = parseInt(event.detail.value, 10);
    this.setData({
      allocation: {
        ...this.data.allocation,
        [key]: Number.isFinite(value) ? Math.max(0, value) : 0
      }
    });
  },

  async handleAllocate() {
    if (!this.data.profile) return;
    const total = Object.values(this.data.allocation).reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
      wx.showToast({ title: '请先输入分配点数', icon: 'none' });
      return;
    }
    if (total > (this.data.profile.freePoints || 0)) {
      wx.showToast({ title: '自由属性点不足', icon: 'none' });
      return;
    }
    this.setData({ allocating: true });
    try {
      const profile = await PveService.allocateAttributes(this.data.allocation);
      wx.showToast({ title: '分配成功', icon: 'success' });
      this.applyProfile(profile, { allocating: false });
    } catch (error) {
      this.setData({ allocating: false });
    }
  },

  async handleDraw(event) {
    const { mode } = event.currentTarget.dataset;
    const count = mode === 'ten' ? 10 : 1;
    this.setData({ drawing: true });
    try {
      const profile = await PveService.drawSkills(count);
      this.applyProfile(profile, { drawing: false });
      if (profile.lastDrawResults) {
        this.showDrawResults(profile.lastDrawResults);
      }
    } catch (error) {
      this.setData({ drawing: false });
    }
  },

  showDrawResults(results) {
    const message = results
      .map((result) => {
        if (!result || !result.skill) return '';
        const prefix = result.type === 'duplicate' ? '重复' : '获得';
        const extra = result.type === 'duplicate' ? `（碎片 +${result.fragments}）` : '';
        return `${prefix} · ${result.skill.name} [${result.skill.rarity}]${extra}`;
      })
      .filter(Boolean)
      .join('\n');
    if (message) {
      wx.showModal({ title: '抽卡结果', content: message, showCancel: false });
    }
  },

  async handleEquipItem(event) {
    const { itemId } = event.currentTarget.dataset;
    if (!itemId) return;
    wx.showLoading({ title: '装备中', mask: true });
    try {
      const profile = await PveService.equipItem(itemId);
      wx.hideLoading();
      wx.showToast({ title: '已装备', icon: 'success' });
      this.applyProfile(profile);
    } catch (error) {
      wx.hideLoading();
    }
  },

  async handleEquipSkill(event) {
    const { skillId, type } = event.currentTarget.dataset;
    if (!skillId) return;
    wx.showLoading({ title: '配置中', mask: true });
    try {
      const profile = await PveService.equipSkill(skillId, type);
      wx.hideLoading();
      wx.showToast({ title: '已调整技能', icon: 'success' });
      this.applyProfile(profile);
    } catch (error) {
      wx.hideLoading();
    }
  },

  handleSelectStage(event) {
    const { stageId, unlocked } = event.currentTarget.dataset;
    if (!unlocked) {
      wx.showToast({ title: '尚未解锁该副本', icon: 'none' });
      return;
    }
    this.setData({ selectedStageId: stageId });
  },

  async handleBattle() {
    if (!this.data.selectedStageId) {
      wx.showToast({ title: '请先选择副本', icon: 'none' });
      return;
    }
    this.setData({ battling: true });
    try {
      const result = await PveService.startBattle(this.data.selectedStageId);
      const { victory, rewards, playerPower, enemyPower } = result;
      const profile = result.profile;
      const lines = [
        `我方战力 ${playerPower} · 敌方战力 ${enemyPower}`,
        victory ? '战斗胜利！' : '战斗失败，继续修炼。'
      ];
      if (rewards.spiritStones) {
        lines.push(`获得灵石 ${rewards.spiritStones}`);
      }
      if (rewards.equipment) {
        lines.push(`掉落装备：${rewards.equipment.name}`);
      }
      if (Array.isArray(rewards.fragments) && rewards.fragments.length) {
        rewards.fragments.forEach((fragment) => {
          lines.push(`技能碎片：${fragment.skill.name} +${fragment.amount}`);
        });
      }
      wx.showModal({ title: '战斗结算', content: lines.join('\n'), showCancel: false });
      this.applyProfile(profile, {
        battling: false,
        lastBattleResult: result
      });
    } catch (error) {
      this.setData({ battling: false });
    }
  },

  applyProfile(profile, extra = {}) {
    const skillMap = buildSkillMap(profile?.skills?.owned || []);
    const equipmentEntries = buildEquipmentEntries(profile?.equipment || {});
    const selectedStage =
      profile?.stages?.find((stage) => stage.id === this.data.selectedStageId && stage.unlocked) ||
      profile?.stages?.find((stage) => !stage.cleared && stage.unlocked);
    const defaults = {
      allocating: false,
      drawing: false,
      battling: false
    };
    this.setData({
      profile,
      loading: false,
      equipmentEntries,
      skillMap,
      selectedStageId: selectedStage ? selectedStage.id : this.data.selectedStageId || (profile?.stages?.[0]?.id || ''),
      allocation: ATTRIBUTES.reduce((obj, item) => ({ ...obj, [item.key]: 0 }), {}),
      ...defaults,
      ...extra
    });
  }
});
