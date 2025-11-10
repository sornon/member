# 装备分解与材料返还设计

## 1. 系统概述
装备分解提供玩家在纳戒或装备背包内快速回收锻造材料的能力，入口为装备卡片的长按操作。触发长按后，浮层进入“分解模式”，展示【分解装备】按钮并隐藏原有的删除选项，确保玩家在整理装备时始终走向资源回收的正向循环。流程在云函数侧通过 `dismantleEquipment` 动作执行，前端调用 `PveService.dismantleEquipment` 并在完成后即时刷新角色档案。

## 2. 品质与材料映射
分解返还材料按装备品质划分九个阶梯，命名覆盖从“废铁”到“寰宇古髓”的成长语义，同时规划好后续图标文件名。

| 装备品质 | 材料名称 | 简称 | 描述摘要 | 图标文件名 |
| --- | --- | --- | --- | --- |
| 凡品 `mortal` | 废铁碎片 | 废铁 | 凡品装备拆解后的基础锻料，可用于兑换粗制器胚。 | `material-reforge-mortal.png` |
| 下品 `inferior` | 精铁碎片 | 精铁 | 下品装备凝出的精炼铁片，适合淬炼入门器具。 | `material-reforge-inferior.png` |
| 中品 `standard` | 灵钢小锭 | 灵钢 | 蕴含灵息的钢锭，是中品装备的常规返还物。 | `material-reforge-standard.png` |
| 上品 `superior` | 曜金晶砂 | 曜金 | 高阶阵火回收的晶砂，可稳定上品器胚。 | `material-reforge-superior.png` |
| 极品 `excellent` | 星辉玄铁 | 星玄 | 极品装备的星辉精华，用于唤醒铭纹。 | `material-reforge-excellent.png` |
| 仙品 `immortal` | 霜岚玉锻 | 霜玉 | 仙品拆解后的寒玉碎锭，作为顶阶催化剂。 | `material-reforge-immortal.png` |
| 完美 `perfect` | 璇玑圣辉 | 璇辉 | 完美装备凝成的璇玑之光，强化神器共鸣。 | `material-reforge-perfect.png` |
| 先天 `primordial` | 太初神胚 | 神胚 | 先天装备析出的胚体，重铸古兵的基底。 | `material-reforge-primordial.png` |
| 至宝 `relic` | 寰宇古髓 | 古髓 | 只有至宝留存的寰宇精髓，传说兵器专属。 | `material-reforge-relic.png` |

图标文件名统一采用 `material-reforge-{quality}.png` 规则，后续美术可直接在云存储 `materials/` 目录上传同名资源。

## 3. 产出数量与暴击
* **基础数量**：`2^强化等级`，未强化固定返还 1 份材料，强化 1 返还 2 份，强化 2 返还 4 份，以此类推。
* **暴击概率**：`min(60%, 15% + 强化等级 × 3%)`，强化越高越容易触发额外收益。
* **暴击收益**：暴击后追加 `min(基础数量, round(基础数量 × (0.5 + 强化等级 × 5%)))`，总数最多翻倍。
* **安全上限**：服务器在拆解阶段使用整数运算并最终限制于 2 倍基础值内，确保收益稳定且可预期。

判定与数量计算完全在云函数内完成，前端仅负责展示 `暴击！获得 X 个材料` 的结果提示。

## 4. 材料堆叠与仓储
* 每种材料占用一个槽位，可堆叠 **99,999** 个；超过现有堆叠上限时自动新建堆叠。
* 云函数在写入材料前会检查材料类目是否达到当前容量（基础 100，每次升级 +20），满仓时返回 `材料栏位已满` 提示。
* 新增堆叠附带 `stackable: true`、`maxStack: 99999` 元信息，便于未来在界面或数值层面扩展批量操作。

## 5. 客户端交互
* 长按装备或背包中的装备条目，浮层切换为分解态，底部显示【分解装备】按钮并沿用 pill 样式，宽度与“装备”“强化”等按钮保持一致。
* 若当前物品无法分解（任务物品、未找到编号、被锁定），按钮显示“无法分解”并在下方给出原因提示。
* 分解成功后浮层立即关闭，toast 文案遵循：`暴击！获得X个材料`（触发暴击）或 `获得X个材料`。
* 储物格右上角新增数量角标，堆叠材料直接显示当前数量；若无图标则继续使用名称占位。
* 浮层详情的“数量”字段同步展示堆叠值，便于核对资源。

## 6. 接口约定
`dismantleEquipment` 返回结构：

```json
{
  "profile": { ... },
  "dismantle": {
    "equipment": { "itemId": "...", "quality": "...", "refine": 4 },
    "material": { "itemId": "reforge_ingot_standard", "name": "灵钢小锭" },
    "baseQuantity": 3,
    "bonusQuantity": 2,
    "totalQuantity": 5,
    "critical": true,
    "stacks": [
      { "inventoryId": "material-reforge-standard-...", "added": 5, "isNew": true }
    ]
  }
}
```

前端只需读取 `profile` 刷新界面，并根据 `dismantle` 信息展示反馈文案。

## 7. 状态与日志
* 云函数将分解行为写入 `battleHistory`，记录动作、装备 ID、返还材料及是否暴击，便于后台审计。
* 分解会同步卸下同名装备槽位，避免残留影子数据。

## 8. 后续拓展
* 图标交付后，将素材上传至 `materials/material-reforge-*.png` 并更新 CDN，即可自动生效。
* 若后续开放批量分解，可复用当前材料堆叠逻辑，只需在前端增加多选入口。
