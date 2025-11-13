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
| `_id` | `string` | 文档 ID，约定为 `guildId_bossId`。|
| `guildId` | `string` | 宗门 ID。|
| `bossId` | `string` | Boss 模板 ID。|
| `level` | `number` | Boss 等级，用于随版本调整血量与技能。|
| `status` | `'open' / 'ended'` | 当前状态，Boss 被击败后标记为 `ended`。|
| `hpMax` | `number` | Boss 初始血量。|
| `hpLeft` | `number` | 剩余血量，服务端在结算后扣减。|
| `totalDamage` | `number` | 当前赛季内累计伤害总量。|
| `damageByMember` | `Record<string, number>` | 按成员 ID 统计的总伤害，用于实时榜单。|
| `memberAttempts` | `Record<string, { dateKey: string, count: number, lastChallengeAt: string }>` | 按日记录挑战次数与冷却。|
| `phase` | `number` | Boss 阶段（预留字段，默认 `1`）。|
| `schemaVersion` | `number` | 文档结构版本，便于灰度升级。|
| `createdAt` | `Date` | 创建时间。|
| `updatedAt` | `Date` | 最近更新时间。|
| `defeatedAt` | `Date` | 可选，Boss 被击败时写入。|

**索引**：`guildId + status`、`guildId + schemaVersion`、`updatedAt`（倒序读取最新状态）。

### `guildBattles`

用于持久化 Boss 战斗战报与结算摘要，便于申诉、复盘与数据仓库分析。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 文档 ID，由数据库自动生成。|
| `guildId` | `string` | 宗门 ID。|
| `initiatorId` | `string` | 发起挑战的成员 ID。|
| `bossId` | `string` | Boss 模板 ID。|
| `bossName` | `string` | Boss 名称快照。|
| `party` | `{ memberId: string, name: string, role: string, damage: number }[]` | 战斗参与者与伤害贡献。|
| `payload` | `BattlePayload` | 通过 `battle-schema#createBattlePayload` 生成的结构化战报，包含时间线、参与者与结果。|
| `signature` | `string` | 来自 `signBattlePayload(payload)` 的 MD5 签名，用于验真。|
| `seed` | `string` | 生成战斗随机性的固定种子。|
| `victory` | `boolean` | 是否击败 Boss。|
| `totalDamage` | `number` | 本次挑战造成的总伤害。|
| `rounds` | `number` | 战斗共进行的回合数。|
| `createdAt` | `Date` | 记录写入时间。|
| `schemaVersion` | `number` | 结构版本，便于批量迁移。|

**索引**：`guildId + createdAt(desc)`、`signature`（唯一战报检索）。

### `guildLeaderboard`

缓存集合，结构与 `pvpLeaderboard` 对齐。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 赛季 / 缓存键。|
| `entries` | `object[]` | 排行条目，内容由服务端定义。|
| `updatedAt` | `Date` | 缓存更新时间。|
| `schemaVersion` | `number` | 缓存结构版本号。|

`_id` 与榜单类型一一对应，当前支持 `power`、`contribution`、`activity` 与 `boss` 四种榜单。`entries` 中的每条记录都包含宗门标识 (`guildId`/`id`)、名称、成员数、战力、活跃度、累计贡献、Boss 总伤害，以及 `metricType`/`metricValue` 描述的排名指标，同时合并了宗主的头像框、称号 (`titleId`、`titleName`、`titleCatalog`) 与头像地址，便于前端直接展示。缓存在 `schemaVersion` 变更或超过 TTL 时会自动重建，刷新失败会回退至最近一次成功快照。

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

## Boss 挑战模拟

### 配置来源

- 默认配置位于 `system-settings` 的 `DEFAULT_GUILD_BOSS_SETTINGS`，通过 `normalizeGuildSettings` 自动注入到 `guild` 云函数。
- 生产环境可以在 `system_settings` 集合的 `feature_toggles` 文档中维护自定义配置，字段说明：
  - `enabled`：是否启用 Boss 挑战入口。
  - `dailyAttempts`：单个成员每日可参与次数，范围 1~20。
  - `cooldownMs`：成员再次挑战的冷却时间，范围 10 秒~24 小时。
  - `maxRounds`：战斗最多运行的回合数，范围 5~40。
  - `rotation`：Boss 轮换列表，元素形如 `{ bossId: 'ancient_spirit_tree', level: 65 }`。若包含多条记录，服务端会按照顺序取当期 Boss。
- Boss 模板定义在 `cloudfunctions/guild/boss-definitions.js`，涵盖基础属性、技能、阶段加成与狂暴阈值。新增 Boss 时需同步更新此文件与配置。

### 接口概览

宗门 Boss 相关动作均在 `guild` 云函数的 `boss.*` 命名空间下实现，并要求前端携带有效的行为凭证（`ticket` + `signature`），获取方式与 PVP 模块一致。

| 动作 | 请求字段 | 返回主体 | 说明 |
| ---- | ---- | ---- | ---- |
| `boss.status` | `bossId?`、`ticket`、`signature` | `{ boss, canChallenge, settings }` | 返回 Boss 当前血量、成员剩余次数与冷却信息。`canChallenge` 综合 `enabled`、剩余次数与冷却判定。|
| `boss.challenge` | `bossId?`、`party`/`members`、`ticket`、`signature` | `{ battle, victory, damage, rewards, boss, leaderboard }` | 由服务端模拟战斗并结算，`party` 最多 5 人，默认包含发起者。返回结构化战报、奖励与最新 Boss 状态。|
| `boss.rank` | `bossId?`、`ticket`、`signature` | `{ bossId, bossName, leaderboard, self }` | 读取伤害榜前 100 条数据，并返回当前成员的总伤害。|

**安全约束**：

- `boss.challenge` 同时受全局限频（60 秒）与 Boss 专属冷却（默认 5 分钟）控制，达到上限会返回 `BOSS_COOLDOWN` 或 `RATE_LIMITED`。
- 服务端会读取 `guildMembers` 与 `members` 集合校验队伍成员身份，并在 `memberAttempts` 中记录当日次数与最近挑战时间，避免绕过冷却。
- 战斗使用固定种子：`seed = payload.seed || buildBossSeed(bossId, memberId)`，若前端传入相同种子可复现同一场战斗，便于录像对齐。

### 战报结构与时间线

`boss.challenge` 返回的 `battle` 字段遵循 `battle-schema#createBattlePayload` 规范，核心字段包含：

- `battleId`：`guildId:bossId:<hash>`，由种子和参与方 ID 哈希生成，可确保同种子生成的战报保持一致。
- `mode`：固定为 `guildBoss`，配合前端回放模式识别。
- `seed`：确定战斗随机性的字符串。
- `participants`：包含宗门队员与 `enemy_boss`，每位成员内含 `memberId`、`attributes`、`combatPower` 快照。
- `timeline`：按行动顺序记录的事件数组，元素结构包括：
  - `round` / `sequence`：轮次与行动顺序。
  - `actorId` / `actorSide` / `actorName`：行动者信息。
  - `targetId` / `targetName`：目标信息。
  - `skill`：技能 ID 与等级快照。
  - `events`：由技能引擎输出的命中、伤害、治疗、Buff 变化等事件。
  - `before` / `after`：行动前后的血量快照。
  - `controlBefore` / `controlAfter`：控制类状态（眩晕、禁魔等）的变化。
  - `summaryText`：用于战报回放的自然语言摘要。
- `outcome` 与 `result`：标记胜负、总回合数与胜方 ID。
- `metadata`：包括 `guildId`、`bossId`、`bossLevel`、`party` 名单、阶段事件列表、哈希化的 `startedAt` 与 `maxRounds`。
- `signature`：通过 `signBattlePayload(payload)` 生成的 MD5，前端可在 `battle.replay` 中复用。

时间线兼容 `battle-schema#decorateBattleReplay`，可直接用于构建前端回放。任何改动需保持字段向后兼容，并更新测试快照。

### 数据写入与日志

- 挑战完成后，服务端会更新 `guildBoss` 文档的 `hpLeft`、`totalDamage`、`damageByMember` 与 `memberAttempts`。
- 完整战报与队伍摘要写入 `guildBattles` 集合，同时追加一条 `guildLogs` 日志（`type: 'bossChallenge'`）与 `guildEventLogs` 事件，便于运维排查。
- `boss.challenge` 根据胜负返回差异化奖励（默认灵石 / 贡献值），结算逻辑集中在云函数，前端仅负责展示。



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
