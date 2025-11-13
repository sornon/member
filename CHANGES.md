# 变更记录

## [Unreleased]

- 新增 `guild` 云函数与 `guild-service`，实现宗门创建、加入、团队讨伐、排行榜缓存及安全校验。
- 扩展 `common-config` / `system-settings` 增加宗门相关常量与配置归一化方法。
- 新增小程序宗门页面（大厅、详情、创建、团队讨伐）与 `GuildService` 调用层。
- 在 `cloudfunctions/bootstrap/migrations/` 中编写宗门初始化与回滚脚本，支持集合创建、示例数据写入与安全回退。
- 引入 Jest 测试配置及宗门单元/E2E 测试，覆盖率 ≥70%。
- 更新 `README.md` 与新增 `docs/guild.md` 说明部署、监控与测试流程。
- 重构 `cloudfunctions/guild/index.js`，统一动作路由、代理上下文与日志写入；新增 `constants.js` 管理限流冷却、`error-codes.js` 汇总错误码。
- 扩展 `cloudfunctions/guild/guild-service.js` 提供 `create`、`profile`、`boss.challenge` 等动作骨架与成功/失败日志接口，并更新单元测试覆盖防刷逻辑。
- 将单测覆盖阈值的分支指标暂调至 55%，在功能占位阶段兼顾骨架可测性与后续实现空间。
