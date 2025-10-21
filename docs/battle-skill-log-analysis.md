# 战斗技能记录现状

新的公共技能引擎已在 PVE 与 PVP 战斗中生效，时间线会随回合记录真实释放的技能、连击段数以及附加状态，前端播放页能够直接渲染技能名称与动效提示。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L1-L720】【F:cloudfunctions/pve/index.js†L7337-L7510】【F:cloudfunctions/pvp/index.js†L520-L676】

## 关键改动

- **统一技能结算**：`skill-engine` 模块负责解析角色装备的技能、处理冷却与触发条件，并在 `takeTurn` 中完成多段伤害、持续伤害、控制效果等结算；PVE、PVP 分别调用该模块执行每一次行动，避免维护两套重复逻辑。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L69-L669】【F:cloudfunctions/pve/index.js†L7337-L7510】【F:cloudfunctions/pvp/index.js†L520-L676】
- **后续打击**：技能定义中的 `followUp` 以及护盾类增益的爆裂效果会在主段伤害后追加结算，相关事件和吸血、反伤等都能正确记录到时间线中。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L520-L669】
- **时间线带上技能信息**：`buildTimelineEntry` 现在会把回合实际释放的技能 ID、名称与动效写入 `timeline`，连同技能造成的多段事件一起返回给前端，从而摆脱“所有动作都显示普攻”的旧表现。【F:cloudfunctions/pve/index.js†L7641-L7672】【F:cloudfunctions/pvp/index.js†L1700-L1734】
- **竞技与副本共用技能数据**：`buildCombatSnapshot` 与 `buildBattleSetup` 会为玩家和敌人构建统一的技能负载，PVP 战斗复用会员的 PVE 技能配置，实现副本与竞技场的一致体验。【F:cloudfunctions/pve/index.js†L7210-L7227】【F:cloudfunctions/pvp/index.js†L1426-L1454】

借由上述改造，战斗时间线已经能够真实反映技能释放顺序与效果，前端播放和分析工具可直接读取结构化数据展示技能演出。
