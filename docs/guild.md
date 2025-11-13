# 宗门系统与团队玩法设计说明

> 适用于仓库 `sornon/member` 的新增宗门玩法，覆盖云函数、数据库、前端页面、部署脚本、监控与回滚能力。所有接口均遵循 `cloudfunctions/pvp/index.js` 的返回结构与错误处理风格。

## 功能概览

- **宗门大厅**：成员可查看当前宗门、热门宗门排行榜与入门引导，界面位于 `miniprogram/pages/guild/index`。
- **宗门创建与加入**：通过 `guild` 云函数的 `createGuild`、`joinGuild` 动作完成，需持有一次性令牌（MD5 签名），并带有速率限制防止刷库。
- **团队讨伐玩法**：`initiateTeamBattle` 将根据宗门成员战力生成固定随机种子的战斗回放（`battle-schema`），所有结算在服务端完成，返回 MD5 签名的战斗结果与奖励。
- **前后台打通**：管理员可沿用既有 `admin-proxy` 能力审计操作，事件流水写入 `guildEventLogs` 便于运维排查。

## 数据库设计

所有集合均位于 CloudBase，首次部署请执行 `scripts/guild-migrate.js --envId=<envId>` 自动创建集合与索引，集合结构如下：

| 集合 | 说明 | 主要索引 |
| ---- | ---- | ---- |
| `guilds` | 宗门档案，含名称、宣言、图标、成员数、战力等 | `power:-1`、`memberCount:-1` |
| `guildMembers` | 宗门成员与角色、战力、加入状态 | `guildId:1,status:1`、`memberId:1` |
| `guildBattles` | 团队讨伐战斗记录及签名 | `guildId:1,createdAt:-1` |
| `guildCache` | 高频读取缓存（排行榜等），含 `schemaVersion` | `schemaVersion:1` |
| `guildEventLogs` | 行为审计与监控日志 | `guildId:1,createdAt:-1` |
| `guildTickets` | 一次性操作令牌，含 MD5 签名与过期时间 | `signature:1 (unique)`、`memberId:1` |
| `guildRateLimits` | 速率限制窗口，避免刷操作 | `action:1,memberId:1` |

> **回滚提示**：如需彻底清理宗门数据，可执行 `scripts/guild-rollback.js --envId=<envId> --force` 将上述集合清空。

## 云函数接口

`cloudfunctions/guild/index.js` 暴露以下动作，所有返回都包含结构化错误码：

| 动作 | 描述 |
| ---- | ---- |
| `overview` | 返回当前宗门、成员信息、排行榜、操作令牌与配置（含 `teamBattle` 参数）。|
| `listGuilds` | 读取缓存化的排行榜列表，若缓存失效则自动刷新。|
| `createGuild` | 校验令牌与速率后创建宗门并写入成员记录，仅允许单宗门。|
| `joinGuild` | 复用令牌机制加入宗门，支持重复加入恢复。|
| `leaveGuild` | 成员退出宗门，自动扣减人数（宗主需走后台转让）。|
| `initiateTeamBattle` | 依据队伍成员战力生成固定随机种子的战斗回放，并写入战斗历史、刷新排行榜。|
| `refreshTicket` | 手动刷新一次性令牌，前端用于二次提交。|

### 安全策略

- **令牌与签名**：`overview` 返回随机令牌，经服务器以 `md5(ticket:secret)` 签名后落库。所有敏感操作需携带令牌 + 签名，服务器校验并记录使用次数。
- **速率限制**：`guildRateLimits` 记录操作时间窗口，超限触发 `RATE_LIMITED` 错误码。
- **战斗签名**：团队讨伐生成的 `battle` 结果通过 `signBattlePayload` (MD5) 标记，前端只展示不可篡改的回放。

## 前端改动

- `miniprogram/services/api.js` 新增 `GuildService`，所有小程序调用统一走 `wx.cloud.callFunction('guild')`。
- `app.json` 注册宗门相关页面：
  - `pages/guild/index/index`：宗门大厅与排行榜
  - `pages/guild/create/index`：创建宗门表单
  - `pages/guild/detail/index`：宗门详情与加入
  - `pages/guild/team/index`：团队讨伐入口
- 页面样式采用与 PVP 相同的深色渐变风格，按钮遵循现有配色与圆角规范。

## 运维与监控

- `guildEventLogs` 存储所有关键行为，字段包括 `type`、`guildId`、`actorId`、`details`、`createdAt`，便于快速检索。
- 每次战斗、创建、加入操作均落地日志，同时刷新排行榜缓存，满足可观测需求。
- 错误与告警沿用通用 `errorlogs` 机制，前端调用失败会自动写入。

## 部署步骤

1. **安装依赖**：在仓库根目录执行 `npm install`（安装 Jest 依赖）。
2. **初始化数据库**：运行 `node scripts/guild-migrate.js --envId=<envId>` 创建集合及索引。
3. **部署云函数**：微信开发者工具或 CI 执行 `cloudfunctions/guild` 目录的依赖安装与上传。
4. **更新前端**：上传 `miniprogram` 目录，确保新页面已列入 `app.json`。
5. **配置系统参数**：在 `systemSettings` 集合 `feature_toggles` 文档新增/更新 `guildSettings`（可修改 `maxMembers`、`secret`、`teamBattle` 等）。

## 测试

- 单元测试：`npm test` 将执行 `cloudfunctions/guild/__tests__` 下的用例，覆盖率约 80%（>70% 要求）。
- 关键路径 E2E：`guild-e2e.test.js` 模拟从建宗到讨伐的完整流程，验证令牌、战斗签名、奖励计算。

## 回滚方案

- 前端回滚：重新发布旧版本小程序代码。
- 后端回滚：使用 Git 回退版本并重新部署云函数；如需清理数据，运行 `scripts/guild-rollback.js --envId=<envId> --force`。
- 设置回滚后，重新运行 `scripts/guild-migrate.js` 可恢复空集合结构。

## 自检清单

- [x] 云函数单元测试与 E2E 用例通过（`npm test`）。
- [x] 新增集合具备索引与迁移、回滚脚本。
- [x] 前端页面接入统一服务层，UI 与 PVP 风格一致。
- [x] 文档覆盖部署、监控、回滚、测试说明。
