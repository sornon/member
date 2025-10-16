# 战斗动作类型与样式联动说明

## 1. 动作数据来源
- 小程序通过 `createBattleViewModel` 把战斗时间线整理成 `actions` 数组，每个动作都包含 `type`、`actor`、`target`、`effects`、血量快照等字段。`type` 默认优先读取结构化时间线里的 `actionType`/`type`，否则根据是否带技能信息退化为 `skill` 或 `attack`，命中闪避会强制改为 `dodge`。【F:miniprogram/shared/battle.js†L1026-L1176】
- 回放组件在播放时把 `currentAction` 注入战斗舞台模版，利用 `actor`/`target` 等字段驱动动画和飘字逻辑，并在结尾附加一条 `result` 类型的结算节点。【F:miniprogram/pages/battle/play.js†L1229-L1253】【F:miniprogram/shared/battle.js†L1196-L1225】

## 2. 角色姿态动画
| 触发条件 | 样式/动画 | 说明 |
| --- | --- | --- |
| `currentAction.actor === 'player'`/`'opponent'` | `.avatar-wrapper.is-attacking .avatar-inner` → `attackPulse` 动画 | 施法侧头像前倾放大，突出出手动作。【F:miniprogram/shared/templates/battle-stage.wxml†L132-L152】【F:miniprogram/shared/styles/battle-stage.wxss†L390-L416】
| `currentAction.target === 'player'`/`'opponent'` | `.avatar-wrapper.is-hit .avatar-inner` → `hitShake` 动画 | 受击侧头像震动，表达命中反馈。【F:miniprogram/shared/templates/battle-stage.wxml†L152-L171】【F:miniprogram/shared/styles/battle-stage.wxss†L394-L420】
| `type === 'result'` | 跳过攻击/受击动画，延长 2.2s 停留并弹出结算卡片 | 结算节点不播放冲突动画，交由结果卡片呈现。【F:miniprogram/pages/battle/play.js†L1252-L1299】

> 若后续新增特殊动作（如蓄力、防御），可在 `currentAction` 上追加布尔标记并在模版中绑定新 class，从而触发自定义关键帧。

## 3. 飘字与动作类型映射
`applyActionFloatingTexts` 会针对每个动作推送飘字，`showFloatingText` 根据 `type` 拼出 `.floating-{{type}}` class，从而套用对应配色/动画。【F:miniprogram/pages/battle/play.js†L1107-L1206】【F:miniprogram/shared/templates/battle-stage.wxml†L135-L161】【F:miniprogram/shared/styles/battle-stage.wxss†L289-L335】

| 飘字类型 | 触发来源 | 样式效果 |
| --- | --- | --- |
| `skill` | 任意非 `result/dodge` 动作提取到的技能名或默认“普攻” | 字号加大、字距拉开，突出技能名称。【F:miniprogram/pages/battle/play.js†L1155-L1169】【F:miniprogram/shared/styles/battle-stage.wxss†L313-L316】
| `damage` | HP 下降且未暴击 | 红色数值飘字。【F:miniprogram/pages/battle/play.js†L1188-L1200】【F:miniprogram/shared/styles/battle-stage.wxss†L318-L320】
| `crit` | HP 下降且命中 `effects` 中的 `crit` | 金色放大并改用 `floatingCritBurst` 动画。【F:miniprogram/pages/battle/play.js†L1189-L1199】【F:miniprogram/shared/styles/battle-stage.wxss†L330-L370】
| `heal` | HP 上升 | 绿色数值飘字。【F:miniprogram/pages/battle/play.js†L1200-L1206】【F:miniprogram/shared/styles/battle-stage.wxss†L322-L324】
| `dodge` | 动作类型为 `dodge` 或 `effects` 含 `dodge` | 淡色提示“闪避”。【F:miniprogram/pages/battle/play.js†L1162-L1174】【F:miniprogram/shared/styles/battle-stage.wxss†L326-L328】

> `buildEffectsFromStructuredEntry` 还会识别 `block`、`shield`、`status`、`heal` 等效果标签，但目前前端只消费 `crit/dodge/heal`。若要呈现格挡、护盾或状态变化，可在 `applyActionFloatingTexts` 中追加对应 `type` 并于样式表定义 `.floating-block`、`.floating-shield` 等样式。【F:miniprogram/shared/battle.js†L707-L749】

## 4. 结算卡片
当 `action.type === 'result'` 或战斗播放完毕时，页面会设定 `resultClass` 为 `victory` / `defeat` / `draw`，并展示带不同边框阴影的结算卡片。动画自 `battleFinished` 后常驻，可在 `.result-card` 系列样式上扩展更多特效。【F:miniprogram/pages/battle/play.js†L1256-L1299】【F:miniprogram/shared/styles/battle-stage.wxss†L471-L507】

## 5. 样式扩展建议
1. **动作态识别**：后端可在时间线里新增 `actionType`（如 `charge`、`guard`），前端读取后在 `currentAction` 基础上挂载新 class，再在 WXSS 中定义动画。
2. **效果飘字**：利用现有 `effects` 标签，在 `applyActionFloatingTexts` 中补充 `block/shield/status` 分支，即可无缝套用 `.floating-{{type}}` 机制。
3. **角色立绘特效**：可在 `.avatar-wrapper.attacker/defender` 基础上引入渐变或光效，结合 `is-attacking`/`is-hit` 状态控制透明度或滤镜，实现更丰富的动作反馈。
