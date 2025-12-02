# 战斗数值策划案（V1）

> 本文档聚焦数值落地与配置框架。配置文件仅包含单版数据，数值切换通过数据库集合的多条记录与 `status` 字段控制。

## 8. 实现概览与测试入口

- **配置文件**：`cloudfunctions/nodejs-layer/node_modules/balance/config/` 下的 `level-curves.json`、`equipment-curves.json`、`skill-curves.json`、`pve-curves.json`、`pvp-config.json`。每个文件只保留单套字段，版本迭代通过集合中新增记录并使用 `status`（`use`/`staging`/`backup`）切换。
- **运行时 Loader**：公共模块 `cloudfunctions/nodejs-layer/node_modules/balance/config-loader.js`（使用 `require('balance/config-loader')` 引用）提供 `getLevelCurveConfig` 等方法，以及 `__resetBalanceCache`（测试用）。缺失字段自动回退到默认常量。
- **战斗模拟入口**：公共模块 `cloudfunctions/nodejs-layer/node_modules/balance/simulator.js`（使用 `require('balance/simulator')` 引用）提供 `simulatePveBattle`、`simulatePvpBattle`，使用现有战斗引擎（combat-system / skill-engine），可带 seed 复现。
- **自动化测试**：
  - 配置加载回退测试：`cloudfunctions/nodejs-layer/__tests__/balance/config-loader.test.js`
  - 数值极值安全：`cloudfunctions/nodejs-layer/__tests__/balance/simulator.test.js`
- **CLI/脚本（预留）**：后续可在 `scripts/balance/` 下补充批量模拟脚本，接入 `simulator.js` 打印胜率、平均回合数等指标。
- **公共模块引用规范**：云函数层共享模块统一使用包名方式（如 `require('balance/...')`、`require('system-settings')`），避免通过相对路径访问，以免后续目录调整导致引用失效。

> 如需在开发/测试环境启用新方案：在 balance 配置集合新增一条 `status=staging` 的记录并在管理后台触发“应用”以切换到 `status=use`，或通过 `BALANCE_CONFIG_DIR` 指向自定义配置目录进行本地验证。
