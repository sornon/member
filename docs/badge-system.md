# 红点提醒系统设计规范

## 总体目标

* 为会员小程序的首页、二级入口及主要功能页提供统一的红点提醒体系。
* 所有红点状态均通过本地缓存持久化（`utils/badge-center.js`），在用户查看后即时清除，出现新数据时重新点亮。
* 红点键值采用层级命名，分为首页入口（`home.*`）、导航入口（`home.nav.*`）、角色子模块（`role.*`）、功能模块（如 `menu.orders.pending`、`appearance.*` 等）。

## 状态存储与同步

1. `badge-center` 提供以下能力：
   * `updateBadgeSignature` 与 `updateBadgeEntries` 用于写入最新签名。
   * `shouldShowBadge` 与 `acknowledgeBadge` 分别用于读取展示状态与确认阅读。
   * 状态在 `App` 全局及本地存储中双写，保证跨页面同步。
2. 页面在拉取远端数据后应：
   * 计算稳定签名（例如根据版本号、待处理条目、更新时间戳组合）。
   * 调用 `updateBadgeSignature`/`updateBadgeEntries` 写入，并在首次初始化时携带 `initializeAck: true`，确保首次展示不点亮。
3. 当用户进入或显式查看某功能入口时，需调用 `acknowledgeBadge`（可一次性传入多个键）并刷新绑定的本地状态。

## 首页入口与导航

* 首页头像、境界、灵石入口签名与展示：
  * `home.avatar` 结合外观解锁数据；
  * `home.realm` 依据可领取境界奖励的关卡；
  * `home.stones` 依据灵石余额与最近账目时间戳。
* 首页底部导航：
  * 角色（`home.nav.role`）额外兼容老的属性点逻辑。
  * 装备/纳戒分别使用 `home.nav.equipment`、`home.nav.storage`；
  * 技能使用 `home.nav.skill`；
  * 点餐使用 `menu.orders.pending`；
  * 预订使用 `home.nav.reservation`。
* 点击任一入口时需即时 `acknowledgeBadge`，并调用 `refreshBadgeBindings` / `refreshNavBadgeState` 更新 UI。

## 角色页面

* 四个顶级 Tab（角色、装备、纳戒、技能）与纳戒分类标签均绑定红点状态：
  * 页面加载及每次切换时调用 `acknowledgeActiveTabBadges`，同步确认对应键值。
  * 装备/纳戒 Tab 同步 `home.nav.equipment`、`home.nav.storage` 与细分的 `role.storage.equipment`、`role.storage.items`。
  * 纳戒分类标签根据 `updateBadgeEntries` 生成的签名决定是否点亮，查看或切换后立即刷新。
* 纳戒物品层级：调用 `acknowledgeStorageItems` 后应同步 `acknowledgeBadge(['role.storage.items','home.nav.storage'])`。

## 点餐与预订

* 点餐页：
  * `collectPendingOrderBadgeEntries` 收集所有待会员确认的订单，使用 `updateBadgeEntries('menu.orders.pending', …)` 写入。
  * `onShow` 中调用 `acknowledgeBadge('menu.orders.pending')`，返回首页后红点立即熄灭。
* 预订页：
  * 服务器返回的 `reservationBadges` 通过 `buildReservationBadgeSignature` 生成签名并写入 `home.nav.reservation`。
  * 进入页面时调用 `acknowledgeBadge('home.nav.reservation')`。

## 灵石明细

* 灵石页面在拉取汇总后，利用余额与最新交易时间戳生成签名 `stones:<balance>:<latest>`，写入 `home.stones`。
* 进入页面时调用 `acknowledgeBadge('home.stones')`。

## 其他规范

* 新增的红点视图统一使用 `.badge-dot` 基础样式，并在对应组件添加定位类（例如 `.tab-item__dot`、`.storage-tab__dot`）。
* 页面在 `onShow` 与数据变更回调中均需注意刷新绑定，避免旧状态残留。
* 若新增入口：
  1. 设计唯一键名；
  2. 在获取远端数据后写入签名；
  3. 在入口点击/展示时调用 `acknowledgeBadge`；
  4. 更新对应 WXML/WXSS 以显示红点。

以上规则适用于当前小程序内所有红点需求，后续扩展亦应沿用同样的签名与确认流程。
