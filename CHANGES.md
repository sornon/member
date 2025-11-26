# 变更记录

## [Unreleased]

- 新增 `guild` 云函数与 `guild-service`，实现宗门创建、加入、团队讨伐、排行榜缓存及安全校验。
- 增强宗门安全风控：统一施加 10 秒冷却与日上限，记录异常到 `guildRateLimits`/`errorlogs`/`guildLogs`，支持后台 `admin.riskAlerts` 查询与新增风控单元测试。
- 扩展 `common-config` / `system-settings` 增加宗门相关常量与配置归一化方法。
- 新增小程序宗门页面（大厅、成员、任务、Boss、事件、详情、创建、团队讨伐）与 `GuildService` 调用层。
- 在 `cloudfunctions/bootstrap/migrations/` 中编写宗门初始化与回滚脚本，支持集合创建、示例数据写入与安全回退。
- 引入 Jest 测试配置及宗门单元/E2E 测试，覆盖率 ≥70%。
- 更新 `README.md` 与新增 `docs/guild.md` 说明部署、监控与测试流程。
- 重构 `cloudfunctions/guild/index.js`，统一动作路由、代理上下文与日志写入；新增 `constants.js` 管理限流冷却、`error-codes.js` 汇总错误码。
- 扩展 `cloudfunctions/guild/guild-service.js` 提供 `create`、`profile`、`boss.challenge` 等动作骨架与成功/失败日志接口，并更新单元测试覆盖防刷逻辑。
- 将单测覆盖阈值的分支指标暂调至 55%，在功能占位阶段兼顾骨架可测性与后续实现空间。
- 完成公会 Boss 挑战的服务端模拟、阶段机制与战报持久化，新增 `cloudfunctions/guild/boss-definitions.js`、扩展 `guild-service` 及 `system-settings`，并补充确定性种子与并发写入单测。
- 更新 `README.md` 与 `docs/guild.md`，补充 Boss 战斗流程、集合结构与部署说明。
- 重构 `guildLeaderboard` 缓存：引入 `power`/`contribution`/`activity`/`boss` 多榜单缓存，合并宗主头像框与称号目录，返回 `myRank` 并在 schema 变更或 TTL 过期时自动重建；完善单元测试覆盖刷新逻辑。
- 新增 `__tests__/guild/` 测试套件覆盖宗门创建、审批、捐献、任务领取、Boss 挑战、排行榜的成功/失败/边界场景，补充种子一致性、并发写入与端到端流程用例，并提供 `scripts/benchmarks/guild-boss-benchmark.js` 性能基准脚本。
- 新增宗门运维手册 `docs/guild.md`，补充接口对照表、部署步骤、管理员刷新排行榜示例与 FAQ；更新 `README.md` 集合清单及 `guild` 云函数绑定 `nodejs-layer` 的部署提醒。
- 修复 BHK 感恩节活动页称号图片未从云端 `/assets/title/` 读取的问题，展示逻辑与会员首页的称号图片获取方式保持一致。
- 感恩节通行证购票状态与席位库存现已持久化：云函数新增全局库存表与支付后确认接口，活动页可识别既有权益并阻止重复购票，库存同步到0后自动禁购。
- 感恩节活动总席位数改为实时读取 `bhkBargainStock.totalStock`，活动页主卡与规则说明均展示动态库存上限，杜绝固定 15 席的误导。
- 修复支付确认流程携带 `_id` 字段导致云函数报错、库存不减的问题：写入砍价会话与库存时去掉 `_id` 字段，确保支付后库存立即扣减且不再出现 `_id` 更新报错。

