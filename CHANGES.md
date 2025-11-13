# 变更记录

## [Unreleased]

- 新增 `guild` 云函数与 `guild-service`，实现宗门创建、加入、团队讨伐、排行榜缓存及安全校验。
- 扩展 `common-config` / `system-settings` 增加宗门相关常量与配置归一化方法。
- 新增小程序宗门页面（大厅、详情、创建、团队讨伐）与 `GuildService` 调用层。
- 编写 `scripts/guild-migrate.js`、`scripts/guild-rollback.js` 以支持上线迁移与回滚。
- 引入 Jest 测试配置及宗门单元/E2E 测试，覆盖率 ≥70%。
- 更新 `README.md` 与新增 `docs/guild.md` 说明部署、监控与测试流程。
