# 宗门系统数据结构与迁移指南

本节梳理宗门（公会）系统的基础数据模型、索引、示例数据，以及如何通过 `bootstrap` 云函数完成迁移与回滚。

## 数据结构

所有集合均位于 CloudBase，集合名称统一维护在 `common-config` 的 `COLLECTIONS` 常量内。

### `guilds`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 宗门唯一 ID。示例：`guild_demo_crane` |
| `name` | `string` | 宗门名称，建立唯一索引与文本索引用于模糊搜索。|
| `badge` | `string` | 云存储徽章资源标识。|
| `level` | `number` | 宗门等级。|
| `notice` | `string` | 宣言 / 公告。|
| `leaderId` | `string` | 宗主成员 ID。|
| `officerIds` | `string[]` | 长老 / 副宗主 ID 列表。|
| `memberCount` | `number` | 当前成员数。|
| `capacity` | `number` | 成员上限。|
| `exp` | `number` | 宗门经验。|
| `tech` | `object` | 科研/加成配置，结构由服务端自定义。|
| `createdAt` | `Date` | 创建时间。|
| `updatedAt` | `Date` | 最近更新时间。|

**索引**：`name`（唯一）、`name`（文本检索）、`leaderId`。

### `guildMembers`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 文档 ID，推荐拼接 `guildId` 与 `memberId`。|
| `guildId` | `string` | 归属宗门。|
| `memberId` | `string` | 会员 ID。|
| `role` | `'leader' / 'officer' / 'member'` | 成员角色。|
| `contributionTotal` | `number` | 历史贡献。|
| `contributionWeek` | `number` | 本周贡献（降序索引）。|
| `activity` | `number` | 活跃度评分。|
| `joinedAt` | `Date` | 加入时间。|
| `updatedAt` | `Date` | 最近更新时间。|

**索引**：`guildId + role`、`memberId`、`contributionWeek`（降序）。

### `guildTasks`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 任务文档 ID。|
| `guildId` | `string` | 任务所属宗门。|
| `taskId` | `string` | 模板/任务编号。|
| `type` | `string` | 任务类型（试炼、捐献等）。|
| `title` | `string` | 任务标题。|
| `goal` | `object` | 目标描述，示例 `{ type: 'defeat', target: 15 }`。|
| `progress` | `object` | 当前进度，示例 `{ current: 12, target: 15 }`。|
| `reward` | `object` | 奖励结算数据。|
| `status` | `'open' / 'closed'` | 状态。|
| `startAt` | `Date` | 开始时间。|
| `endAt` | `Date` | 结束时间。|
| `updatedAt` | `Date` | 最近更新时间。|

**索引**：`guildId + status`、`endAt`。

### `guildBoss`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 活动文档 ID。|
| `guildId` | `string` | 宗门 ID。|
| `bossId` | `string` | Boss 模板 ID。|
| `level` | `number` | Boss 等级。|
| `hpMax` | `number` | Boss 总血量。|
| `hpLeft` | `number` | 剩余血量。|
| `phase` | `number` | 阶段。|
| `refreshedAt` | `Date` | 刷新时间。|
| `endsAt` | `Date` | 结束时间。|
| `status` | `'idle' / 'open' / 'ended'` | 战斗状态。|
| `leaderboard` | `{ memberId: string, damage: number }[]` | 伤害榜。|

**索引**：`guildId`、`status`、`endsAt`。

### `guildLeaderboard`

缓存集合，结构与 `pvpLeaderboard` 对齐。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 赛季 / 缓存键。|
| `entries` | `object[]` | 排行条目，内容由服务端定义。|
| `updatedAt` | `Date` | 缓存更新时间。|
| `schemaVersion` | `number` | 缓存结构版本号。|

**索引**：`schemaVersion`（额外保证结构变更可快速查询）。

### `guildLogs`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 日志文档 ID。|
| `guildId` | `string` | 宗门 ID。|
| `type` | `string` | 日志类型，例如 `system`、`activity`。|
| `actorId` | `string` | 触发人 ID。|
| `payload` | `object` | 详情 JSON。|
| `createdAt` | `Date` | 记录时间。|

**索引**：`guildId + createdAt(desc)`。

## 迁移与回滚

迁移脚本位于 `cloudfunctions/bootstrap/migrations/`：

- `2025-01-guild-init.js`：创建集合与索引，并写入示例宗门、成员、任务、Boss、排行榜与日志。
- `2025-01-guild-rollback.js`：支持 `dry-run`（默认）或强制删除，移除上述集合。

运行方式：

1. 在微信云函数控制台或 CI 中执行 `bootstrap` 云函数。
2. 传入 `{ "action": "runMigration", "migration": "guild-init" }` 触发初始化迁移。
3. 若需回滚，传入 `{ "action": "runMigration", "migration": "guild-rollback", "force": true }`；不传 `force` 时默认为 dry-run，仅输出计划。

## 示例数据

迁移会生成以下示例：

- 宗门 **云鹤仙宗**（`guild_demo_crane`），含 1 名宗主、1 名长老与 1 名成员。
- 两个任务模板：灵木守护试炼、灵石捐献周任务。
- 当前 Boss `ancient_spirit_tree`，带有示例伤害榜。
- 缓存排行榜 `season_demo_2025` 与一条系统日志，方便验证读写权限。

运行迁移后，可通过 `wx-server-sdk` 直接读取这些集合，验证索引和数据是否创建成功。回滚脚本会按顺序删除（或清空）相关集合，确保可以安全回退。

## 错误码与风控

云函数 `guild` 通过 `createError(code, message)` 返回标准错误码，便于前端与监控对齐。当前骨架阶段约定的错误码如下：

| 错误码 | 说明 |
| ------ | ---- |
| `UNAUTHENTICATED` | 缺少身份信息，需要重新登录。|
| `UNKNOWN_ACTION` | 未知操作，通常表示前端未同步最新版本。|
| `RATE_LIMITED` | 操作频率过高，触发速率限制。|
| `ACTION_COOLDOWN` | 操作处于冷却中，需要等待。|
| `INVALID_SIGNATURE` | 签名校验失败。|
| `INVALID_MEMBER` | 身份信息不合法。|
| `INVALID_GUILD` | 目标宗门不存在或无效。|
| `PERMISSION_DENIED` | 当前身份无权执行该操作。|
| `NOT_IMPLEMENTED` | 功能占位符，后续迭代将补全逻辑。|
| `GUILD_ACTION_FAILED` | 未分类的服务器内部错误。|

### 冷却与限流配置

速率限制与操作冷却统一集中在 `cloudfunctions/guild/constants.js`：

- `ACTION_RATE_LIMIT_WINDOWS`：针对 `create`、`donate`、`boss.challenge` 等动作的最小间隔（毫秒）。
- `ACTION_COOLDOWN_WINDOWS`：用于 `donate`、`tasks.claim`、`boss.challenge` 等需要防重入的冷却时间。

如需调整风控策略，只需更新该文件并同步部署即可。
