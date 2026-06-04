# 战斗数值常量扫描

## 核心公式与上下限（combat-system）
- **基础属性默认值**：用于缺省补齐战斗体的初始数值，例如生命 2860、物攻/法攻 82、防御 61、速度 92、命中 112、闪避 96、暴击率 0.062、暴击伤害 1.52 等。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L3-L34】（分类：基础属性缺省）
- **特殊属性默认值**：默认护盾/额外伤害/闪避率等均为 0，用于特殊效果占位。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L36-L47】（分类：特殊属性缺省）
- **属性归一化上下限**：暴击率限制 0~0.95，暴击伤害最小 1.2，终伤加成为 -0.9~2，终伤减免 0~0.9，吸血 0~0.6，治疗增减 -1~1.5，减伤 0~0.8，治疗受益 -0.5~1.5，连击/格挡/反击率 0~1，特殊闪避/反伤 0~0.8。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L116-L237】（分类：属性上下限）
- **命中判定**：基础命中率 = clamp(0.85 + (命中-闪避)*0.005, 0.2, 0.99)，并在特殊闪避触发时直接 miss。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L251-L276】（分类：命中公式）
- **防穿与减防**：物理/法术穿透 = clamp(穿透评分*0.005 + 穿透加成, 0~0.6)，有效防御 = 防御*(1-穿透)。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L278-L292】（分类：防御与穿透）
- **基础伤害**：物理伤害取 max(攻*0.25, 攻-有效防)，法术同理，取更高者；最终乘以 0.9~1.1 的随机浮动。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L294-L305】（分类：基础伤害）
- **暴击**：暴击率 = clamp(攻方暴击-守方抗暴, 0.05~0.95)，暴击伤害倍率使用 max(1.2, 暴伤)；暴击后伤害乘以该倍率。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L326-L330】（分类：暴击公式）
- **终伤与最低伤害**：终伤系数 = max(0.1, 1 + 终伤加成 - 终伤减免)，结果至少为 1 点伤害。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L332-L337】（分类：终伤系数）
- **吸血与治疗限额**：吸血率 clamp 到 0~0.6，治疗乘以 clamp(1 + 治疗增益 - 治疗压制, 0~2)；可叠加“命中回血”固定值。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L339-L347】（分类：治疗/吸血）
- **战斗力权重**：生命*0.35、双攻*1.8、防御*1.45、速度*1.2、命中*0.9、闪避*2.5、暴击率*520、暴伤溢出*180、终伤加成*650、终伤减免*-480、吸血*420、治疗加成*380、各类穿透/抗性/连击等对应系数。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L352-L418】（分类：战斗力权重）

## 资源与控制（skill-engine）
- **资源默认配置**：真气类型，最大 100，初始为 0（可按百分比设置），每回合回复 20，普攻获得 10，受击按掉血比例*1.5*上限，暴击/被暴击各 +1。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L19-L90】【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L320-L361】（分类：资源基础值）
- **控制效果参数**：冰冻被火击碎后伤害乘 0.1；睡眠被打醒且每回合额外获 10 资源；眩晕/冰冻禁用普攻/主动/闪避，沉默仅禁用主动。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L32-L103】【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L440-L455】（分类：控制效果）

## 技能倍率与冷却（skill-engine/config）
- **基础普攻**：无冷却，自动判定物攻/法攻。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L7-L20】（分类：普攻设定）
- **示例主动技能倍率**：
  - 破云斩：物理 1.2 倍，每级 +0.04，暴击额外 +0.3，每级 +0.02，冷却 2。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L22-L38】（分类：物理输出）
  - 熔血怒元：自疗 15% 最大生命，每级 +0.008；反伤 10%，每级 +0.01，持续 2；冷却 4。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L39-L57】（分类：治疗/反伤）
  - 凝霜矢：法术 1.3 倍，每级 +0.03；降低速度 -30%，每级 -0.01，持续 2；冷却 3。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L107-L120】（分类：减速控场）
  - 霜渊天缚：法术 1.7 倍，每级 +0.04；眩晕 60%，每级 +0.02，持续 2；后续额外 0.4 倍法伤；冷却 5。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L200-L222】（分类：控制爆发）
  - 千刃星陨：物理 0.7 倍 ×4 段，每级 +0.03，冷却 4。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L320-L331】（分类：多段输出）
  - 太乙护界：护盾 30% 最大生命，每级 +0.02，减伤 +0.2，每级 +0.01，持续 3；冷却 7。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L356-L370】（分类：护盾减伤）
- **资源消耗**：若 skill-model 定义了 `params.cost` 会取整为 ≥0，否则默认 0；冷却未配置时默认为 3 回合，最低 1。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/config.js†L374-L405】（分类：资源/冷却缺省）

## PVE（秘境）数值常量（cloudfunctions/pve）
- **全局限制**：角色等级上限 100，技能槽 3，战斗冷却 10s。【F:cloudfunctions/pve/index.js†L118-L129】（分类：玩法边界）
- **敌方默认战斗属性**：命中 110、暴击率 0.05、暴击伤害 1.5，其余攻防/速度初始为 0。【F:cloudfunctions/pve/index.js†L131-L143】（分类：PVE 敌人缺省）
- **秘境基础属性**：生命 920、物/法攻 120、防御约 68/65、速度 82、命中 118、闪避 88、暴击率 0.06、暴伤 1.52，附带终伤加成 0.025、减免 0.035、吸血 0.015、控制命中/抗性和穿透 9。【F:cloudfunctions/pve/index.js†L147-L165】（分类：PVE 基础属性）
- **秘境成长与倍率**：基础系数 1，楼层成长 0.08，境界成长 0.34；普通敌人主属性 1.35、次属性 1.15、弱属性 0.85；Boss 基础 1.22、主属性 1.68、次属性 1.34、弱属性 0.88；终伤/暴击等上限：暴击率 0.45、暴伤 2.15、终伤加成 0.4、终伤减免 0.55、吸血 0.18，命中上限 520、闪避 420。【F:cloudfunctions/pve/index.js†L167-L188】（分类：PVE 成长与上限）

## PVP 比武常量（cloudfunctions/pvp）
- **赛季与战斗规则**：赛季长度 56 天；单场回合上限 15；战斗冷却 10s；初始 Elo 1200。【F:cloudfunctions/pvp/index.js†L56-L63】（分类：PVP 规则）
- **段位区间**：青铜 0-999，白银 1000-1499，黄金 1500-1999，白金 2000-2399，钻石 2400-2799，宗师 ≥2800，并绑定对应奖励档。【F:cloudfunctions/pvp/index.js†L65-L81】（分类：PVP 段位）

## 配置化切入点
- 战斗资源默认值可通过 `configureResourceDefaults` 覆盖（真气上限/回复/获取系数等）。【F:cloudfunctions/nodejs-layer/node_modules/skill-engine/index.js†L320-L361】
- 秘境参数使用 `SECRET_REALM_TUNING` 可集中调整成长/倍率/上限。【F:cloudfunctions/pve/index.js†L167-L188】
- PVP 调用 `buildResourceConfigOverrides` 时可套用 `system-settings` 中的全局参数，便于玩法间区分。【F:cloudfunctions/pvp/index.js†L96-L119】
