# 战斗模型审计报告（当前实现）

## 1. 战斗系统整体架构概览
- **服务端流程**：
  - PVE 入口 `runBattleSimulation` 使用 `createActorRuntime` 生成玩家与敌方战斗体，按速度决定回合出手顺序，在最多 20 回合内循环 `executeSkillTurn`/`takeTurn` 并累积 `timeline`。 `timeout` 会直接判为失败，失败/平局也会写入结构化参与者和结果。 （`cloudfunctions/pve/index.js`）
  - PVP 入口 `simulateBattle` 同样用 `createActorRuntime` 组装双方，回合上限 15，未分出胜负时直接判平局；每回合都会记录 `buildTimelineEntry`，并在 `buildStructuredBattleOutcome` 内生成结果与双方快照。 （`cloudfunctions/pvp/index.js`）
- **核心模块职责**：
  - `combat-system`：提供属性归一化与别名解析、命中/闪避/暴击/伤害/吸血/终伤计算、战斗力评估等通用函数。 （`cloudfunctions/nodejs-layer/node_modules/combat-system/index.js`）
  - `skill-engine`：维护真气资源配置、控制状态模板、技能栏解析、回合流程（冷却递减→回合资源→状态处理→技能选择→结算→状态递减），并调用 `executeAttack` 完成命中、伤害、吸血、控制等效果。 （`cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js`）
  - PVE/PVP：分别在云函数中读取玩家/敌人/对手数据，调用 `createActorRuntime` 与 `takeTurn` 组合完整战斗；区别仅在于参与者构建、回合上限、胜负判定与奖励处理。
- **前端消费方式**：
  - `miniprogram/shared/battle.js` 优先解析结构化 `timeline`，根据 `state` 快照累计血量/真气/属性，并按速度重新排序同回合动作，生成 `actions` 队列供播放。 
  - 播放页 `miniprogram/pages/battle/play.js` 依据 `actions` 设定攻击指示条、蓄力/命中/收招的定时节奏，并渲染暴击/闪避/治疗飘字及结算卡片。

## 2. 属性与数值体系梳理
- **基础属性清单与字段名**（均在 `combat-system` 默认表或快照函数中出现）：生命 `maxHp`、物攻 `physicalAttack`、法攻 `magicAttack`、物防 `physicalDefense`、法防 `magicDefense`、速度 `speed`、命中 `accuracy`、闪避 `dodge`、暴击率 `critRate`、暴击伤害 `critDamage`、终伤加成 `finalDamageBonus`、终伤减免 `finalDamageReduction`、吸血 `lifeSteal`、治疗增益 `healingBonus`、治疗削减 `healingReduction`、控制命中/抗性、穿透、暴抗、连击、格挡、反击、减伤、受疗、怒气获取、控制强度、护盾强度、召唤强度、元素易伤等。特殊属性含护盾 `shield`、额外伤害 `bonusDamage`、额外闪避 `dodgeChance`、击中治疗、击杀治疗、反伤等。 （`cloudfunctions/nodejs-layer/node_modules/combat-system/index.js`、`cloudfunctions/pve/index.js` 快照）
- **归一化/范围**：暴击率上限 95%，暴伤下限 1.2，终伤加成 [-0.9, 2]，终减 [0, 0.9]，吸血 [0, 0.6]，治疗增益/削减 [-1, 1.5]，减伤 [0, 0.8]，受疗 [-0.5, 1.5]，连击/格挡/反击 [0,1]，特殊闪避与反伤上限 0.8；护盾非负。 （`combat-system`）
- **命中 vs 闪避**：基础命中率 `clamp(0.85 + (accuracy − dodge) × 0.005, 0.2, 0.99)`，命中后再检定防守方的特殊闪避 `dodgeChance`（上限 0.8）。控制效果若禁用闪避会清空 `dodge` 与 `dodgeChance`。 （`combat-system`、`skill-engine`）
- **物理/法术伤害**：
  - 基础伤害：物理为 `max(攻×25%, 攻 − 有效物防)`，法术同理使用魔攻与魔防减穿透，择高者作为本次伤害类型。
  - 额外处理：伤害乘以 0.9~1.1 随机浮动，叠加技能/状态附加伤害，暴击乘 `max(1.2, critDamage)`，终伤系数 `max(0.1, 1 + finalDamageBonus − finalDamageReduction)`，最少 1 点。火系可熔解冰冻并降伤，反伤在防御端额外结算。 （`combat-system`、`skill-engine`）
- **暴击与暴伤**：暴击概率为攻方暴击率减受方暴抗并限制在 5%~95%；暴击伤害倍率取攻击者 `critDamage` 与最低 1.2 之间的较高值。 （`combat-system`）
- **治疗/吸血/护盾**：
  - 吸血=伤害×`lifeSteal`×(1+治疗增益−治疗削减)，受 0~2 范围限制；技能可额外叠加击中治疗值。
  - 护盾作为特殊状态存在，可带反伤和到期爆裂追击；护盾值直接加到初始 HP 中。
  - 主动治疗按技能配置取自身最大生命比例，结算时同样计入 `totalHeal` 并写入事件。 （`combat-system`、`skill-engine`）
- **重复实现风险**：命中/伤害/暴击等核心公式同时出现在 `combat-system.executeAttack` 和 `skill-engine.executeSkill` 内部；若未来调整常量需同步两处，建议统一调用或抽离配置。

## 3. 成长与数值来源梳理
- **玩家战斗属性构建**：
  - 基础属性 = `attributes.base` + `attributes.trained`，再叠加装备与技能基值；随后通过境界加成与倍率函数 `calculateDerivedStatBlock` 转换为战斗属性与特殊属性。 （`cloudfunctions/pve/index.js`）
  - 装备加成：`sumEquipmentBonuses` 遍历装备槽，按物品定义与精炼等级累加基础属性与百分比加成，并统计套装效果。 （`cloudfunctions/pve/index.js`）
  - 技能加成：`aggregateSkillEffects` 将技能成长映射到基础属性与战斗属性（如护盾、额外伤害、闪避几率）。 （`cloudfunctions/pve/index.js`）
  - 最终战斗属性通过 `calculateAttributes` 输出 `finalStats`、`combatStats`、`skillSummary` 以及 `combatPower`，供 PVE/PVP 共用。 （`cloudfunctions/pve/index.js`）
- **敌人属性来源**：
  - `createEnemyCombatant` 直接读取敌人配置中的 `stats/finalStats/combatStats` 并套用 `ENEMY_COMBAT_DEFAULTS`；特殊属性取 `enemy.special` 并归一化百分比。 （`cloudfunctions/pve/index.js`）
  - 敌人奖励、掉落与境界等元数据也来源于敌人配置；未发现按玩家等级动态缩放的显式公式。
- **数值分散点**：装备、技能、境界成长分别在独立函数中累加；战斗公式常量散落在 `combat-system` 与 `skill-engine`，需要集中配置以便重构。

## 4. PVE（秘境）与 PVP（比武）的数值差异点
- **Actor 组装**：
  - PVE：`buildBattleSetup` 以玩家属性摘要或现算结果创建玩家战斗体，敌人通过配置转 `enemyCombatant`，双方技能栏允许包含普攻；模式标记为 `pve`。回合上限 20，超时直接判负。 （`cloudfunctions/pve/index.js`）
  - PVP：`simulateBattle` 读取双方的 `combatSnapshot`（若缺失则现算），模式 `pvp`，回合上限 15，超过仍存活即判平局。 （`cloudfunctions/pvp/index.js`）
- **数值修正/规则**：
  - PVE 超时判负导致新人在敌方血量过高或输出不足时无法平局脱身；奖励与掉落依赖 `calculateBattleRewards`，与回合数无关。
  - PVP 未设超时减伤或斩杀系数，双方防御/治疗较高时容易触发 15 回合平局；胜负仅在非平局下比较血量，未引入额外倍率。
- **问题迹象**：
  - 新手秘境“打不过”可能源于敌人 `ENEMY_COMBAT_DEFAULTS` 较高、缺少动态削弱、以及 20 回合超时即败导致高血量 Boss 无法磨死。
  - 新手 PVP 平局频发与资源回复偏低、技能冷却/消耗较高、缺乏终结机制相关。

## 5. 资源与技能循环（爽感相关）
- **资源系统**：默认真气上限 100，初始值 0，回合回复 20，普攻 +10，受击按伤害比例获取（默认 1.5），暴击/被暴击各 +1；资源类型可被技能/配置覆盖。 （`skill-engine`）
- **技能释放**：
  - 回合开始递减冷却并结算回合资源，若死亡/控制则跳过行动但会生成对应条目。
  - `chooseSkill` 依装备顺序寻找满足冷却与资源的技能，否则使用普攻；真气不足会尝试扣费失败后退回普攻。 （`skill-engine`）
  - 技能描述支持多段伤害、DOT、条件伤害、跟进攻击、控制、护盾、属性增减等；后续打击与护盾爆裂都会追加事件，资源获取贯穿伤害、受伤、暴击等节点。 （`skill-engine`）
- **爽感诊断**：
  - 初始真气为 0 且回合回复 20，若技能消耗较高（30~50）则首回合大概率只能普攻，普攻占比偏高；
  - 暴击增益仅 +1 真气，爆发频率依赖技能冷却与消耗，可能导致高潮回合稀疏。

## 6. 数值调整的切入点与风险清单
- **可配置切入点**：
  - 将命中/闪避、暴击、终伤常量（如 0.85 命中基准、0.9~1.1 浮动、暴击下限 1.2、终减上限 0.9）提取到统一配置，供 PVE/PVP 分别调整。
  - 为 PVE/PVP 独立预留回合上限与超时处理（如平局/削弱系数/斩杀线），避免硬编码在两套入口函数中。
  - 资源配置（初始值、回合回复、受击/暴击增益）集中化，便于调节技能释放频率；技能消耗/冷却应与资源曲线联动。
  - 成长曲线与装备/技能加成应拆分表驱动，集中在属性计算链的入口（如 `calculateAttributes`）以便调整。
- **高风险区域**：
  - `combat-system.executeAttack` 与 `skill-engine.executeSkill` 共用核心公式但相互独立，修改需同步或封装以防表现不一致。
  - 状态与护盾逻辑（`addStatus`/`resolveEffectiveStats`/护盾爆破）影响普攻与技能，多个玩法共享，改动需回归测试 PVE/PVP。
  - 前端 `battle.js` 对 `timeline.state.*.attributes` 有硬性依赖，任何返回格式变动会直接影响回放展示与客服复盘。
