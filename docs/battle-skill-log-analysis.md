# 战斗技能展示缺失原因与修复方案

## 问题概述
- 小程序战斗播放页会在时间线节点中寻找 `skillName` 或 `skill` 相关字段，用于在画面中弹出“释放技能”的提示。【F:miniprogram/pages/battle/play.js†L414-L435】【F:miniprogram/pages/battle/play.js†L1166-L1168】
- 当前 PVE 云函数的 `runBattleSimulation` 在构造时间线时，统一把 `skill` 字段写死为 `{ id: 'basic_attack', name: '普攻', type: 'basic' }`，并且始终调用 `performCombatAttack` 执行普通攻击，没有任何主动技能判定或冷却逻辑。【F:cloudfunctions/pve/index.js†L7359-L7454】【F:cloudfunctions/pve/index.js†L7651-L7684】
- 战斗事件数组 `events` 仅包含 `damage`、`heal`、`dodge` 等基础动作，同样缺少技能条目，导致前端无法解析出技能名称，只能显示普攻日志。【F:cloudfunctions/pve/index.js†L7380-L7438】

## 结论
战斗过程未真正触发技能释放——时间线里的 `skill` 字段被硬编码为“普攻”，模拟逻辑也只调用普通攻击函数，自然不会出现技能名称。因此“战斗过程不显示释放的技能名称”并非前端 Bug，而是后端战斗模拟尚未输出技能数据。

## 修复建议
1. **接入技能系统**：在 `runBattleSimulation` 中引入技能冷却与触发逻辑，基于角色已装备的技能决定每回合行动（选择技能、结算效果、记录技能名称）。必要时复用 `skill-model` 模块的汇总结果，确保技能数值与成长一致。
2. **丰富时间线数据**：当回合选择了技能，应把 `skill` 字段替换为对应技能的 `id/name/type`，并在 `events` 中附加技能造成的伤害、增益或控制信息，让前端能够读取并展示。
3. **补充测试用例**：为技能释放场景编写单元或集成测试，校验时间线中是否存在技能节点及其数值变化，避免回归时再次退化为纯普攻。

按以上步骤完善后，战斗演播即可正确显示技能名称与效果提示。

## 进一步现象：每回合固定出现两条伤害记录

- 当前模拟循环在每个回合内仅执行一次 `performCombatAttack` 给敌方、一次 `performCombatAttack` 给我方，随后才把 `round` 计数加一，因此时间线上天然只会出现“玩家打敌方 + 敌方回敬玩家”这两条事件。【F:cloudfunctions/pve/index.js†L7389-L7464】【F:cloudfunctions/pve/index.js†L7465-L7533】
- `performCombatAttack` 自身只返回一次结算好的 `damage` 数值，不会产生连击、DOT、范围溅射等额外事件；换言之，每次调用都只能产出一条伤害事件。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L279-L339】
- 由于缺少技能判定与附加效果，模拟结果会稳定为“每回合双方各打一记普攻”，导致数据分析或前端观感上表现为“每个人每回合恒定造成两次伤害”。

### 建议措施

1. **在出手逻辑中接入技能脚本**：根据角色已装备技能与冷却、触发条件决定调用何种结算函数，而不是无条件调用 `performCombatAttack`。
2. **扩展事件生成器**：当技能具有多段伤害、DOT 或群攻效果时，为每段结算单独写入 `damage` 事件（或 `status`、`resource` 等），让时间线能真实反映“一次行动多段结算”。
3. **补齐测试与数据校验**：为常见技能写回放快照，断言每条时间线节点的 `events` 数量与内容符合期望，避免再出现“一回合恒定两条伤害”的退化表现。
