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

## 最佳实践

- 避免对 `data` 中体积很大的对象（如上百条列表）开启 watch，以免性能下降。
- 在页面卸载 (`onUnload`) 时取消 WebSocket、数据库监听或轮询，防止内存泄漏。
- watch 回调中如需 `setData`，应确保不会形成死循环（例如只在值变化时更新）。
- 将 watch 逻辑封装为独立模块，便于复用与单元测试。

通过以上方式，即可在小程序中实现 watch 功能，满足实时更新数据的需求。
