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

## 部署配置与发布步骤（本次更新重点）

### 1) 云函数部署
- 必须重新部署 `cloudfunctions/admin`，否则管理端提交的 `activityType/activityTemplate/bargainSettings` 不会被后端识别和持久化。
- 若后续继续推进“前台按活动配置动态砍价”，再同步部署 `cloudfunctions/activities`。

### 2) 小程序端部署
- 重新上传并发布小程序代码，确保 `miniprogram/subpackages/admin/activities` 的新表单项生效（活动类型、模板、砍价参数）。
- 管理员端若使用了分包缓存，建议发布后在管理账号端清缓存重启，避免旧分包页面仍显示“旧版活动编辑器”。

### 3) 数据库与兼容策略
- 集合：沿用既有 `activities` 集合，无需新增集合。
- 历史数据兼容：
  - 未包含 `activityType` 的旧活动默认按 `standard` 处理。
  - `activityType !== bargain` 时，`bargainSettings` 统一回写/透出为 `null`。
  - **老版本管理端仅更新基础字段时**：不会覆盖新字段（`activityType/activityTemplate/bargainSettings`），避免误清空新配置。
  - **仅提交 `activityType=standard` 的场景**：后端会自动清空 `bargainSettings`，避免遗留脏配置。
  - **仅提交 `bargainSettings` 的场景**：后端自动推断为 `activityType=bargain`，避免类型与配置不一致。
- 运营创建“音乐会砍价”活动建议字段：
  - `activityType=bargain`
  - `activityTemplate=concert-bargain`
  - `bargainSettings.startPrice=1500`
  - `bargainSettings.floorPrice=998`
  - `bargainSettings.shareRewardAttempts=1`
  - `bargainSettings.ticketingMode=paid-ticket`（后端固定）

### 4) 发布后验收清单（建议逐项执行）
1. 进入管理后台 → 活动管理 → 新建活动，确认出现“活动类型”选择器。
2. 选择“砍价活动（感恩节/音乐会）”后，确认出现：
   - 活动模板
   - 基础金额
   - 最低价
   - 分享奖励次数
3. 保存后再次进入编辑，确认上述值可正确回显。
4. 返回活动列表，确认卡片出现“类型：砍价活动”。
5. 抽检数据库对应活动文档，确认新字段结构正确（尤其 `bargainSettings`）。

### 5) 回滚方案
- 若线上出现兼容问题，可临时将新建活动改回 `activityType=standard`，不影响原有活动基础信息创建流程。
- 紧急回滚代码时，只需回滚 `admin` 云函数与管理端分包；数据库中新增字段为向后兼容字段，不会阻塞旧版读取。

## 风险评估（开发/线上同云环境）

结论：**可以安全实现**，但需要遵循发布顺序和字段兼容策略。

### 可控风险
1. **先发云函数、后发前端**：旧版前端不认识新字段，但不会报错；新版后端对缺失字段有默认值和保留策略。
2. **新旧管理端并存编辑同一活动**：旧版编辑仅更新基础字段，不会覆盖砍价字段；新版编辑可完整读写新字段。
3. **历史活动文档无新字段**：后端会回落默认类型，不需要做全量数据迁移。

### 需注意的风险点
1. 若业务前台后续要“按活动动态跑砍价规则”，当前 `cloudfunctions/activities` 仍有一部分基于固定活动 ID 的逻辑，需再做动态化改造后再启用。
2. 同云环境下请避免“只回滚前端、不回滚云函数 schema 约束”的长时间分裂状态，建议按发布窗口统一升级。
