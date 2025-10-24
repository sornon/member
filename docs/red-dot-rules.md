# 红点提醒规则总览

## 总体设计
- 所有红点状态由 `utils/badge-center.js` 统一管理，采用 `latest`（最新版本号）与 `acknowledged`（确认版本号）的差值来判断是否显示红点。
- 状态持久化依托 `storage-notifications`，在小程序本地缓存中长期保存，确保跨会话记忆。
- 红点 key 统一使用 `namespace:resource` 约定，外部模块调用 `updateBadgeState/acknowledgeBadge/acknowledgeBadges` 即可读写。
- 任意模块可通过 `subscribeBadge` 订阅全量快照，避免不同页面重复维护状态。
- 新用户首次访问时会自动对 `home:avatar` 与 `home:nickname` 注入版本号，确保头像与昵称都会亮起红点。

## 新用户首访策略
- 小程序在首页 `onLoad` 阶段调用 `ensureFirstVisitBadges`，在本地存储中一次性写入 `home:avatar` 与 `home:nickname` 的 `latest` 版本。
- 通过 `center:meta.firstVisitApplied` 标记，确保首次亮起后不会反复触发，除非用户清空缓存或更换设备。
- 页面订阅红点后即可立即渲染头像、昵称红点，用户查看任一入口会调用 `acknowledgeBadge` 清除提醒。

## 主要 Badge Key
| Key | 页面/入口 | 触发来源 | 备注 |
| --- | --- | --- | --- |
| `home:avatar` | 首页头像 | 头像/相框/称号/背景解锁指纹变更或首次进入 | 首页头像角标 |
| `home:nickname` | 首页昵称 | 昵称变更或首次进入 | 点击“道号”后清除 |
| `home:realm` | 首页境界入口 | 等级奖励待领取 | 点击境界或进入会员页确认 |
| `home:stones` | 首页灵石入口 | 灵石余额更新 | 进入灵石页面确认 |
| `home:nav:wallet` | 首页底栏「钱包」 | 钱包页面主动刷新 | 打开钱包页即清除 |
| `home:nav:order` | 首页底栏「点餐」 | 订单接口返回最新版本/订单通知 | 点餐页 onLoad 清除 |
| `home:nav:reservation` | 首页底栏「预订」 | 预约版本号变化 | 预订页 onShow 清除 |
| `home:nav:role` | 首页底栏「角色」 | 待分配属性点 | 进入角色页或属性页清除 |
| `home:nav:equipment` | 首页底栏「装备」 | 由后续扩展调用 | 角色页切换「装备」时清除 |
| `home:nav:storage` | 首页底栏「纳戒」 | `syncStorageCategoryBadge` 汇总 | 角色页切换「纳戒」或分类后清除 |
| `home:nav:skill` | 首页底栏「技能」 | 由后续扩展调用 | 角色页切换「技能」时清除 |
| `home:nav:admin` | 首页底栏「管理员」 | 预约审批版本号变化 | 进入管理员页清除 |
| `home:avatar-tab:*` | 头像弹窗四个 Tab | 外观资源指纹变化或首次进入 | 切换到对应 Tab 清除 |
| `home:activity` | 首页活动入口 | 运营模块通过 `meta.targets` 指定 | 点击任意活动图标清除 |
| `role:tab:*` | 角色页顶栏 | Badge Center 对应 key | 切换到对应 Tab 时清除 |
| `storage:tab:<key>` | 纳戒分类 | 分类内存在新道具/装备 | 切换到该分类或清空新物品后清除 |
| `reservation:notification` | 预订中心 | 预约通知版本 | 预订页 onShow 清除 |
| `order:notification` | 点餐中心 | 新订单/确认通知 | 点餐页 onLoad 清除 |

## 数据触发策略
- 首页 `index` 页面在 `bootstrap/applyMemberUpdate` 时调用：
  - `syncAppearanceBadges`：基于头像/相框/称号/背景的 unlock 指纹刷新外观相关红点。
  - `markNicknameBadge`：记录昵称指纹，用户改名后会重新亮起。
  - `syncReservationBadges`：读取会员的 `reservationBadges` 版本，同步首页/管理员入口红点。
  - `syncRoleBadge`：根据是否存在未分配属性点控制角色红点。
  - `syncStoneBadge`、`syncRealmBadge`：分别对应灵石余额及境界奖励状态。
- `role` 页面：
  - `buildStorageState` & `refreshStorageNewBadges` 内部统计每个分类的新道具数量，通过 `syncStorageCategoryBadge` 写入 `storage:tab:*`，并联动首页与角色页纳戒红点。
  - Tab 切换时统一调用 `acknowledgeBadges`，同时刷新最新快照，保证顶栏红点即时消失。
- 预订/点餐/钱包页面在进入时使用 `acknowledgeBadges` 主动清除对应入口红点，避免用户回到首页仍显示提醒。

## 确认规则
- `acknowledgeBadge`/`acknowledgeBadges` 会将确认版本提升到 `latest`，并触发订阅者重渲染。
- `acknowledgeByPrefix` 可一次性清除某前缀的红点（当前未直接使用，可供扩展）。
- 红点消失条件：
  1. 用户进入对应页面/Tab 时主动调用 `acknowledgeBadges`。
  2. 红点数据源更新为无新内容时（如纳戒分类没有新道具）会自动写入确认版本。
- 当 `updateBadgeState` 发现 `fingerprint` 发生变化但未传入版本号时，会自动使用当前时间戳保证 `latest` 单调递增。

## 页面接入摘要
### 首页 `pages/index`
- 新增 `badgeIndicators` 统一驱动头像、昵称、境界、灵石、活动与底部导航红点展示。
- 订阅 Badge 快照后自动重建导航、活动入口和头像弹层的红点状态。
- 点击头像、昵称、活动、境界、灵石、导航项与头像弹层各 Tab 时即时清除相关红点。

### 角色页 `pages/role`
- 同步订阅 Badge 快照，维护顶栏四个 Tab 及纳戒分类的红点。
- 构建纳戒数据时统计新道具数量并写入 `storage:tab:*`，无新内容时自动清除首页/角色页纳戒红点。
- Tab/分类切换会主动确认并刷新快照，保证 UI 与状态一致。

### 功能页
- 预订页 `reservation`：`onShow` 清除 `home:nav:reservation` 与 `reservation:notification`。
- 点餐页 `membership/order`：`onLoad` 清除 `home:nav:order` 与 `order:notification`。
- 钱包页 `wallet`：`onShow` 清除 `home:nav:wallet`。

## 扩展指引
1. 新增入口时，只需在 `badge-center` 中注册新的 key，并在业务模块调用 `updateBadgeState` 推送版本即可。
2. 若红点依赖复杂结构，推荐通过 `fingerprint`（JSON 序列化或哈希）来对比差异，避免在客户端维护版本号。
3. 业务页面进入时务必调用 `acknowledgeBadge(s)`，以免用户返回首页后红点仍然高亮。
4. 测试时重点验证：
   - 新用户首次进入首页的头像/昵称红点。
   - 纳戒新增道具后首页/角色页红点联动。
   - 预约/点餐/钱包页面打开后首页底部导航红点是否自动消失。
   - 红点状态在小程序重新进入后仍能正确恢复。

## 测试建议清单
- [ ] 新账号登录后，头像与昵称红点展示；打开任一后红点消失。
- [ ] 增加纳戒新道具，首页「纳戒」与角色页「纳戒」均亮起，进入分类后红点消失。
- [ ] 接收新的预约/管理员通知，首页对应导航显示红点，进入预订或管理员页后消失。
- [ ] 点餐产生新订单，首页「点餐」入口出现红点，打开点餐页后消失。
- [ ] 钱包余额变动后首页「钱包」入口提示红点，进入钱包页后清除。
- [ ] 重新打开小程序，红点状态保持与上次退出时一致。
