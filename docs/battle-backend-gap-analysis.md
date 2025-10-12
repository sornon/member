# 云函数战斗数据对齐现状

## 最新状态（2025-10-12 更新）
- PVE 云函数已在模拟阶段实时生成结构化时间线、参战者快照与标准化结果摘要，`runBattleSimulation` 在每次行动后写入 `timeline`，并通过 `buildBattleOutcome`、`formatBattleResult` 输出精简后的 `participants`、`timeline`、`outcome`、`metadata` 与奖励字段，彻底移除了冗余的日志负载。【F:cloudfunctions/pve/index.js†L7353-L7486】【F:cloudfunctions/pve/index.js†L7850-L7927】
- PVP 云函数使用相同的事件模型构建回放数据，`simulateBattle` 产出的 `timeline` 与 `buildStructuredBattleOutcome` 输出的结果结构与 PVE 一致，存档及 `battleReplay` 接口均透传该结构以服务前端播放与战斗总结。【F:cloudfunctions/pvp/index.js†L640-L716】【F:cloudfunctions/pvp/index.js†L1747-L1814】
- 小程序战报页现已统一依赖结构化字段：加载回放时会合并云函数返回的 `participants` 与 `outcome`，为旧数据提供兼容降级，同时刷新轮次视图以展示双方剩余生命值，避免再从头像地址派生角色形象。【F:miniprogram/pages/pvp/battle.js†L1-L285】【F:miniprogram/pages/pvp/battle.wxml†L1-L35】

## 遗留风险与关注点
- 历史战报可能仍缺少 `participants` 或 `outcome` 字段，前端降级逻辑需保持生效，待运营确认旧数据清理后方可移除。【F:miniprogram/pages/pvp/battle.js†L57-L233】
- 目前缺乏自动化校验来确保云函数始终返回结构化字段，建议后续补充契约测试或 Schema 校验，防止回归。

## 建议的下一步
1. **补充回归测试**：编写最小化的云函数单元测试或集成测试，验证 `battle.timeline`、`battle.participants`、`battle.outcome` 不为空，覆盖 PVE 与 PVP 流程。
2. **监控旧数据转换**：统计历史战报缺失结构化字段的比例，必要时运行一次性迁移脚本，以便前端彻底删除日志回退逻辑。
3. **持续精简字段**：上线后关注网络面板与埋点，进一步确认是否仍有可以裁剪的非必要字段（如多余的等级描述、头像冗余信息等），持续优化传输体积。
