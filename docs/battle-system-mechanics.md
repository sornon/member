# 战斗系统机制总览

## 1. 系统架构
- **服务端流程**：PVE 云函数使用公共战斗模块创建玩家与敌人战斗体（Actor），随后在最多 15 个回合内循环执行 `takeTurn`，并将每次行动封装为结构化时间线条目（含技能、事件、血量、控制状态等），作为战斗记录返回前端。 【F:cloudfunctions/pve/index.js†L7548-L7694】【F:cloudfunctions/pve/index.js†L7888-L7951】
- **模块划分**：`combat-system` 负责属性归一化、命中/伤害公式与战斗力计算；`skill-engine` 实现资源系统、状态机、技能执行与回合控制；`pve`/`pvp` 仅组合上述模块形成具体玩法。 【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L3-L567】【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L1-L1701】
- **前端回放**：小程序根据时间线重建结构化战斗视图，依速度判定重排回合先后，再驱动动作队列渲染战斗舞台、浮动文字和攻击动效。 【F:miniprogram/shared/battle.js†L1681-L2056】【F:miniprogram/shared/battle.js†L439-L596】【F:miniprogram/pages/battle/play.js†L520-L2100】

## 2. 属性与基础结算
- **基础与特种属性**：默认战斗属性覆盖生命、攻防、命中/闪避、暴击、终伤、吸血等，特种属性含护盾、额外伤害、反弹等，输入会根据别名与百分比规则自动归一化并限制范围。 【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L3-L205】
- **命中与闪避**：基础命中率为 `clamp(0.85 + (命中 − 闪避) × 0.005, 0.2, 0.99)`，并额外检定防守方被动闪避（含控制导致的禁止闪避）。 【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L279-L292】【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L785-L840】【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L1204-L1216】
- **伤害路径**：分别计算物理与法术伤害 `max(攻击×25%, 攻击 − 有效防御)`，取较高者，并叠加 0.9~1.1 随机浮动、额外伤害、暴击放大、终伤修正，最低伤害为 1 点。 【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L294-L337】【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L1268-L1297】
- **治疗与吸血**：暴击、吸血、命中治疗等会在每次命中后结算，同时考虑治疗增减系数与被动回血、反弹等特效。 【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L337-L349】【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L1298-L1355】
- **战斗力评估**：综合攻防、速度、命中、终伤、护盾等系数，生成整数战力数值用于匹配与奖励算法。 【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L352-L418】

## 3. 战斗循环流程
1. **创建 Actor**：`createActorRuntime` 基于角色属性、技能栏与资源配置生成战斗体，初始化血量（护盾算入）、真气上限、技能冷却、控制快照等。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L289-L717】
2. **回合开始**：`takeTurn` 先递减冷却、结算回合真气收益与持续状态（DOT、睡眠真气、控制跳过等）；若角色死亡或被控制跳过，立即返回“无法行动”条目。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L585-L1031】【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L1558-L1615】
3. **技能选择**：优先遍历已装备技能，需满足冷却、资源与沉默限制，否则退回普攻；控制可禁用主动或普攻。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L1035-L1068】
4. **资源扣除**：若技能有真气消耗，将尝试扣费，失败时改用普攻并重新评估消耗。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L1618-L1635】
5. **技能执行**：按描述列表依次处理多段伤害、DOT、条件伤害、跟进攻击、增益/减益、护盾、控制检定（含命中率）、资源获取（受伤、暴击、被暴击、反弹等）。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L1120-L1535】
6. **回合收尾**：记录技能品质信息，刷新冷却、递减状态剩余回合，更新控制标记。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L1538-L1670】

## 4. 状态与资源机制
- **控制模板**：眩晕/冰冻/沉默/睡眠定义了是否跳过、禁止技能或闪避、火焰破冰减伤、沉睡真气恢复等行为。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L32-L167】
- **状态管理**：`addStatus` 支持属性增减、护盾（含反弹/爆破）、额外伤害领域、控制、DOT 等类型，并在每回合自动递减和清理。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L843-L1556】
- **资源流转**：资源系统支持起始真气、回合回复、普攻与受击增益、暴击增益，所有改动都会生成事件以供前端展示。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L289-L590】
- **控制互动**：火系攻击可熔解冰冻并按配置减伤，持续伤害会唤醒沉睡，记录在战斗摘要中。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L700-L759】【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L1241-L1317】

## 5. 技能效果覆盖
| 技能 | 核心机制 | 主要数值/备注 |
| --- | --- | --- |
| 破云斩 | 单段物理输出，暴击附加额外倍率 | 物理倍率 1.2 起，每级 +0.04，暴击额外 +0.3，每级 +0.02。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L23-L37】 |
| 熔血怒元 | 自疗并施加反伤状态 | 治疗上限 15%HP，每级 +0.8%，反弹 10% 起每级 +1%，持续 2 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L39-L58】 |
| 流光剑步 | 物理突进与速度增益 | 伤害倍率 1.4 起，每级 +0.03，速度 +12% 起，每级 +0.5%，持续 2 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L59-L83】 |
| 烈炽火弹 | 法术伤害并附加燃烧 DOT | 法术倍率 1.0 起，每级 +0.02，燃烧比率 0.2 起，每级 +0.02，持续 2 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L84-L106】 |
| 凝霜矢 | 法术输出并降低目标速度 | 法术倍率 1.3 起，每级 +0.03，速度 -30% 起，每级 -1%，持续 2 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L107-L131】 |
| 焚血激 | 与熔血怒元同构的自疗反伤版本 | 治疗与反伤成长略高，持续 2 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L132-L151】 |
| 灵契术 | 提升召唤类能力 | 召唤强度 +15% 起，每级 +1%，持续 3 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L152-L169】 |
| 木灵惠泽 | 自疗并提高治疗增益 | 治疗 18%HP 起，每级 +0.8%，治疗增益 +20% 起，每级 +1%，持续 3 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L170-L191】 |
| 凌霜定潮 | 法术输出并削减终伤加成 | 伤害 1.3 起，每级 +0.02，终伤加成 -0.2 起，每级 -0.01，持续 2 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L192-L215】 |
| 霜渊天缚 | 高倍率法术 + 眩晕 + 爆裂跟进 | 伤害 1.7 起，每级 +0.04，60% 基础眩晕，附带 0.4 爆发追击。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L217-L240】 |
| 灼脉流炬 | 法术与燃烧条件追加伤害 | 基础 1.45 起，每级 +0.03；若目标燃烧再追加 0.3，每级 +0.02。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L242-L262】 |
| 烈羽焚锋 | 双段物理 + 燃烧 DOT | 每段 1.35 起、双击；燃烧基于物攻 15% 起，每级 +1%，持续 2 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L264-L287】 |
| 雷霆断界 | 三段物理 + 短暂眩晕 | 单段 0.6 起，每级 +0.04，50% 眩晕 1 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L288-L308】 |
| 万雷劫链 | 高爆发法术 + 眩晕 | 倍率 2.2 起，每级 +0.05，40% 眩晕 1 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L309-L327】 |
| 千刃星陨 | 四段物理连击 | 单段 0.7 起，每级 +0.03，连续 4 次。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L329-L343】 |
| 蚀骨符 | 降双防并施加剧毒 | 物防/法防 -10% 起，每级 -0.5%，附魔攻系数 0.1 毒，每级 +0.005，持续 3 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L344-L379】 |
| 定神符 | 小额法伤 + 高概率眩晕 | 伤害系数 0.5，80% 基础眩晕 1 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L380-L398】 |
| 镇魂神符 | 沉默并压制治疗 | 沉默 70% 起，每级 +2%，治疗获得 -0.2 起，每级 -0.02，持续 2 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L400-L422】 |
| 断厄符索 | 法术伤害并削弱真气获取 | 伤害 1.2 起，每级 +0.02，真气增益 -0.2 起，每级 -0.01，持续 3 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L423-L447】 |
| 戮仙剑域 | 自身额外伤害领域 | 额外伤害比率 0.5 起，每级 +0.02，持续 3 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L448-L463】 |
| 离火焚天 | 高爆发 + 减终减 + 强燃烧 | 伤害 1.8 起，每级 +0.04，终减 -0.15 起，每级 -0.01，燃烧 0.3 起，每级 +0.015，持续 3 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L464-L496】 |
| 焚世熔炉 | 大额护盾附反伤与爆破 | 护盾 40%HP 起，每级 +3%，反伤 20% 起每级 +1%，护盾结束触发 2.5 倍爆裂。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L498-L515】 |
| 太乙护界 | 护盾 + 终减增益 | 护盾 30%HP 起，每级 +2%，终减 +0.2 起，每级 +0.01，持续 3 回合。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L517-L541】 |
| 帝御九霄 | 提升召唤与额外伤害爆发 | 召唤强度 +40% 起，每级 +2%，并在 1 回合内额外 +100% 伤害，每级 +5%。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L542-L565】 |

## 6. 时间线与前端动效
- **时间线解析**：前端依据结构化条目整合双方血量、资源、控制与累计数据，计算初始 HP/MaxHP/真气，并对同回合动作按双方速度重新排序，保证表现与服务端一致。 【F:miniprogram/shared/battle.js†L1681-L2056】【F:miniprogram/shared/battle.js†L439-L596】
- **动作队列**：播放页维护动作索引，基于行动类型决定是否启用攻击指示条，并在指标显示、蓄力、命中、收招阶段布置计时器，同时投放伤害/治疗飘字与控制状态切换。 【F:miniprogram/pages/battle/play.js†L1680-L2091】
- **动效节奏**：关键时序采用常量（指示 1000ms、渐隐 180ms、蓄力 240~340ms、暴击额外停顿 300ms、命中定格 140ms、收招 360ms、缓冲 220ms），保证不同技能共享统一节奏并允许暴击/闪避定制。 【F:miniprogram/pages/battle/play.js†L552-L562】【F:miniprogram/pages/battle/play.js†L1765-L1993】

## 7. 扩展与重构建议
- 将所有新增技能映射为 `damage`/`healSelf`/`buffs`/`debuffs`/`control`/`dots`/`followUp` 描述块即可继承现有执行管线；若需新效果，可在 `addStatus` 与 `resolveEffectiveStats` 扩展新状态类型。 【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L843-L1190】
- 前端若引入新战斗资源或行动相位，只需在时间线条目 `state.resource` 与播放页常量中补充对应字段，即可保持播放同步。 【F:cloudfunctions/pve/index.js†L7888-L7951】【F:miniprogram/pages/battle/play.js†L1680-L2091】
