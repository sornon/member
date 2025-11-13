# 宗门（公会）系统运维手册

本手册覆盖宗门系统的端到端能力：功能说明、接口映射、数据模型、部署流程、常见问题以及管理员操作。所有实现均遵循 `cloudfunctions/pvp/index.js` 既有的错误码、签名与缓存策略，确保新旧玩法在同一套风控与日志体系下运行。

> **前提**：仓库基于 `guild-system-dev` 分支的云函数、公共模块与小程序前端均已合入主干。若正在从旧版本升级，请务必先完成 [迁移脚本](battle-backend-gap-analysis.md) 中提到的基础操作后再上线宗门功能。

## 功能概览

宗门系统以“宗门”为社交核心，围绕团队日常、协作挑战与排行榜构建以下能力：

- **宗门创建与管理**：支持申请、审核、入帮、踢人、职位任命与公告编辑；权限以 `leader`/`officer`/`member` 三级划分。
- **成员活跃与贡献**：贡献值、活跃度、任务进度均在服务端结算并写入 `guildMembers` / `guildTasks`，杜绝刷取。
- **宗门 Boss 讨伐**：结合 `combat-system` 与 `skill-engine` 在云函数端完成战斗模拟，产出结构化战报与签名。
- **排行榜缓存**：`guildLeaderboard` 采用与 `pvpLeaderboard` 一致的缓存刷新策略，支持按需强制刷新并回退最近快照。
- **日志与审计**：所有关键操作写入 `guildLogs`/`guildEventLogs`，便于回放与风控。速率限制持久化在 `guildRateLimits`。

## 接口对照表

`guild` 云函数通过 `event.action` 分发到内部的 `ACTION_HANDLER_MAP`。下表列出了所有面向前台或运营工具开放的 action 及其对应的 `GuildService` 方法，保证字段与实现一致。

### 玩家侧 action

| `event.action` | `GuildService` 方法 | 请求示例 | 说明 |
| --- | --- | --- | --- |
| `create` | `GuildService.create(payload)` | `{ "name": "太虚观" }` | 玩家创建宗门，默认成为宗主。|
| `profile` | `GuildService.profile()` | `{}` | 获取当前成员所在宗门、职位、公告与统计。|
| `apply` | `GuildService.apply({ guildId })` | `{ "guildId": "guild_demo_crane" }` | 申请加入宗门，写入待审批列表。|
| `approve` / `reject` | `GuildService.approve(payload)` / `GuildService.reject(payload)` | `{ "applicationId": "guild_demo_crane_user_x" }` | 宗主或长老审批入帮。|
| `leave` / `kick` | `GuildService.leave(payload)` / `GuildService.kick(payload)` | `{ "memberId": "member_foo" }` | 成员主动退出或管理员移除成员。|
| `disband` | `GuildService.disband()` | `{}` | 解散宗门并归档成员数据。|
| `donate` | `GuildService.donate({ templateId })` | `{ "templateId": "donate-spirit-stone" }` | 上交宗门捐献并结算贡献。|
| `members.list` | `GuildService.membersList({ guildId })` | `{ "guildId": "guild_demo_crane" }` | 分页读取成员清单。|
| `logs.list` | `GuildService.logsList({ guildId })` | `{ "guildId": "guild_demo_crane" }` | 查看宗门事件日志与贡献结算。|
| `tasks.list` | `GuildService.tasksList({ guildId })` | `{ "guildId": "guild_demo_crane" }` | 查询当前宗门任务及进度。|
| `tasks.claim` | `GuildService.tasksClaim({ taskId })` | `{ "taskId": "task_guild_help" }` | 领取任务奖励并写入贡献。|
| `boss.status` | `GuildService.bossStatus({ guildId })` | `{ "guildId": "guild_demo_crane" }` | 查询宗门 Boss 当前进度、血量与成员尝试次数。|
| `boss.challenge` | `GuildService.bossChallenge(params)` | `{ "guildId": "guild_demo_crane", "bossId": "boss_fire_01" }` | 发起 Boss 战斗并返回战报。|
| `boss.rank` | `GuildService.bossRank({ guildId })` | `{ "guildId": "guild_demo_crane" }` | 查看 Boss 赛季排行榜。|
| `getLeaderboard` | `GuildService.getLeaderboard({ type })` | `{ "type": "contribution", "forceRefresh": true }` | 获取宗门排行榜，允许强制刷新缓存。|
| `overview` | `GuildService.getOverview()` | `{}` | 组合返回 `profile`、`members.list`、`tasks.list` 等概要信息。|

### 运营/管理 action

| `event.action` | `GuildService` 方法 | 请求示例 | 说明 |
| --- | --- | --- | --- |
| `listGuilds` | `GuildService.listGuilds()` | `{}` | 运营工具使用的宗门列表（含分页与过滤）。|
| `createGuild` / `joinGuild` / `leaveGuild` | `GuildService.createGuild(payload)` 等 | `{ "guildName": "太虚观" }` | 管理员代玩家处理宗门建制/入帮/退帮。|
| `initiateTeamBattle` | `GuildService.initiateTeamBattle({ members, difficulty })` | `{ "members": ["member_a"], "difficulty": 2 }` | 发起演练战斗并生成战报。|
| `refreshTicket` | `GuildService.issueActionTicket()` | `{}` | 申请操作票据，用于敏感操作签名。|
| `admin.riskAlerts` | `GuildService.listRiskAlerts({ guildId, limit })` | `{ "guildId": "guild_demo_crane", "limit": 50 }` | 仅管理员可调用，返回风控预警。|

> 以上接口均会通过 `createError(code, message)` 统一抛错；前端需捕获 `errCode` 进行提示。所有读写请求默认带入 `wxContext.OPENID` 识别玩家身份。

## 数据结构

宗门系统共使用 6 个核心集合，均需在 CloudBase 创建并补充索引：

### `guilds`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 宗门唯一 ID。示例：`guild_demo_crane` |
| `name` | `string` | 宗门名称（唯一索引 + 文本索引）。|
| `badge` | `string` | 云存储徽章资源标识。|
| `level` | `number` | 宗门等级。|
| `notice` | `string` | 公告。|
| `leaderId` | `string` | 宗主成员 ID。|
| `officerIds` | `string[]` | 长老/副宗主 ID 列表。|
| `memberCount` | `number` | 当前成员数。|
| `capacity` | `number` | 成员上限。|
| `exp` | `number` | 累计经验。|
| `tech` | `object` | 科研/加成配置。|
| `createdAt` / `updatedAt` | `Date` | 时间戳。|

**推荐索引**：`name`（唯一）、`name`（文本）、`leaderId`。

### `guildMembers`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | `guildId_memberId` 拼接。|
| `guildId` | `string` | 归属宗门。|
| `memberId` | `string` | 会员 ID。|
| `role` | `'leader' / 'officer' / 'member'` | 成员角色。|
| `contributionTotal` | `number` | 历史贡献。|
| `contributionWeek` | `number` | 周贡献（降序索引）。|
| `activity` | `number` | 活跃度评分。|
| `joinedAt` / `updatedAt` | `Date` | 时间戳。|

**推荐索引**：`guildId + role`、`memberId`、`contributionWeek`（降序复合索引）。

### `guildTasks`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 任务文档 ID。|
| `guildId` | `string` | 任务所属宗门。|
| `taskId` | `string` | 模板编号。|
| `type` | `string` | 任务类型（试炼、捐献等）。|
| `title` | `string` | 任务标题。|
| `goal` / `progress` | `object` | 目标与进度。|
| `reward` | `object` | 奖励结算数据。|
| `status` | `'open' / 'closed'` | 状态。|
| `startAt` / `endAt` / `updatedAt` | `Date` | 时间戳。|

**推荐索引**：`guildId + status`、`endAt`。

### `guildBoss`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | `guildId_bossId`。|
| `guildId` | `string` | 宗门 ID。|
| `bossId` | `string` | Boss 模板 ID。|
| `level` | `number` | Boss 等级。|
| `status` | `'open' / 'ended'` | 当前状态。|
| `hpMax` / `hpLeft` | `number` | 血量。|
| `totalDamage` | `number` | 赛季累计伤害。|
| `damageByMember` | `Record<string, number>` | 按成员统计伤害。|
| `memberAttempts` | `Record<string, { dateKey, count, lastChallengeAt }>` | 挑战次数控制。|
| `phase` | `number` | 阶段。|
| `schemaVersion` | `number` | 结构版本。|
| `createdAt` / `updatedAt` / `defeatedAt` | `Date` | 时间戳。|

**推荐索引**：`guildId + status`、`guildId + schemaVersion`、`updatedAt`（倒序）。

### `guildBattles`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 数据库自增 ID。|
| `guildId` | `string` | 宗门 ID。|
| `initiatorId` | `string` | 发起挑战的成员 ID。|
| `bossId` / `bossName` | `string` | Boss 标识。|
| `party` | `{ memberId, name, role, damage }[]` | 队伍贡献。|
| `payload` | `BattlePayload` | 战报。|
| `signature` | `string` | `signBattlePayload` 生成的 MD5。|
| `seed` | `string` | 固定随机种子。|
| `victory` | `boolean` | 是否击败 Boss。|
| `totalDamage` | `number` | 总伤害。|
| `rounds` | `number` | 回合数。|
| `schemaVersion` | `number` | 结构版本。|
| `createdAt` | `Date` | 创建时间。|

**推荐索引**：`guildId + createdAt(desc)`、`signature`（唯一）。

### `guildLeaderboard`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 缓存键，与榜单类型一一对应。|
| `entries` | `object[]` | 排行条目（含 `guildId`、`name`、`metricType` 等）。|
| `updatedAt` | `Date` | 缓存时间。|
| `schemaVersion` | `number` | 缓存结构版本号。|

> 当前支持 `power`、`contribution`、`activity` 与 `boss` 四种榜单。当 `schemaVersion` 变化或 TTL 失效时会触发重建；若刷新失败，系统会回退至最近成功的快照。

## 部署步骤

1. **安装依赖**：在仓库根目录执行 `npm install`，随后进入 `cloudfunctions/guild` 运行 `npm install`。
2. **上传云函数**：通过微信开发者工具右键部署 `guild` 云函数，同时在“函数配置 → 版本管理”中绑定统一的 `nodejs-layer`（用于复用 `common-config` 等公共模块）。
3. **同步公共模块**：确认 `common-config`、`combat-system`、`skill-engine` 等共享代码均已打包在 `nodejs-layer`，避免云函数包体超出限制。
4. **初始化集合与索引**：在云开发控制台执行 `bootstrap` 云函数：`{ "action": "runMigration", "migration": "guild-init" }`，自动创建 6 个集合、索引与示例数据。
5. **灰度与回滚**：如需回滚，执行 `{ "action": "runMigration", "migration": "guild-rollback", "force": true }`。若需灰度发布，可先在测试环境运行 `guild` 云函数并验证排行榜缓存刷新情况。
6. **前端配置**：确保小程序 `miniprogram/pages/guild/**` 已加入 `app.json`，并在 `miniprogram/services/api.js` 中开启 `GuildService` 入口。
7. **监控接入**：为 `guild` 云函数开启默认监控，配置 `errorlogs` 告警，建议设置 `5xx` 错误阈值与执行超时通知。

## 管理员操作手册

- **强制刷新排行榜缓存**：在云开发控制台执行 `guild` 云函数或通过管理员工具发起如下请求，即可刷新指定榜单。
  ```json
  {
    "action": "getLeaderboard",
    "type": "boss",
    "forceRefresh": true
  }
  ```
- **查看 Boss 状态**：使用 `{ "action": "boss.status", "guildId": "xxx" }` 读取当前 Boss 阶段与血量，若需重新开启请参考下方故障排查中的手动回滚流程。
- **导出战斗记录**：通过 `{ "action": "boss.rank", "guildId": "xxx" }` 获取赛季内全部成员伤害排行；如需单场战报，可在云开发 `guildBattles` 集合中按 `battleId` 导出存档。
- **审计风控预警**：管理员可调用 `{ "action": "admin.riskAlerts", "guildId": "xxx", "limit": 100 }` 查看最近触发的高风险操作。

## 故障排查

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 云函数报错 `ERR_GUILD_SIGNATURE_INVALID` | 前端传入 payload 被篡改或重放攻击 | 校验 `signature` 与 `seed`，必要时重置 `schemaVersion` 并刷新缓存。|
| Boss 挑战返回 `rate_limit_exceeded` | 成员挑战频率过高 | 检查 `guildRateLimits` 文档并调整限流策略或冷却时间。|
| 排行榜数据未更新 | 缓存 TTL 未到或刷新失败回退 | 使用 `forceRefresh: true` 再次请求，或查看 `errorlogs` 中的刷新异常。|
| 宗门任务进度停滞 | 定时任务未触发 | 确认 `guild` 云函数中的 `cron` 触发器是否部署，并检查 `guildCache` 是否存量数据过期。|

## FAQ

- **问：如何在测试环境快速创建宗门示例数据？**
  - 答：执行 `bootstrap` 的 `guild-init` 迁移脚本会自动生成 `guild_demo_crane` 等示例宗门与成员。
- **问：排行榜支持哪些排序方式？**
  - 答：目前提供 `power`（战力）、`contribution`（贡献）、`activity`（活跃度）与 `boss`（Boss 伤害），未来可通过在 `guildLeaderboard` 中新增 `metricType` 扩展。
- **问：如何保证战斗结果可复盘？**
  - 答：所有战斗在服务端模拟并写入 `guildBattles`，结合 `signature` 与 `seed` 可在后台重放；管理员可以通过 `battle-schema` 工具链还原完整战斗过程。
- **问：成员退出宗门后数据如何处理？**
  - 答：`guildMembers` 文档保留历史贡献与活跃度，仅将 `role` 置为 `former` 并记录退出时间；相关排行榜会在下一轮刷新时剔除该成员贡献。

---

**自检清单**：

- [x] 覆盖功能概览、接口、数据结构、部署、运维及 FAQ。
- [x] 纳入管理员强制刷新 `guildLeaderboard` 示例。
- [x] 确认与 README 部署说明一致。
