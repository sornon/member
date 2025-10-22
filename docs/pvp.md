# PVP 竞技场系统说明

为鼓励会员之间的实时竞争与社交传播，小程序新增了“比武竞技场”模块。该模块提供天梯积分、好友邀战、战报回放、赛季奖励与排行榜等一体化功能，完全复用现有会员与 PVE 档案数据，方便运营团队快速上线竞技玩法。

## 功能概览

- **赛季制天梯**：系统自动维护赛季周期，所有玩家以默认积分 1200 起步，根据胜负动态调整段位。赛季结束后可领取段位奖励，并记录到历史档案。
- **快速匹配与好友对战**：支持按积分区间自动匹配、挑战排行榜成员以及通过邀请链接发起切磋。若暂时缺乏真人对手，会自动生成平衡的 AI 傀儡。除自动匹配外，其余模式均视为演练赛，不会结算赛季积分与胜负战绩。
- **战报回放**：所有战斗由云函数模拟并生成结构化时间线与签名哈希，时间线需携带攻受双方的属性快照（仅返回相较上一节点发生变化的字段），前端基于这些数据驱动渲染回合动画与积分变化，保证结果无法伪造且回放与真实战斗完全一致。战斗结算统一通过 `battle-schema` 输出，复用与 PVE 相同的数据字段，减少前后端对接与运营审计时的适配成本。【F:cloudfunctions/nodejs-layer/node_modules/battle-schema/index.js†L1-L223】【F:cloudfunctions/pvp/index.js†L688-L816】
- **排行榜与分享裂变**：云函数维护赛季榜缓存，会员可在榜单内直接挑战或跳转主页面邀请好友，方便开展拉新活动。
- **安全与风控**：战斗计算固定随机种子并由服务端结算，邀战请求内置过期与状态控制，防止刷分与恶意篡改。

## 数据结构

新增以下集合（部署时请在云开发控制台中创建）：

| 集合 | 说明 |
| --- | --- |
| `pvpProfiles` | 会员 PVP 档案（积分、段位、胜负、赛季历史、战斗快照）。文档 ID 与会员 `openid` 一致。 |
| `pvpSeasons` | 赛季配置与状态，保存起止时间、序号与默认积分。 |
| `pvpMatches` | 战斗记录，包含双方信息、结构化时间线（`timeline`，含属性快照）、积分变化与签名。 |
| `pvpLeaderboard` | 排行榜缓存，用于高并发读取。 |
| `pvpInvites` | 邀战令数据，存储邀请人、渠道、随机种子与过期时间。 |

## 云函数 `pvp`

目录：`cloudfunctions/pvp`

### 主要动作

| 动作 | 描述 |
| --- | --- |
| `profile` | 初始化或返回当前会员的 PVP 档案、赛季信息、历史战绩与最近战报。 |
| `matchRandom` | 快速匹配积分接近的对手；若无人可匹配则生成 AI 傀儡。返回战斗结果、积分变化与最新排行榜预览。 |
| `matchFriend` | 挑战指定会员，复用随机种子保障结果一致。 |
| `sendInvite` | 生成邀战令并返回分享参数（邀请编号、种子、过期时间、签名）。 |
| `acceptInvite` | 接受邀战令并模拟战斗，同时更新邀战状态与战报。 |
| `battleReplay` | 根据 `matchId` 返回完整战报与签名，校验只有参战双方可查看。 |
| `getLeaderboard` | 读取或刷新赛季榜缓存，最多返回前 100 名。 |
| `claimSeasonReward` | 赛季结束后领取对应段位奖励，并写入历史记录防止重复领取。 |

### 核心逻辑

- 赛季自动轮转：当检测到当前赛季结束时会自动创建下一赛季，默认周期 56 天。
- 段位区间：系统内置青铜→宗师六档，依据积分上下限自动映射段位与奖励。
- 战斗模拟：基于会员 `pveProfile` 的最终战斗属性进行 15 回合以内的回合制结算，命中、暴击、伤害浮动与减伤均在云端处理。
- 数值统一：战斗流程直接调用公共模块 `cloudfunctions/nodejs-layer/node_modules/combat-system/index.js`，与 PVE 共用命中、伤害与战力评估公式，确保竞技场与副本的属性口径一致；基础生命值同样沿用 `200 + 体质 × 20 + 根骨 × 5` 的换算规则，由 PVE 档案中的 `attributeSummary` 提供。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L1-L210】【F:cloudfunctions/pvp/index.js†L1199-L1294】【F:cloudfunctions/pve/index.js†L5827-L5860】
- 档案快照：`pve` 云函数在写回会员档案时会刷新 `attributeSummary`，竞技场直接读取该字段即可获得包含装备、技能增益的最终战斗属性。【F:cloudfunctions/pve/index.js†L2836-L2873】【F:cloudfunctions/pve/index.js†L3377-L3452】【F:cloudfunctions/pve/index.js†L3738-L3796】【F:cloudfunctions/pvp/index.js†L1198-L1239】
- 防刷机制：邀战会校验过期时间与状态；同一战斗结果生成 MD5 签名返回前端；机器人对战的积分增减有限制，避免刷分。

### 普通攻击与技能依赖

- **无技能时仍可发动普攻**：`aggregateSkillEffects` 在未穿戴任何技能时返回全零的加成摘要，不会抛出异常；`buildCombatSnapshot` 会把该摘要与基础属性合并后交给战斗模拟使用，因此角色即便空槽也保留默认战斗面板，可以照常进入战斗流程。【F:cloudfunctions/nodejs-layer/node_modules/skill-model/index.js†L763-L785】【F:cloudfunctions/pvp/index.js†L1199-L1227】
- **战斗轮转始终执行普通攻击**：竞技场模拟每个回合依序调用 `resolveAttack`，内部直接触发 `executeAttack` 普攻计算，不依赖任何主动技能配置，所以双方会持续进行普攻直至其中一方倒下或达到回合上限。【F:cloudfunctions/pvp/index.js†L513-L559】【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L280-L349】

#### 普通攻击伤害公式

1. **命中判定**：以 `0.85 + (命中 - 闪避) × 0.005` 计算基础命中率（限制在 20%~99%），再叠加防守方被动闪避几率；任一检定失败则该次攻击被闪避。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L284-L292】
2. **基础伤害**：分别计算物攻与法攻分支，取 `max(攻击×25%, 攻击 - 有效防御)`，若法攻结果更高则视为法术攻击。随后乘以 0.9~1.1 的随机浮动，并叠加额外固定伤害（如技能或特效提供）。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L294-L324】
3. **暴击与终伤**：按 `clamp(暴击率 - 抗暴, 5%, 95%)` 触发暴击，暴击后乘以至少 1.2 倍的暴击伤害；再乘以 `max(0.1, 1 + 终伤加成 - 终伤减免)` 得到最终伤害，并保证不低于 1 点。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L326-L337】
4. **吸血与治疗**：基于最终伤害计算吸血（上限 60%），同时考虑治疗增减系数与额外命中治疗，从而更新攻击者生命值。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L339-L349】

## 小程序前端

新增页面位于 `miniprogram/pages/pvp/`：

- `index`：竞技场主界面，显示当前段位、胜负统计、邀战卡片、最新战报与历史赛季记录，可进行快速匹配、领取奖励与分享邀战令。
- `leaderboard`：天梯排行榜，支持一键挑战或跳转回主界面发起邀战。
- `battle`：战报回放页，展示回合日志、积分变化与战斗摘要。

服务调用由 `miniprogram/services/api.js` 内新增的 `PvpService` 统一封装。

## 部署步骤

1. 在云开发控制台创建上述五个集合，并设置必要索引（建议对 `pvpProfiles.points`、`pvpMatches.seasonId` 建立排序索引）。如在沙盒环境中暂未手动创建，`pvp` 云函数会在首次调用时尝试自动创建缺失集合，但仍建议在正式环境提前完成，以便配置索引与权限。
2. 在微信开发者工具中右键上传 `cloudfunctions/pvp` 目录并安装依赖。
3. 若 `cloudfunctions/nodejs-layer/node_modules/combat-system` 有更新，请重新打包 `nodejs-layer` 并在 `pve`、`pvp` 云函数的“层管理”中绑定最新层版本，避免战斗公式不一致。
4. 更新小程序前端代码，确保 `miniprogram/services/config.js` 中新增的 `pvp` 云函数名称与实际部署一致。
5. 若为老项目升级，请手动执行一次 `pvp` 云函数的 `profile` 动作（或让用户进入竞技场页面），以便生成默认档案。
6. 赛季奖励文案默认内置，可在云数据库的 `pvpSeasons` 文档中按需调整奖励描述或周期。

部署完成后，会员即可在“比武”入口体验天梯匹配、好友切磋与邀战分享，实现线上社交裂变与线下消费联动。
