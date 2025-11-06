# 装备英文属性排查

在新增中文标签映射后，灰字与绿字装备不再出现英文属性，其他品阶的装备也会自动显示中文属性名。针对最新回归问题补充了以下排查结论：

* “护息秘简”仍出现 `shield+94` 的原因是 `COMBAT_STAT_LABELS` 缺少 `shield` 条目，导致词条回退到原始键名。新增 `shield: '护盾值'` 后，灰绿品装备同样应用中文标签。【F:cloudfunctions/pve/index.js†L1220-L1252】
* “初阳布袍”重复显示“生命值加成 +0”是因为 `formatStatDisplay` 在处理 `Multiplier` 结尾的属性时按整数取整，0.0561 被四舍五入为 0。补充 `Multiplier` 百分比格式化后，明细中与高亮的数值保持一致，同时利用去重流程保留带“【】”的词条。【F:cloudfunctions/pve/index.js†L9886-L9921】【F:cloudfunctions/pve/index.js†L6988-L7056】

## 处理方案

* 为 `COMBAT_STAT_LABELS` 增补了 `allAttributes`、`dodgeChance` 与 `shield` 的中文文案，并引入基础属性标签映射，便于复用现有六维名称。【F:cloudfunctions/pve/index.js†L1220-L1252】
* `resolveCombatStatLabel` 现会识别 `Multiplier` 后缀，根据基础属性自动生成“加成”描述，覆盖诸如 `maxHpMultiplier`、`speedMultiplier` 等倍率键，彻底移除英文展示。【F:cloudfunctions/pve/index.js†L6549-L6568】
* 装备属性展示在生成明细时会统一去除“【】”标签进行比对，避免同时出现带标签与不带标签的重复词条，仅保留带“【】”的高亮文本。【F:cloudfunctions/pve/index.js†L6994-L7052】

上述改动确保所有装备属性展示均为中文，无需再额外排查回退逻辑。
