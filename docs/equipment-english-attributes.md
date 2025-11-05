# 装备英文属性排查

在新增中文标签映射后，灰字与绿字装备不再出现英文属性，其他品阶的装备也会自动显示中文属性名。

## 处理方案

* 为 `COMBAT_STAT_LABELS` 增补了 `allAttributes` 与 `dodgeChance` 的中文文案，并引入基础属性标签映射，便于复用现有六维名称。【F:cloudfunctions/pve/index.js†L1218-L1267】
* `resolveCombatStatLabel` 现会识别 `Multiplier` 后缀，根据基础属性自动生成“加成”描述，覆盖诸如 `maxHpMultiplier`、`speedMultiplier` 等倍率键，彻底移除英文展示。【F:cloudfunctions/pve/index.js†L6549-L6568】

上述改动确保所有装备属性展示均为中文，无需再额外排查回退逻辑。
