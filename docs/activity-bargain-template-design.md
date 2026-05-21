# 砍价活动类型抽象设计（感恩节 + 音乐会）

## 目标
- 将「感恩节砍价活动」与「音乐会砍价活动」统一为同一活动类型：`bargain`。
- 在后台活动管理中支持该类型的配置，不再依赖纯文案型基础活动。
- 音乐会默认配置：
  - 盈利模式：门票售卖（`ticketingMode=paid-ticket`）
  - 基础金额：`1500`
  - 最低价：`998`
  - 分享后获得砍价次数：`shareRewardAttempts=1`

## 数据模型
活动新增以下字段：
- `activityType`: `standard | bargain`
- `activityTemplate`: `'' | thanksgiving-bargain | concert-bargain`
- `bargainSettings`（仅 `activityType=bargain` 时有效）
  - `startPrice`
  - `floorPrice`
  - `shareRewardAttempts`
  - `ticketingMode`（固定 `paid-ticket`）

当活动不是砍价类型时，`bargainSettings` 会被置为 `null`。

## 后端实现
文件：`cloudfunctions/admin/index.js`
- `normalizeActivityPayload` 新增上述字段归一化。
- 新增：
  - `normalizeActivityType`
  - `normalizeActivityTemplate`
  - `normalizeBargainSettings`
- `decorateActivityRecord` 将新字段透传到管理端。

这样保证：
1. 后台新建活动即可配置类型。
2. 历史活动（不带新字段）自动回落为 `standard`，无兼容性风险。
3. 音乐会可直接复用感恩节砍价玩法配置结构。

## 管理端改造
文件：`miniprogram/subpackages/admin/activities/index.js` + `index.wxml`
- 列表卡片增加活动类型展示（通用 / 砍价）。
- 编辑器新增“活动类型”选择器。
- 选择 `bargain` 后显示：
  - 活动模板
  - 基础金额
  - 最低价
  - 分享奖励次数
- 提交时将配置写入 `payload.bargainSettings`。

## 使用建议（音乐会活动）
后台创建活动时建议填写：
- 活动类型：`砍价活动`
- 活动模板：`concert-bargain`
- 基础金额：`1500`
- 最低价：`998`
- 分享奖励次数：`1`
- 方案/价格文案：建议明确“门票售卖”属性，避免和储值类活动混淆。

## 后续扩展
当前实现先完成“类型抽象 + 可配置化”。
后续可继续在 `cloudfunctions/activities` 中按 `activityType/bargainSettings` 动态生成砍价规则，实现完全去硬编码化（替代仅按固定活动 ID 返回砍价配置）。
