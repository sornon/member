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

## 核心规则更新

- **创建成本与奖励**：创建宗门需消耗 100000 枚灵石，宗主创建成功后立即获得 500 点宗门贡献并计入宗门总贡献。
- **灵石捐献兑换**：成员每捐献 100 枚灵石可兑换 1 点宗门贡献；兑换所得同时累加到个人贡献与宗门总贡献，用于解锁更高等级与人数上限。
- **等级与人数上限**：
  - 1 级：0 贡献，最多 10 人。
  - 2 级：累计贡献 ≥ 1,000，人数上限 15 人。
  - 3 级：累计贡献 ≥ 5,000，人数上限 20 人。
  - 4 级：累计贡献 ≥ 50,000，人数上限 30 人。
  - 5 级：累计贡献 ≥ 500,000，人数上限 50 人。
  宗门总贡献由所有成员的贡献累加而成，达到门槛后自动提升等级与人数上限。
- **Boss 讨伐贡献结算**：
  - 每次参与 Boss 挑战固定获得 10 点个人贡献，并计入宗门总贡献。
  - Boss 被击杀后，宗门全员（含参战成员）额外获得 10 点贡献。
  - 挑战奖励中的贡献数额已按上述规则重新结算，前端可直接读取 `rewards.contribution` 显示个人所得。

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
| `admin.listGuilds` | `GuildService.adminListGuilds(payload)` | `{ "page": 1, "keyword": "太虚" }` | 管理员查询宗门总览（含战力、活跃、预警）。|
| `admin.guildDetail` | `GuildService.adminGetGuildDetail({ guildId })` | `{ "guildId": "guild_demo_crane" }` | 查看指定宗门的任务、Boss 与风险详情。|
| `admin.guildMembers` | `GuildService.adminGetGuildMembers({ guildId })` | `{ "guildId": "guild_demo_crane", "order": "power" }` | 管理员分页查看宗门成员并按贡献/战力排序。|
| `admin.riskAlerts` | `GuildService.listRiskAlerts({ guildId, limit })` | `{ "guildId": "guild_demo_crane", "limit": 50 }` | 仅管理员可调用，返回风控预警。|

> 以上接口均会通过 `createError(code, message)` 统一抛错；前端需捕获 `errCode` 进行提示。所有读写请求默认带入 `wxContext.OPENID` 识别玩家身份。

## 管理员宗门管理界面

### 功能概览

小程序后台新增「宗门管理」入口（`/pages/admin/guild/index`），依托 `admin.systemOverview` / `admin.listGuilds` / `admin.guildDetail` / `admin.guildMembers` 等接口提供以下能力：

- **系统概览与全局操作**：集中展示宗门总数、成员规模、任务与 Boss 运行状态以及安全预警，实时读取云端 `guildSettings` 配置，并提供「清空宗门数据」等全局维护动作。
- **宗门总览**：按战力、活跃、贡献和安全预警快速筛选宗门，并支持关键字模糊搜索。
- **详情看板**：汇总宗门公告、任务进度、Boss 试炼伤害榜、风险日志和核心成员榜单。
- **成员列表**：管理员可按贡献、战力或加入时间排序，支持关键字过滤及包含已退出成员。

> **安全提示**：`admin.resetGuildSystem` 会删除所有宗门相关集合（`guilds`、`guildMembers`、`guildTasks`、`guildBoss`、`guildLogs` 等）并恢复默认配置，仅限具备管理员角色的账号执行，操作前请务必导出备份。

### 部署步骤

1. **云函数升级**：在云开发控制台或 CLI 中重新部署 `cloudfunctions/guild`，以加载新增的管理员接口实现。
2. **小程序代码发布**：更新小程序端代码，确保 `pages/admin/guild/index` 页面随版本一起上传；如使用体验版，请在上传前执行 `npm install && npm run build`（若需要）。
3. **管理员权限校验**：确认运营账号在 `members` 集合中具备 `admin` / `developer` / `superadmin` 等角色；如需代玩家操作，可额外通过 `admin.proxyLogin` 建立代理会话，管理员接口会同时支持直接身份和代理身份。

### 使用步骤

1. 管理员在小程序首页点击「管理员入口」→「宗门管理」。
2. 首先在系统概览区核对宗门总量、活跃成员、安全预警等指标，并按需执行「刷新总览」或「清空宗门数据」等全局操作。
3. 通过搜索或翻页选择目标宗门，点击卡片进入详情面板。
4. 在详情页查看任务、Boss、风险预警等信息，并可通过成员筛选工具定位异常成员或战力核心。
5. 如需执行敏感操作（代玩家建帮、踢人等），先在对应玩家详情页使用「代登录」功能获取代理会话，再返回宗门管理页执行相关指令。

## 数据结构

宗门系统依赖 11 个集合：其中 `guilds`、`guildMembers`、`guildTasks`、`guildBoss`、`guildBattles`、`guildLeaderboard` 为核心业务集合，`guildLogs`、`guildEventLogs`、`guildTickets`、`guildRateLimits`、`guildCache` 用于审计、风控与缓存支撑。上述集合都需要在 CloudBase 创建并按下表配置索引：

> 创建索引时，可在云开发控制台进入“数据库 → 索引 → 新建索引”，或使用 CLI：`tcb db:index:create --collection <name> --index '{"name":"idx_x","key":{"field":1},"unique":false,"expireAfterSeconds":-1}'`。除非另有说明，`background` 默认开启；TTL 为 `-1` 表示永久保留。

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
| `contribution` / `contributionTotal` | `number` | 宗门累计贡献，用于等级与人数上限计算。|
| `exp` | `number` | 累计经验。|
| `tech` | `object` | 科研/加成配置。|
| `createdAt` / `updatedAt` | `Date` | 时间戳。|

**索引配置**：

| 索引名 | 字段排序 | 唯一性 | 类型 | TTL（秒） |
| --- | --- | --- | --- | --- |
| `idx_name_unique` | `{ name: 1 }` | `true` | `normal` | `-1` |
| `idx_name_text` | `{ name: "text" }` | `false` | `text` | `-1` |
| `idx_leader` | `{ leaderId: 1, updatedAt: -1 }` | `false` | `normal` | `-1` |

> `idx_name_unique` 防止重复创建宗门；`idx_name_text` 支持模糊搜索；`idx_leader` 便于快速定位宗主并按照更新时间倒序排列。

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

**索引配置**：

| 索引名 | 字段排序 | 唯一性 | 类型 | TTL（秒） |
| --- | --- | --- | --- | --- |
| `idx_guild_role` | `{ guildId: 1, role: 1 }` | `false` | `normal` | `-1` |
| `idx_member` | `{ memberId: 1 }` | `false` | `normal` | `-1` |
| `idx_week_contribution` | `{ guildId: 1, contributionWeek: -1 }` | `false` | `normal` | `-1` |

> 建议在创建 `idx_week_contribution` 时勾选“降序”以确保排行榜分页稳定；如需强制唯一性，可在 `idx_member` 上打开 `unique` 保证成员仅存在于单个宗门。

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

**索引配置**：

| 索引名 | 字段排序 | 唯一性 | 类型 | TTL（秒） |
| --- | --- | --- | --- | --- |
| `idx_guild_status` | `{ guildId: 1, status: 1, endAt: -1 }` | `false` | `normal` | `-1` |
| `idx_end_at` | `{ endAt: 1 }` | `false` | `normal` | `-1` |

> `idx_guild_status` 带上 `endAt` 方便按照截止时间倒序筛选开放中的任务。

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

**索引配置**：

| 索引名 | 字段排序 | 唯一性 | 类型 | TTL（秒） |
| --- | --- | --- | --- | --- |
| `idx_guild_status` | `{ guildId: 1, status: 1 }` | `false` | `normal` | `-1` |
| `idx_schema_version` | `{ guildId: 1, schemaVersion: -1 }` | `false` | `normal` | `-1` |
| `idx_updated_at_desc` | `{ updatedAt: -1 }` | `false` | `normal` | `-1` |

> 如需统计 Boss 周期，可将 `idx_schema_version` 复制到日志分析环境并结合 `status` 过滤。

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

**索引配置**：

| 索引名 | 字段排序 | 唯一性 | 类型 | TTL（秒） |
| --- | --- | --- | --- | --- |
| `idx_guild_created_desc` | `{ guildId: 1, createdAt: -1 }` | `false` | `normal` | `-1` |
| `idx_signature_unique` | `{ signature: 1 }` | `true` | `normal` | `-1` |

> `idx_signature_unique` 能阻止重复战报回放被写入；若需根据战斗回合检索，可额外创建 `{ guildId: 1, rounds: -1 }` 辅助索引。

### `guildLeaderboard`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 缓存键，与榜单类型一一对应。|
| `entries` | `object[]` | 排行条目（含 `guildId`、`name`、`metricType` 等）。|
| `updatedAt` | `Date` | 缓存时间。|
| `schemaVersion` | `number` | 缓存结构版本号。|

> 当前支持 `power`、`contribution`、`activity` 与 `boss` 四种榜单。当 `schemaVersion` 变化或 TTL 失效时会触发重建；若刷新失败，系统会回退至最近成功的快照。

**索引配置**：

| 索引名 | 字段排序 | 唯一性 | 类型 | TTL（秒） |
| --- | --- | --- | --- | --- |
| `idx_updated_at_desc` | `{ updatedAt: -1 }` | `false` | `normal` | `-1` |
| `idx_schema_version` | `{ schemaVersion: -1 }` | `false` | `normal` | `-1` |

> 若需自动过期旧快照，可在 `idx_updated_at_desc` 上设置 `expireAfterSeconds` 为 `604800`（一周），以保证只保留最近的榜单数据。

### `guildLogs`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 日志文档 ID，由数据库生成。|
| `guildId` | `string` | 关联宗门 ID，安全日志可为空表示全局事件。|
| `type` | `'activity' / 'security' / 'boss' / …` | 日志类别，安全事件统一写入 `security`。|
| `action` | `string` | 触发动作标识，例如 `riskControl`、`bossChallenge`。|
| `actorId` | `string` | 操作成员 ID。|
| `severity` | `'info' / 'warning' / 'error'` | 事件级别，`recordSecurityEvent` 默认写入 `warning`。|
| `summary` | `object` | 通过 `buildSummary` 生成的结构化摘要（含 `action`、`code`、`message` 等字段）。|
| `payload` / `details` | `object` | 事件上下文，包含风控计数、战斗摘要等扩展字段。|
| `createdAt` | `Date` | 入库时间，由服务端时间戳生成。|
| `schemaVersion` | `number` | 文档结构版本，随核心逻辑升级递增。|

**索引配置**：

| 索引名 | 字段排序 | 唯一性 | 类型 | TTL（秒） |
| --- | --- | --- | --- | --- |
| `idx_guild_logs_recent` | `{ guildId: 1, createdAt: -1 }` | `false` | `normal` | `-1` |

> 运营后台的风控面板通过 `idx_guild_logs_recent` 拉取最新安全日志，若需要全局检索可追加 `{ type: 1, createdAt: -1 }` 组合索引。

### `guildEventLogs`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 事件文档 ID，由数据库生成。|
| `guildId` | `string` | 宗门 ID。|
| `type` | `string` | 事件类型，例如 `bossChallenge`、`teamBattle`、`joinGuild`。|
| `actorId` | `string` | 操作成员 ID。|
| `details` | `object` | 事件细节（战斗胜负、参与成员等）。|
| `createdAt` | `Date` | 事件写入时间（`serverTimestamp()`）。|
| `schemaVersion` | `number` | 结构版本。|

**索引配置**：

| 索引名 | 字段排序 | 唯一性 | 类型 | TTL（秒） |
| --- | --- | --- | --- | --- |
| `idx_guild_event_logs_recent` | `{ guildId: 1, createdAt: -1 }` | `false` | `normal` | `-1` |

> `recordEvent` 会为 Boss 挑战、团队试炼等关键操作写入事件日志。若需要按类型筛选，可额外创建 `{ guildId: 1, type: 1, createdAt: -1 }` 辅助索引。

### `guildTickets`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | `ticket_<hash>` 形式的文档 ID，由成员 ID 与签名哈希拼接。|
| `memberId` | `string` | 票据持有者。|
| `signature` | `string` | `memberId` + `ticket` + `secret` 生成的 MD5，用于验签并限制重复签发。|
| `issuedAt` | `Date` | 签发时间。|
| `expiresAt` | `Date` | 票据过期时间，通常为 30 分钟。|
| `consumed` | `boolean` | 是否已核销。|
| `consumedAt` / `lastUsedAt` | `Date` | 最近一次使用时间，仅在票据校验成功后写入。|
| `uses` | `number` | 使用次数统计（默认自增 1）。|
| `schemaVersion` | `number` | 结构版本。|
| `updatedAt` | `Date` | 复签时更新的时间戳。|

**索引配置**：

| 索引名 | 字段排序 | 唯一性 | 类型 | TTL（秒） |
| --- | --- | --- | --- | --- |
| `idx_guild_ticket_signature_unique` | `{ signature: 1 }` | `true` | `normal` | `-1` |
| `idx_guild_ticket_member_consumed` | `{ memberId: 1, consumed: 1 }` | `false` | `normal` | `-1` |
| `idx_guild_ticket_expires` | `{ expiresAt: 1 }` | `false` | `normal` | `-1` |

> 建议在 `idx_guild_ticket_expires` 上配置 `expireAfterSeconds: 0` 以自动清理过期票据。云函数在签发时会处理文档已存在的情况，确保重复签发会复用并刷新原文档。
> 纯读取动作（如 `boss.status`、`boss.rank`）在服务端以「只读验签」模式运行，不会立即核销票据，方便一次票据执行多个查看操作；`boss.rank` 同时取消了独立的速率限制，只要票据有效即可自由刷新榜单；写操作仍保持一次性特性。

### `guildRateLimits`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 针对成员、宗门、动作及窗口期生成的哈希。|
| `type` | `'rate' / 'cooldown' / 'daily' / 'abuse'` | 限制类型，与调用的守卫对应。|
| `memberId` | `string` | 被限制的成员 ID。|
| `guildId` | `string` | 关联宗门 ID，日限额/风控监测会写入。|
| `action` | `string` | 动作标识，例如 `boss.challenge`、`tasks.claim`。|
| `windowMs` | `number` | 限制窗口长度（毫秒），日限额则记录当日窗口。|
| `limit` | `number` | 每日/窗口允许的最大次数。|
| `count` | `number` | 当前窗口已使用次数。|
| `dateKey` | `string` | 日限额窗口日期（UTC `YYYY-MM-DD`）。|
| `lastTriggeredAt` | `Date` | 最近一次触发时间。|
| `windowStartedAt` | `Date` | 统计窗口起始时间（滥用监控使用）。|
| `flaggedAt` | `Date` | 触发风控后标记时间。|
| `expiresAt` | `Date` | 文档过期时间，守卫会设置为窗口结束。|
| `schemaVersion` | `number` | 结构版本。|

**索引配置**：

| 索引名 | 字段排序 | 唯一性 | 类型 | TTL（秒） |
| --- | --- | --- | --- | --- |
| `idx_guild_rate_limit_member_action` | `{ memberId: 1, action: 1 }` | `true` | `normal` | `-1` |
| `idx_guild_rate_limit_expires` | `{ expiresAt: 1 }` | `false` | `normal` | `-1` |

> 日志巡检推荐为 `idx_guild_rate_limit_expires` 设置 `expireAfterSeconds: 0`，从而在窗口结束后由数据库自动清理限流记录。

### `guildCache`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | `string` | 缓存键，例如 `leaderboard`、`overview`。|
| `schemaVersion` | `number` | 缓存结构版本。|
| `generatedAt` | `Date` | 缓存生成时间。|
| `expiresAt` | `Date` | 过期时间（可选字段，部分工具脚本会写入）。|
| `data` | `any` | 缓存内容（排行榜快照、统计摘要等）。|

> 默认不创建索引；如需对 `generatedAt` 做过期清理，可按需补充 `{ generatedAt: 1 }` + TTL 索引。该集合主要由迁移脚本和重置流程初始化/清除，日常运行中可选。

## 部署步骤

1. **安装依赖**：在仓库根目录执行 `npm install`，随后进入 `cloudfunctions/guild` 运行 `npm install`。
2. **上传云函数**：通过微信开发者工具右键部署 `guild` 云函数，同时在“函数配置 → 版本管理”中绑定统一的 `nodejs-layer`（用于复用 `common-config` 等公共模块）。
3. **同步公共模块**：确认 `common-config`、`combat-system`、`skill-engine` 等共享代码均已打包在 `nodejs-layer`，避免云函数包体超出限制。
4. **初始化集合与索引**：在云开发控制台执行 `bootstrap` 云函数：`{ "action": "runMigration", "migration": "guild-init" }`，自动创建 11 个集合、索引与示例数据。
5. **灰度与回滚**：如需回滚，执行 `{ "action": "runMigration", "migration": "guild-rollback", "force": true }`。若需灰度发布，可先在测试环境运行 `guild` 云函数并验证排行榜缓存刷新情况。
6. **前端配置**：确保小程序宗门页面以分包形式配置在 `miniprogram/app.json` 的 `packages/guild/**`，并在 `miniprogram/services/api.js` 中开启 `GuildService` 入口。
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
| 新建宗门后成员战力与宗门战力都为 0 | `guildMembers` 写入战力时仅读取顶层 `combatPower`/`power` 字段，未兼容 `pveProfile.attributeSummary.combatPower` 等路径 | 升级 `guild-service`，在 `extractMemberPowerFromDoc` 中补充 `pveProfile` 下的战力候选字段后重新创建或更新成员战力。|
| `guildMembers` 已有战力但 `guilds`/`guildLeaderboard` 战力始终为 0 | 建帮/入帮/退帮流程未同步累加宗门战力，`guilds.power` 仍保持初始值 | 升级 `guild-service`：创建宗门时写入创始人战力，入帮时累加成员战力，退帮时扣减成员战力，并刷新排行榜；历史数据可按 `guildMembers` 的 `power` 汇总回填到 `guilds.power` 后再强制刷新排行榜。|
| 接口返回战力正常，但小程序页面战力展示为空 | 前端模板直接调用格式化函数，未对 `guild.power`/`leaderboard.power` 预处理，首屏渲染时表达式求值为空字符串 | 升级小程序前端：在 `guild/index`、`guild/members`、`guild/detail` 页面为宗门与成员列表预先计算 `powerText`/`memberCountText`，模板直接使用文本字段即可正常展示；活跃度仅保留在数据库侧，不再前端展示。|
| 成员战力提升后宗门战力仍未更新 | 仅在建帮/入帮/退帮时变更 `guilds.power`，后续成员战力调整未做增量同步，且旧版只同步当前调用者 | 升级 `guild-service`：在获取宗门概览时对全体在帮成员执行战力巡检，批量回填 `guildMembers.power`、累加 `guilds.power` 并刷新排行榜缓存；历史数据可手动按成员战力汇总回填后再调用接口触发同步。|
| 打开宗门首页后 `guildMembers.power` 仍停留在旧值 | 仅按增量更新 `guilds.power`，部分成员战力未被写回导致历史偏差，排行榜刷新按钮也无法保障全量修正 | 升级 `guild-service`：概览请求先以成员档案重新计算全员战力，逐一回填 `guildMembers.power`，再用最新总和回写 `guilds.power` 并刷新排行榜；前端移除手动刷新按钮，进入宗门首页即加载最新数据。|
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
