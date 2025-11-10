# 秘境 NPC 模板体系

## 背景

炼气期秘境现有的 1~10 层敌人已经覆盖了坦克、爆发、控制等不同 archetype。过往数值直接由 `resolveSecretRealmScaling`
结合 archetype 权重生成，缺乏对「名字」「视觉资源」「定位说明」「附加数值系数」等信息的统一入口，导致后续扩展
楼层时需要在多处重复配置。本次改造将炼气期首批 10 位敌人抽象为可复用的模板，统一管理视觉、文案与数值系数，
并在运行时自动注入至敌人实体。

## 模板注册表

`SECRET_REALM_ENEMY_TEMPLATE_REGISTRY` 维护了可复用的 NPC 模板，键名为模板标识，例如
`qi_refining_vitality_guardian`、`qi_refining_overseer`。每个模板包含：

- **基础信息**：`name`、`displayName`、`epithet`、`summary`/`description`、`tags`，用于前端展示与后台校验。
- **数值焦点**：`statFocus`（主/次要关注属性）以及 `skillIds`，方便在管理端快速识别敌人定位。【F:cloudfunctions/pve/index.js†L520-L692】
- **视觉资源**：`visualKey` 对应云端 `avatar/`、`character/` 目录中的图片文件名，实现头像与立绘的模板复用。
- **数值系数**：
  - `scaling`：对 `resolveSecretRealmScaling` 产出的基础倍数做整体放大/缩小。
  - `statAdjustments`：对生成后的战斗属性支持逐项乘法 (`multipliers`) 与加法 (`additive`) 系数叠加。
  - `specialAdjustments`：对特殊属性（护盾、bonusDamage、dodgeChance 等）提供同样的倍数/加法调整。
- **难度覆写**：`difficultyOverride` 可直接指定展示难度标签（如「困难」），覆盖基于战力比的自动判断，用于特定 Boss 楼层的文案统一。【F:cloudfunctions/pve/index.js†L1020-L1073】【F:cloudfunctions/pve/index.js†L8961-L9040】

模板字段均为可选，未显式配置时自动回退至 archetype 默认值，保证扩展模板时只需填写差异化信息。

## 楼层绑定

`SECRET_REALM_FLOOR_ASSIGNMENTS` 负责把模板映射到具体楼层，可为整境界设置 `defaults`，再针对每层覆写
`displayName`、`summary`、`tags`、`visualKey` 与额外的 `scaling`/`statAdjustments`。炼气期 1~10 层分别绑定到
上述模板（如“灵木护卫”“破岩武僧”“玄火尊”），并保留原有技能、定位描述与视觉资源，确保模板化后对
现有数值表现零侵入；其中第 10 层追加 `difficultyOverride: "困难"`，强制将 Boss 标记为高难度以配合 UI 展示。
【F:cloudfunctions/pve/index.js†L694-L772】

筑基期 11~19 层沿用炼气期 9 位常规敌人的模板，但重新打乱出场顺序，并通过 `scaling` 逐层提升系数，
让难度平滑递增。同时设置楼层默认标签（如“筑基试炼”“进阶考核”），便于前端直接展示境界阶段信息。
第 20 层复用“玄火尊”模板并叠加更高的倍数、护盾/爆发增益与难度覆写，强化为筑基圆满 Boss，掉落
统一改为 3 件上品装备，概率与炼气首领一致，保障阶段奖励的独特性。【F:cloudfunctions/pve/index.js†L842-L862】【F:cloudfunctions/pve/index.js†L1557-L1632】

未来新增楼层时，只需在 `SECRET_REALM_FLOOR_ASSIGNMENTS` 中追加楼层映射，或让其他境界沿用这些模板并按需
覆写系数即可。

## 运行时装配

`createSecretRealmEnemy` 在生成敌人时读取模板配置：

1. 计算基础 scaling，并应用模板提供的 `scaling` 倍数。
2. 生成战斗属性/特殊属性后，通过 `applySecretRealmStatAdjustments`、`applySecretRealmSpecialAdjustments`
   叠加模板系数并自动重新做数值截断，保证 crit、命中等字段符合上限限制。
3. 构建 `templateMeta`，注入名称、标签、技能列表、可视化 key 及生效系数，写入 `enemy.meta.template` 供前端与
   管理端共用。【F:cloudfunctions/pve/index.js†L1687-L1764】
4. `decorateEnemyVisuals` 优先读取模板指定的 `visualKey`，统一头像与立绘来源；`decorateEnemy` 则基于
   `templateMeta` 自动生成“定位”“主属性”“携带技能”等高亮信息，降低维护成本。【F:cloudfunctions/pve/index.js†L3930-L3986】【F:cloudfunctions/pve/index.js†L8792-L8901】

## 扩展指引

- **新增模板**：在注册表中追加一项，补全基础信息与可选数值系数，并确保 `visualKey` 对应的资源已上传。
- **复用模板**：在楼层绑定表中引用既有模板，通过 `tags`、`summary` 与系数字段覆写差异化设定；如需替换技能
  或添加额外技能，可使用 `skillIds` / `extraSkills` 字段。
- **调参与校验**：`meta.template` 会把模板 key、summary、tags、技能列表与实际应用的 scaling 统合到战斗
  数据里，运营侧可在小程序管理员模式下直接看到高亮信息，并借助战报快照 (`captureEnemySnapshot`) 追溯模板
  版本。【F:cloudfunctions/pve/index.js†L9357-L9470】

通过以上结构，秘境后续楼层只需围绕模板进行少量覆写即可完成配置，避免重复维护文案、视觉与数值逻辑。
