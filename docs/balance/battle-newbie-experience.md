# 新手战斗体验数值分析

## 1. 新手 PVE（秘境）体验分析
- **玩家初始属性推导**：
  - 基础属性基准为体质20、力量16、灵力16、根骨18、敏捷12、悟性12（未加点/装备前）。【F:cloudfunctions/pve/index.js†L2452-L2459】
  - 转换为战斗属性：生命=200+体质×20+根骨×5≈690，物/法攻=50+主属性×2≈82，物/法防≈61，速度≈92，命中≈112，闪避≈96，暴击率≈6.2%，暴伤≈1.518（使用 `deriveBaseCombatStats` 公式）。【F:cloudfunctions/pve/index.js†L8441-L8473】
  - 该结果与 `combat-system` 的默认战斗体接近，说明新手若无装备/技能加成，实战即落在此数值段。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L3-L34】

- **入门秘境敌人属性规模**：
  - 基础模板：生命920、攻击120、防御65~68、速度82、命中118、闪避88，附带小额终伤与吸血。【F:cloudfunctions/pve/index.js†L147-L165】
  - 第一境“炼气”普通层的倍率：总体基准×1，主属性×1.35，次属性×1.15，其余×0.98。【F:cloudfunctions/pve/index.js†L167-L199】【F:cloudfunctions/pve/index.js†L1880-L1895】
  - 以1层“灵木护卫”为例（主属性生命、次属性物防/吸血）：生命≈920×1.35×模板1.08≈1340，物防≈68×1.15×1.05≈82，物攻≈120×0.98≈118，速度≈82×0.98≈80，终减≈0.034，吸血≈0.019；最小命中/闪避被提到100/60，保证不会过低。【F:cloudfunctions/pve/index.js†L500-L539】【F:cloudfunctions/pve/index.js†L1914-L1948】【F:cloudfunctions/pve/index.js†L1949-L2000】

- **新手对小怪的击杀回合估计**：
  - 伤害公式要求基础伤害= max(攻×25%，攻−有效防御)，然后乘0.9~1.1浮动、暴击、终伤等；若攻击82、敌方有效防御≈82，则基础物理伤害≈82×25%=20.5，终伤倍率≈0.97，平均单击约20点。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L284-L338】
  - 敌方生命约1340，若首回合只能普攻（真气起始0，回合回复20），且暴击率仅6.2%，需要约1340/20≈67次普攻；即使偶有暴击，也难在20回合上限内击杀，出现“输出不够直接超时判负”的体验。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L19-L30】【F:cloudfunctions/pve/index.js†L10491-L10599】
  - 若玩家具备初始白装或技能加成，伤害会提升，但公式对防御的25%保底让“攻防相当”时输出非常低，仍可能无法在20回合内磨死高血怪。

- **怪物击杀玩家的估计**：
  - 敌方物攻约118，对应玩家物防≈61，基础伤害=max(118×25%，118−61)=29.5（保底占优），浮动后约30~33，终伤加成≈1.025，暴击率≈6%，平均每击约31点。
  - 玩家生命≈690，理论上需约22击才能击杀；但敌方初始真气同为0，技能释放节奏也偏慢，因此更可能在20回合时双方均存活，形成“拖到超时我方判负”的结果。

- **结论与问题点**：
  - 小怪生命与防御相对玩家基础值约2倍以上，而攻击只略高，导致双方互殴效率都低；回合上限20对玩家不利（超时判负）。
  - 命中公式基准0.85+命中差×0.005，且敌方命中118>玩家闪避96，实际命中率>95%，玩家几无闪避空间，削弱了防守端的缓冲。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L284-L291】
  - 综合来看，新手秘境“打不动、又扛得住”却因上限失败，体验挫败。

## 2. 新手 PVP（比武）体验分析
- **双方属性假设**：
  - 双方若都接近默认战斗体（生命2860、攻82、防61、速度92、终减0.024、治疗加成0.08），装备/技能差距微弱。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L3-L34】

- **易平局的原因**：
  - 回合上限15回合，超时即判平局；缺少额外斩杀或加速伤害的机制。【F:cloudfunctions/pvp/index.js†L56-L63】
  - 真气起始0，每回合仅+20，普攻+10，许多技能消耗30~50，导致前几回合频繁普攻，输出低。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L19-L30】
  - 伤害公式同 PVE，以25%保底减防为主；当攻防相当时单击伤害只有二三十点，而双方生命接近2860，完全依赖暴击才能明显拉血线。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L314-L337】
  - 默认暴击率6.2%、暴伤1.52，暴击触发率低；治疗增益0.08且未有治疗削减时，任何带治疗/吸血的技能都会显著拉长战斗。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L3-L18】【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L339-L347】
  - 没有针对 PVP 的额外终伤或防御穿透系数，导致“互相刮痧”更容易拖到平局。【F:cloudfunctions/pvp/index.js†L955-L1039】

- **延长战斗/提高平局率的关键因素**：
  - 15 回合硬上限无减伤或斩杀补偿。【F:cloudfunctions/pvp/index.js†L56-L63】
  - 资源回复低、起始为0，使得技能释放密度不足。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L19-L30】
  - 基础治疗/吸血无对称削减，配合低暴击率时，治疗往往能抵消普攻输出。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L339-L347】
  - 命中基准偏高，防守方几乎无法靠闪避拖过对手资源期，战斗节奏全由真气限制而非命中波动决定。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L284-L291】

## 3. 初步数值调整方向（不改代码）
- **提升新手输出/缩短战斗**：
  - 提高早期攻击系数或降低秘境一阶生命、防御倍率，使“攻×25%”保底更接近敌方实际防御，减少刮痧回合。
  - 为 PVE/PVP 分别设置低阶伤害增幅或穿透底线，避免攻防相当时极低输出。
- **资源与技能节奏**：
  - 上调新手段位的初始真气或回合回复，让首回合即可释放低耗技能；或降低基础技能耗蓝，提升爽感。
- **防止长时间平局/超时**：
  - PVE 可将 20 回合上限改为平局而非失败，或在后期引入斩杀/易伤累积；PVP 可在第10回合后增加终伤系数或降低治疗系数。
- **命中与治疗调节**：
  - 降低命中基准或提高新手闪避基础，让防御端有波动；同时给 PVP 追加基础治疗削减，降低无限拉扯。
