# 小程序 watch 实时数据更新指南

为了在微信小程序中实现数据的实时监听与响应式更新，可以借助 `Component` 架构或基于 `Page` 的自定义 watch 辅助函数。本文将介绍 watch 的原理、常用实现方式以及一个完整的业务示例，帮助你快速在项目中落地该能力。

## watch 的原理

小程序本身并未提供类似 Vue `watch` 的官方 API，但可以通过拦截 `setData` 或对 `data` 中的字段进行 `Object.defineProperty`/`Proxy` 封装，来实现数据变更时的回调触发。核心步骤如下：

1. 对目标字段建立 getter/setter，在 setter 中记录新值，并调用回调函数。
2. 在页面或组件初始化时注册 watch，将回调函数与字段关联。
3. 在业务逻辑中调用 `setData` 更新字段，watch 回调即可拿到新旧值并执行自定义逻辑。

## 自定义 watch 辅助函数

以下工具函数适用于普通页面。它通过遍历 watch 配置，为每个字段创建响应式 setter。

```js
// utils/watch.js
function watch(context, watchConfig) {
  Object.keys(watchConfig).forEach((key) => {
    let value = context.data[key];
    Object.defineProperty(context.data, key, {
      configurable: true,
      enumerable: true,
      get() {
        return value;
      },
      set(newValue) {
        const oldValue = value;
        value = newValue;
        watchConfig[key].call(context, newValue, oldValue);
      },
    });
  });
}

module.exports = watch;
```

### 页面中使用

```js
// pages/user/user.js
const watch = require('../../utils/watch');

Page({
  data: {
    score: 0,
  },

  onLoad() {
    watch(this, {
      score(newVal, oldVal) {
        console.log(`用户积分变化：${oldVal} -> ${newVal}`);
      },
    });
  },

  increaseScore() {
    this.setData({ score: this.data.score + 10 });
  },
});
```

当 `increaseScore` 调用 `setData` 时，watch 会输出积分变化并可执行额外逻辑，例如触发动画或刷新界面。

## 在组件中使用 observers

对于自定义组件，可直接使用官方提供的 `observers` 属性实现监听：

```js
// components/user-card/index.js
Component({
  properties: {
    userInfo: {
      type: Object,
      value: {},
    },
  },

  observers: {
    userInfo(newVal) {
      this.setData({ nickname: newVal.nickname || '游客' });
    },
  },
});
```

`observers` 会在属性变化时触发，适合监听父组件/页面传入的数据。

## 实战示例：实时刷新库存状态

假设我们需要在商品详情页实时刷新库存标签，当库存低于阈值时展示提醒：

```js
// pages/goods/detail.js
const watch = require('../../utils/watch');

Page({
  data: {
    stock: 100,
    stockStatus: '库存充足',
  },

  onLoad() {
    watch(this, {
      stock(newVal) {
        this.setData({
          stockStatus: newVal < 10 ? '库存告急，请尽快下单' : '库存充足',
        });
      },
    });
  },

  onStockUpdate(newStock) {
    this.setData({ stock: newStock });
  },
});
```

### 配合实时数据源

1. **WebSocket**：在 `onLoad` 中建立连接，收到库存变动消息后调用 `onStockUpdate`。
2. **云开发数据库监听**：使用 `wx.cloud.database().collection('goods').doc(id).watch(...)` 监听库存字段变化，在回调中执行 `this.onStockUpdate(data.stock)`。
3. **轮询接口**：设置 `setInterval` 周期性请求库存接口，比较新旧值后更新。

## 项目中适合引入 watch 的场景分析

### 首页（`pages/index/index.js`）

- **监听 `member` 对象派生 UI**：当前通过 `bootstrap` 与 `applyMemberUpdate` 手动在多处 `setData`，以同步头像、背景、导航项与编辑器状态，逻辑集中于 `this.setData({ member: ..., navItems: ..., heroImage: ... })`。【F:miniprogram/pages/index/index.js†L1171-L1236】【F:miniprogram/pages/index/index.js†L1805-L1854】将 `member` 注册为 watch 可在数据源变更时一次性刷新这些派生字段，同时复用到实时监听回调，避免重复调用 `applyMemberUpdate`，提升维护性。
- **监听 `progress` 更新进度条**：`bootstrap` 会根据等级进度计算 `progressWidth` 与 `progressStyle` 再 `setData`，若为 `progress` 建立 watch，可将百分比计算与样式拼接封装在回调中，减少每次接口返回后重复写法，并确保实时监听到的进度变化（例如云数据库推送）也能驱动动画更新。【F:miniprogram/pages/index/index.js†L1171-L1204】
- **监听外观徽章状态**：`syncNameBadgeVisibility` 与 `dismissAvatarBadgeIfAllDismissed` 等逻辑依赖 `appearanceBadgeState` 与本地存储，目前需要在多个操作后显式调用。通过为 `appearanceBadgeState` 设置 watch，可在用户操作勋章时立即判断是否隐藏角标，从而避免遗漏刷新，提升体验的同时不会影响样式布局，因为仅更新布尔标识。【F:miniprogram/pages/index/index.js†L913-L916】【F:miniprogram/pages/index/index.js†L1349-L1386】

### 会员等级页（`pages/membership/membership.js`）

- **监听 `progress` 派生进度条样式**：`fetchData` 在拿到等级进度后计算 `progressWidth` 与 `progressStyle` 并 `setData`。【F:miniprogram/pages/membership/membership.js†L203-L316】若使用 watch，当实时监听或二次刷新更新 `progress` 时可以复用同一逻辑，避免多处保持宽度计算函数，且不会影响样式，因为回调继续输出同样的样式字符串。
- **监听 `levels`、`realms` 列表**：页面需要根据等级和境界数据筛出 `visibleLevels`、`visibleRealms`，目前通过 `fetchData` 与 `refreshVisibility` 手动触发，且错误兜底时需再次调用 `refreshVisibility`。【F:miniprogram/pages/membership/membership.js†L203-L350】为 `levels` 与 `realms` 添加 watch，可在数据来源变化或外部推送时自动重算可见项，保证角标与模块同步，同时逻辑集中、便于单元测试。
- **监听突破相关字段**：`pendingBreakthroughLevelId`、`breakthroughLevel`、`breakthroughRewardText` 之间存在依赖，watch 可在 ID 变化时自动查找并更新奖励描述，减少手动维护链路，并且仅涉及文本展示，不会造成样式错乱。【F:miniprogram/pages/membership/membership.js†L268-L315】

### 包房预约页（`pages/reservation/reservation.js`）

- **监听时间选择字段**：`date`、`startTime`、`durationIndex` 变化后都会回调 `fetchRooms` 并重新计算 `endTime`、`timeError` 等字段。【F:miniprogram/pages/reservation/reservation.js†L161-L250】借助 watch 可将校验与接口触发封装为统一入口，避免每个事件处理函数重复 `this.fetchRooms()`。由于 watch 仅更新字符串与数组数据，对样式无副作用。
- **监听 `durationIndex` 衍生 `durationHours`**：目前在 `handleDurationChange` 中手动同步两个字段。【F:miniprogram/pages/reservation/reservation.js†L243-L250】改用 watch 在索引变化时派生小时数，可减少重复逻辑并保证其他入口（例如初始化或恢复缓存）修改索引时也能自动更新时长。
- **监听 `rooms` 与通知数据**：接口返回后需要调用 `updateGlobalReservationBadges`、`isNoticeDismissed` 等方法。通过监听 `rooms` 或 `notice`，可确保后续扩展（如轮询或实时推送）仍能执行这些副作用逻辑，而无需在每个获取房间的入口中手动维护。【F:miniprogram/pages/reservation/reservation.js†L205-L225】【F:miniprogram/pages/reservation/reservation.js†L442-L457】

## 最佳实践

- 避免对 `data` 中体积很大的对象（如上百条列表）开启 watch，以免性能下降。
- 在页面卸载 (`onUnload`) 时取消 WebSocket、数据库监听或轮询，防止内存泄漏。
- watch 回调中如需 `setData`，应确保不会形成死循环（例如只在值变化时更新）。
- 将 watch 逻辑封装为独立模块，便于复用与单元测试。

通过以上方式，即可在小程序中实现 watch 功能，满足实时更新数据的需求。
