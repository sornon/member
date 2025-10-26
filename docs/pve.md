# PVE 副本与数值体系说明

为配合会员体系的数值化运营，小程序新增了“秘境试炼”模块，提供 RPG 式的 PVE 玩法。该模块覆盖属性成长、装备收集、技能抽卡与副本挑战，帮助运营团队在会员活动中引入持续性的成长线。

## 核心概念

### 角色属性

- **等级与境界**：角色等级与会员境界完全同步，共 100 级。充值产生的修为值决定境界，秘境挑战不会掉落修为，因此无法在副本内升级；云函数会在进入时依据会员当前境界同步基础属性、境界标签与突破加成。【F:cloudfunctions/pve/index.js†L522-L642】【F:cloudfunctions/pve/index.js†L1323-L1440】
- **六维基础属性**：体质、力量、灵力、根骨、敏捷、悟性。体质奠定生命与减伤，力量与灵力分别加强物理/法术输出，根骨提供双防与控制抗性，敏捷主导速度与闪避，悟性带来命中、暴击与控制命中收益。【F:cloudfunctions/pve/index.js†L63-L79】【F:cloudfunctions/pve/index.js†L1617-L1658】
- **属性点**：会员每升一级固定获得 5 点属性点，可在六维之间自由分配；活动奖励也会额外投放属性点。属性点加成都累计在 `trained` 字段中，由云函数负责校验与记录。【F:cloudfunctions/pve/index.js†L572-L642】【F:cloudfunctions/pve/index.js†L919-L961】

#### 等级成长与境界

- **初始档位**：炼气一阶的默认属性为 体质 20、力量 16、灵力 16、根骨 18、敏捷 12、悟性 12。【F:cloudfunctions/pve/index.js†L72-L79】
- **境界分段成长**：等级被划分为炼气期 (1-30)、筑基期 (31-60)、结丹期 (61-90)、元婴期 (91-100)。每段境界定义了六维的逐级成长值以及突破时对生命、攻击、防御、速度、命中的乘法增益。【F:cloudfunctions/pve/index.js†L81-L128】
- **累积计算**：`calculateBaseAttributesForLevel` 会按境界成长表逐级累积出目标等级的基础属性，再由 `syncAttributesWithMemberLevel` 写回档案并追加突破加成、境界标签与下一级的经验阈值信息。【F:cloudfunctions/pve/index.js†L536-L558】【F:cloudfunctions/pve/index.js†L576-L642】

#### 炼气期（1-10 级）基础属性

| 等级 | 体质 | 力量 | 灵力 | 根骨 | 敏捷 | 悟性 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 20 | 16 | 16 | 18 | 12 | 12 |
| 2 | 22 | 18 | 18 | 20 | 13 | 13 |
| 3 | 24 | 20 | 20 | 22 | 14 | 14 |
| 4 | 26 | 22 | 22 | 24 | 15 | 15 |
| 5 | 28 | 24 | 24 | 26 | 16 | 16 |
| 6 | 30 | 26 | 26 | 28 | 17 | 17 |
| 7 | 32 | 28 | 28 | 30 | 18 | 18 |
| 8 | 34 | 30 | 30 | 32 | 19 | 19 |
| 9 | 36 | 32 | 32 | 34 | 20 | 20 |
| 10 | 38 | 34 | 34 | 36 | 21 | 21 |

#### 六维到战斗属性映射

`deriveBaseCombatStats` 将六维转换为可直接参与战斗的基础数值，随后再叠加装备、技能与境界倍率形成最终面板：

- 生命值：`200 + 体质 × 20 + 根骨 × 5`。
- 物攻 / 法攻：`50 + 力量 × 2` 与 `50 + 灵力 × 2`。
- 物防 / 法防：根骨提供 1 点基础防御，力量与灵力分别再带来 0.2 点增益。
- 速度 / 命中 / 闪避：速度 = `80 + 敏捷`；命中 = `100 + 悟性`；闪避值 = `80 + 敏捷 × 0.9 + 悟性 × 0.4`。
- 会心体系：暴击率 = `5% + 悟性 × 0.1%`，暴击伤害 = `150% + 悟性 × 0.15%`，并以函数下限/上限限制暴击概率与倍率。
- 其他衍生：体质与根骨共同提供最终减伤（上限 40%），灵力增加治疗强化（每点 0.5%），悟性与灵力提升控制命中，根骨提升控制抗性，力量/灵力换算为破甲/法穿。【F:cloudfunctions/pve/index.js†L1617-L1658】【F:cloudfunctions/pve/index.js†L1672-L1704】

境界突破提供的加成会乘算在生命、双攻、防御、速度与命中上，使阶段跃迁更具冲刺感。【F:cloudfunctions/pve/index.js†L81-L128】【F:cloudfunctions/pve/index.js†L1650-L1655】最終面板会经过封顶函数，确保暴击率、最终减伤、吸血等属性保持在合理区间。【F:cloudfunctions/pve/index.js†L2563-L2583】

### 装备体系

- 装备分为 **武器**、**护具**、**饰品** 等槽位，每件装备带有固定属性加成及稀有度标签（常见、稀有、史诗、传说）。【F:cloudfunctions/pve/index.js†L159-L164】
- 新建角色不会自动配发装备，需要通过副本掉落或运营投放获取；重复获取会提升“精炼等级”，放大装备基础数值。【F:cloudfunctions/pve/index.js†L3867-L3868】【F:cloudfunctions/pve/index.js†L4874-L4907】【F:cloudfunctions/pve/index.js†L5811-L5819】
- 云函数在计算装备词条时支持基础属性、战斗属性与倍率类加成，并统一转化为展示用文本，便于前端直接渲染。【F:cloudfunctions/pve/index.js†L1707-L1745】【F:cloudfunctions/pve/index.js†L2083-L2108】

#### 储物空间与升级限制

- 储物空间以统一的品类数组定义，初始容量为 100 格，单次升级增加 20 格，并设定默认最多 20 次升级的上限。【F:cloudfunctions/pve/index.js†L18-L34】
- 新会员建档时可用的纳戒升级次数默认为 0，需要通过后台或运营投放提升次数后才能升级存储空间。【F:cloudfunctions/pve/index.js†L3179-L3195】【F:cloudfunctions/admin/index.js†L1574-L1580】
- 新会员建档时会调用 `buildDefaultStorage` 写入基础配置，记录当前升级层级、容量成长参数、可用升级次数与固定上限，避免出现“未初始化导致无限升级”的状态。【F:cloudfunctions/pve/index.js†L3182-L3196】
- 旧档案在 `normalizeEquipment` 中会回填缺失字段：如果历史数据缺乏上限会用默认值推导；若缺少 `upgradeAvailable` 字段则按 0 次处理，避免在未授权的情况下继续升级。【F:cloudfunctions/pve/index.js†L3518-L3560】
- 升级接口会综合当前层数、剩余次数与上限判定：一旦当前层数达到或超过上限立即拒绝；否则扣减一次可用次数并把所有品类的升级层级同步加一，同时把上限写回档案，防止客户端伪造字段绕过校验。【F:cloudfunctions/pve/index.js†L2610-L2666】
- 返回给前端的档案中，服务端会重新计算容量、剩余额度与 `upgradeLimit`/`upgradesRemaining` 元数据，确保可视化状态与服务端判定始终一致，供前端进行提示与二次校验。【F:cloudfunctions/pve/index.js†L4496-L4554】

### 技能体系

- 技能以卡牌形式存在，按稀有度划分为常见/稀有/史诗/传说，并可通过“抽取灵技”获得。抽到重复技能会提升技能等级（上限 5 级）。【F:cloudfunctions/pve/index.js†L755-L814】【F:cloudfunctions/pve/index.js†L1756-L1779】
- 技能抽卡受次数限制：角色档案会记录剩余抽取次数，基础档案默认赠送 1 次，后续需通过活动、道具等渠道补充。抽卡接口在次数耗尽时会返回 `SKILL_DRAW_LIMIT` 错误，前端据此禁用按钮并提示玩家。 【F:cloudfunctions/pve/index.js†L2765-L2797】【F:cloudfunctions/pve/index.js†L3169-L3236】【F:miniprogram/pages/role/index.js†L288-L347】
- 技能提供基础数值、最终倍率、护盾、闪避等多种效果，`aggregateSkillEffects` 会把技能加成拆解为加法与乘法两部分，并与装备一同叠加到最终战斗面板。【F:cloudfunctions/pve/index.js†L1553-L1602】【F:cloudfunctions/pve/index.js†L1672-L1704】
- 抽卡与装备更换均会写入技能历史，以便运营复盘玩家培养路径。【F:cloudfunctions/pve/index.js†L755-L860】【F:cloudfunctions/pve/index.js†L2040-L2068】

### 秘境副本

- 秘境改为按照境界爬楼：每个境界对应 9 层小怪 + 1 层首领，从“炼气期 · 一层”开始一路延展至化神、大乘乃至真仙、金仙阶段，楼层名称完全复用会员等级公共配置。【F:cloudfunctions/nodejs-layer/node_modules/common-config/index.js†L1-L210】【F:cloudfunctions/pve/index.js†L51-L318】
- 玩家必须依次通关，击败当前层才会解锁下一层。通关状态保存在 `secretRealm.floors` 中，历史胜利不会重复发放奖励（奖励占位待后续配置，可在 `enemy.meta.suggestedRewards` 中查看建议档位）。云函数仅返回当前可挑战的楼层与紧邻的下一关提示，其余未解锁或已通关楼层不会出现在响应或前端列表中，避免重复挑战或提前查看配置。【F:cloudfunctions/pve/index.js†L2144-L2195】【F:cloudfunctions/pve/index.js†L4846-L4921】
- 为兼容旧版本数据，云函数会在读取/挑战副本时自动识别历史楼层 ID（纯数字、未补零的 `secret_*_1` 等），并转换为新的规范 ID，同时合并通关记录与解锁层数，避免出现“未找到副本目标”或进度回退。【F:cloudfunctions/pve/index.js†L219-L336】【F:cloudfunctions/pve/index.js†L3886-L4015】
- 每个境界的 9 种小怪分别突出生命、物攻、法攻、双防、速度、命中、闪避与控制命中等核心属性，首领同时强化三项关键属性并附带专属特技。数值模型通过 `SECRET_REALM_TUNING` 控制成长曲线，保证高级装备勉强通关、顶级装备轻松通过，后续仅需调整基准或倍率即可批量更新难度。【F:cloudfunctions/pve/index.js†L41-L318】【F:cloudfunctions/pve/index.js†L2106-L2145】
- 战斗流程仍采用回合制模拟，综合命中、暴击、破甲、最终增减伤等参数产出完整战报；云函数需输出结构化时间线（`timeline`）与胜败结果，并写入 `memberPveHistory.battleHistory` 供复盘。时间线节点必须携带双方属性快照，以记录战斗当下的攻击、防御、速度、暴击等面板数据，避免回放时因角色成长导致展示错位；为降低体积，每条时间线只需返回相较上一节点发生变化的属性字段，前端会自动与上一条记录或顶层 `participants.attributes` 合并。所有战斗结果均通过公共模块 `battle-schema` 统一格式化，与 PVP 保持完全一致的数据结构，便于前端与审计工具复用。【F:cloudfunctions/pve/index.js†L2117-L2198】【F:cloudfunctions/pve/index.js†L4947-L5008】【F:cloudfunctions/pve/index.js†L6126-L6206】【F:cloudfunctions/nodejs-layer/node_modules/battle-schema/index.js†L1-L223】
- 奖励结构保留灵石、属性点、掉落位，当前默认为 0 以待数值策划后续配置，胜利仍会触发灵石流水与战斗记录逻辑。【F:cloudfunctions/pve/index.js†L2165-L2198】【F:cloudfunctions/pve/index.js†L4496-L4546】

#### 炼气至筑基掉落规划

| 楼层段 | 普通怪基础爆率 | 首领基础爆率 | 核心掉落 | 成长目标 |
| --- | --- | --- | --- | --- |
| 第 1-3 层 | 12% | — | 凡品武器/护腕/衣服、鞋履/腰带/法器、头部/秘宝/傀儡，覆盖炼气入门三大流派需求。 | 首轮爬塔即可补足基础攻防、速度与护盾底座。【F:cloudfunctions/pve/index.js†L390-L407】 |
| 第 4-6 层 | 13% | — | 凡品进阶攻击、防御与治疗词条，让玩家在 6 级前体验反击、控制命中与受疗成长。 | 进一步引导尝试反击、治疗与控制组合。【F:cloudfunctions/pve/index.js†L409-L425】 |
| 第 7-9 层 | 14% | — | 圆满前夕的凡品命中、护盾与团队减伤装备，为首领战做准备。 | 确保首领前关键词条能凑齐阈值。【F:cloudfunctions/pve/index.js†L427-L443】 |
| 第 10 层首领 | — | 18%（绿装）/8%（首件上品） | 绿品成套基础装备与首个上品武器，为炼气圆满提供跃迁。 | 首领掉落让主力位直接跃升到下品/上品强度。【F:cloudfunctions/pve/index.js†L445-L455】 |
| 第 11-13 层 | 11% | — | 上品/极品护甲、护腕、鞋履与控场饰品，对应筑基初段常见流派。 | 过渡到紫橙品质，搭建双攻、控场与速度曲线。【F:cloudfunctions/pve/index.js†L458-L474】 |
| 第 14-16 层 | 10% | — | 身法、治疗与护盾核心部位，含虚丝羽衣、灵晖腰带、圣辉侍灵等。 | 支撑控制、治疗与护盾循环在筑基阶段成型。【F:cloudfunctions/pve/index.js†L476-L493】 |
| 第 17-19 层 | 9% | — | 术法增幅、连击暴击与守护信物，提供筑基高阶爆发与续航。 | 为 20 层首领铺垫高强度爆发/保命手段。【F:cloudfunctions/pve/index.js†L494-L511】 |
| 第 20 层首领 | — | 20%（主件）/18%（辅助）/7%（传说） | 投放龙骨刀、渊光法器、凤羽灵坠等高阶装备，附带小概率传说词条。 | 首领胜利后至少获取 1-2 件紫橙装备，并有机会提前触发传说成长线。【F:cloudfunctions/pve/index.js†L512-L524】 |
| 第 21-24 层 | 9% | — | 持续刷新高阶身法、控场与护盾件，帮助补齐上一路未掉落的槽位。 | 进入 30 级前持续完善核心套装。【F:cloudfunctions/pve/index.js†L527-L549】 |
| 第 25-27 层 | 8% | — | 重点倾斜治疗、队伍增益与前排护甲，确保多角色都能跟上曲线。 | 让治疗与前排在 25 级前完成质量跃迁。【F:cloudfunctions/pve/index.js†L551-L567】 |
| 第 28 层 | 6% | — | 炽心宝珠、炽焰法器、凤羽灵坠等传说件，全部采用独立低概率掉落。 | 在 30 级前提供追求上限的橙红色终端目标。【F:cloudfunctions/pve/index.js†L569-L575】 |
| 第 29 层 | 9% | — | 回收龙骨刀、渊光法器等核心件，补充未命中 20 层首领的玩家。 | 再次保证关键输出位有机会补齐装备。【F:cloudfunctions/pve/index.js†L578-L582】 |
| 第 30 层首领 | — | 22%（主件）/20%（辅助）/8%（传说） | 汇总火线顶级装备，并开放传说件二次掉落。 | 30 级毕业战斗稳产 2 件高品质装备，并维持对顶级追求的稀缺性。【F:cloudfunctions/pve/index.js†L584-L595】 |

悟性在判定时为所有掉落统一追加最高 20% 的加成：`baseChance + min(0.2, 悟性 × 0.0015)`，因此炼气玩家只要将悟性提至 60 左右，就能把普通层爆率从 12% 拉升到约 21%，快速凑齐整套装备；30 级前若持续提升悟性，也能把首领掉落稳定在两件左右。【F:cloudfunctions/pve/index.js†L8683-L8702】

## 前端交互

- 首页底部导航新增“秘境”入口，跳转至 `/pages/pve/pve` 页面。
- `/pages/role/index` 中的“角色属性”页签会并列展示六维基础属性与战斗属性映射，支持查看基础/装备/技能来源，并在战斗属性中追加境界倍率提示。【F:miniprogram/pages/role/index.wxml†L26-L99】【F:miniprogram/pages/role/index.wxss†L204-L280】
- 属性分配面板改为使用六维属性键位，支持手动选择与平均分配；所有操作均通过云函数校验剩余属性点并记录战斗日志。【F:miniprogram/pages/role/index.js†L1-L220】【F:cloudfunctions/pve/index.js†L919-L961】
- 装备与技能页签保留已有交互：展示当前穿戴、背包、抽卡按钮以及技能槽位，并与云函数互通刷新档案。【F:miniprogram/pages/role/index.wxml†L102-L170】【F:miniprogram/pages/role/index.js†L108-L196】
- 秘境战斗详情页会在管理员登录时自动附加“怪物详细属性”模块：服务端仅对管理员响应关卡信息、六维基础属性、全部衍生属性与技能负载，前端在战力行下方以紧凑网格与技能列表展示，便于客服定位战力或技能异常。【F:cloudfunctions/pve/index.js†L6050-L6369】【F:miniprogram/pages/pve/history.wxml†L8-L52】【F:miniprogram/pages/pve/history.wxss†L40-L143】
- 秘境挑战首页同样会在管理员账户下展示关卡的怪物属性、衍生数据与技能列表，模块位于挑战按钮上方，保持紧凑排版便于快速核查。【F:cloudfunctions/pve/index.js†L5080-L5132】【F:cloudfunctions/pve/index.js†L5934-L6003】【F:miniprogram/pages/pve/pve.wxml†L27-L67】【F:miniprogram/pages/pve/pve.wxss†L73-L140】

## 战斗计算要点

0. **公共战斗模块**：角色属性整合、命中/伤害结算与战力评分统一收敛在 `cloudfunctions/nodejs-layer/node_modules/combat-system/index.js` 中输出，`pve` 与 `pvp` 云函数共享同一套公式，确保竞技与副本的数值来源一致。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L1-L210】【F:cloudfunctions/pve/index.js†L5600-L5702】【F:cloudfunctions/pvp/index.js†L1194-L1319】
1. **最终属性汇总**：角色最终面板由“基础 + 训练加点 + 装备 + 技能”组成，并在战斗前附加境界突破倍率；云函数会把计算结果和特殊效果（护盾、额外伤害、闪避率）传递给模拟器。【F:cloudfunctions/pve/index.js†L1323-L1440】【F:cloudfunctions/pve/index.js†L1670-L1702】
2. **出手与命中**：战斗首回合由速度决定；每次攻击先以 `clamp(0.85 + (命中 − 闪避) × 0.005, 0.2, 0.99)` 进行命中判定，再与目标的技能闪避概率对抗。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L146-L175】【F:cloudfunctions/pve/index.js†L5605-L5662】
3. **伤害路径**：系统会比较物理与法术两条路线的净收益：`max(攻击 × 25%, 攻击 − 防御 × (1 − 穿透))`，并选择更高的一种；随后乘以 0.9~1.1 的浮动并叠加技能额外伤害。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L176-L205】
4. **暴击与最终修正**：暴击概率为 `clamp(暴击率 − 抗暴, 5%, 95%)`，暴击时按暴击伤害倍率放大；最终伤害再乘以 `(1 + 增伤 − 减伤)`，并保证至少造成 10% 的原始伤害，上限不低于 1 点。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L188-L204】
5. **吸血与治疗系数**：吸血最多结算 60%，同时受治疗强化与治疗削弱影响，最终回血 = 伤害 × 吸血 × `clamp(1 + 强化 − 削弱, 0, 2)`。【F:cloudfunctions/nodejs-layer/node_modules/combat-system/index.js†L200-L205】
6. **战斗节奏**：战斗最多 20 回合，支持护盾、额外伤害与闪避特效；若仍未击败敌人则直接判定为失败，不再结算平局奖励。【F:cloudfunctions/pve/index.js†L8120-L8232】
7. **掉落与加成**：悟性会提高灵石收益（上限 25%，仅折半计入灵石）并提升装备/技能掉落概率（上限 20%），同时额外属性点奖励完全取决于副本配置。【F:cloudfunctions/pve/index.js†L5878-L5927】

## 云函数接口

新增 `pve` 云函数，核心动作如下：

| 动作 | 说明 |
| ---- | ---- |
| `profile` | 获取当前会员的 PVE 数值、装备、技能与副本列表，若缺失会自动初始化默认配置。 |
| `battle` | 挑战指定副本，返回战斗结果与奖励（不再附带角色档案，客户端需自行刷新 `profile`）。 |
| `drawSkill` | 执行一次技能抽卡，返回抽取结果并更新技能背包。 |
| `equipSkill` | 装备/卸下技能，自动校验槽位数量。 |
| `equipItem` | 更换或卸下装备：传入 `itemId` 装备至对应槽位，传入 `slot` 且 `itemId` 为空时表示卸下该槽位装备。 |
| `listEquipmentCatalog` | **管理员专用**：返回可发放的装备目录（包含槽位、品质、标签信息），用于后台指派装备。 |
| `grantEquipment` | **管理员专用**：为指定会员追加装备，返回更新后的完整 PVE 档案。 |
| `adminInspectProfile` | **管理员专用**：查看任意会员的 PVE 档案，便于客服或运营排查。 |
| `allocatePoints` | 分配属性点，按服务端定义的步进值更新属性。 |

所有动作会把核心属性与装备信息写回 `members` 表的 `pveProfile` 字段，战斗与技能历史则同步至 `memberPveHistory` 集合，并在需要时记录灵石流水（`stoneTransactions`）。若历史集合尚未创建，云函数会自动调用 `createCollection` 建立并重试写入，避免首次写入时报错。【F:cloudfunctions/pve/index.js†L3807-L3845】

> **数值同步提示**：云函数会在每次更新属性、装备或技能时重新计算 `pveProfile.attributeSummary`，将装备词条、套装效果与技能增益折算为最终战斗属性，供 PVE 战斗与 PVP 竞技场共用。【F:cloudfunctions/pve/index.js†L2836-L2873】【F:cloudfunctions/pve/index.js†L2994-L3072】【F:cloudfunctions/pve/index.js†L3218-L3333】【F:cloudfunctions/pve/index.js†L3377-L3452】【F:cloudfunctions/pve/index.js†L5748-L5796】

## 部署提示

1. 在云开发控制台创建或更新 `pve` 云函数，上传 `cloudfunctions/pve` 目录并安装依赖。
2. 若 `cloudfunctions/nodejs-layer/node_modules/combat-system` 有改动（例如本次统一 PVE/PVP 数值公式），请重新打包 `nodejs-layer` 为新的层版本，并在 `pve`、`pvp` 云函数的“层管理”中绑定最新版本。
3. 同步更新 `admin` 云函数（目录 `cloudfunctions/admin`），获取管理员发放装备所需的代理接口。
4. 重新上传小程序前端代码，包含会员端 `/pages/role` 以及后台 `/pages/admin/member-detail` 的改动。
5. 如需重置老用户数据，可在运营后台执行一次 `pve` 云函数的 `profile` 动作，或在数据库中删除 `pveProfile` 字段后重新进入页面。

通过上述体系，会员可在日常消费或活动中持续提升“战力”，运营侧可结合副本掉落、抽卡概率和任务奖励设计更丰富的玩法。
