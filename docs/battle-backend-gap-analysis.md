# 云函数战斗数据缺失原因分析

## 现状回顾
- 《战斗过程数据格式规范》已经明确要求云函数在结算阶段产出 `participants`、`timeline`、`outcome` 等结构化字段，并把参战双方的属性快照写入时间线与顶层对象，供前端回放与客服复盘直接读取。【F:docs/battle-data-format.md†L1-L118】
- 小程序端的 `miniprogram/shared/battle.js` 亦已调整为优先解析结构化时间线：如果 `battle.timeline` 中存在结构化节点，就会直接从节点的 `state`、`actor`、`events` 等字段推导血量与属性；仅在时间线为空时才回落到旧版文字日志。【F:miniprogram/shared/battle.js†L618-L740】

## 云函数未跟进的症结
1. **战斗模拟仍旧只生成文字日志**：`cloudfunctions/pve/index.js` 中的 `runBattleSimulation` 仍旧在每次攻击后向 `log` 数组追加自然语言描述，最终返回的结果只有 `log`、`remaining` 等字段，并未生成任何结构化 `timeline`。【F:cloudfunctions/pve/index.js†L7068-L7153】
2. **战斗结果格式化函数缺少结构化字段**：`formatBattleResult` 在封装返回数据时仅透传 `log`、`rewards`、`remaining` 与战力统计，既没有 `participants` 也没有 `timeline` 或属性快照，从而无法满足规范要求。【F:cloudfunctions/pve/index.js†L7391-L7450】
3. **历史实现依赖日志拼装动画**：由于早期回放流程依靠文字日志驱动，云函数侧长期未引入结构化事件模型。本次只修改前端而未同步改造云函数，导致新旧逻辑脱节。

## 导致偏差的根源
- **认知偏差**：改动集中在前端和规范文档，默认假设云函数已有或很快会输出时间线，忽略了服务端仍停留在旧实现。
- **代码复杂度影响决策**：云函数中的 PVE/PVP 模块体量庞大且逻辑分散，要在短期内重构模拟流程产出完整时间线，需要梳理大量历史逻辑；此前变更为了降低风险，选择了只在客户端层面兼容结构化数据，从而延后了真正的源头改造。
- **缺乏自动化校验**：目前无集成测试或类型校验能在前端读取 `battle.timeline` 时提示缺失，导致“接口未返回时间线”这一事实未被即时发现，也没有阻断提交。

## 后续行动建议
1. **云函数生成结构化时间线**：在 `runBattleSimulation` 内建立动作收集器，同时记录双方属性、HP 变化与事件明细，最终返回 `timeline` 数组与 `participants` 快照。
2. **统一 PVE/PVP 输出**：`cloudfunctions/pvp/index.js` 的 `resolveBattle` 与历史记录落库逻辑需要与 PVE 同步输出结构化数据，避免前端需做模式分支。
3. **增加契约校验**：为云函数返回结果添加 JSON Schema 或单元测试，确保 `participants`、`timeline`、`outcome` 字段缺失时构建失败，防止再次只修改单侧代码。

通过以上改进，可以让战斗回放真正基于同一份结构化数据，彻底告别“文字描述再推动画”的流程。  
