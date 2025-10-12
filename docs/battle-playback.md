# 战斗演武背景配置指引

## 结构化战斗数据
- 云函数需要在战报中提供符合《[战斗过程数据格式规范](./battle-data-format.md)》的 `timeline` 与 `participants` 字段。前端会优先读取结构化数据来渲染战斗过程，若缺失则回退到旧版文字日志解析。
- 结构化数据允许动画、数值统计与客服工具共享同一份时间线，无需再根据描述文本逆向推导动作，大幅降低回放失真与维护成本。
- 在迁移阶段可同时输出 `log` 与 `timeline`，待客户端完成灰度后逐步废弃文字日志。
- 时间线节点必须包含攻受双方的属性快照（`participants.attributes` 与 `timeline.state.*.attributes`），以确保回放展示与战斗发生当时保持一致，避免角色成长或削弱导致的“历史战斗数值错位”。

## 秘境（PVE）场景
- 战斗页面会优先读取敌人概要中的 `scene` 或 `backgroundVideo` 字段，如果没有显式配置，则根据关卡所属境界自动匹配 `common-config` 中的同名场景视频。
- 如果秘境需要自定义视频，请在敌方配置中补充 `scene.video` 或 `scene.backgroundVideo`，或直接指定 `backgroundId` 以复用背景库中的条目；否则系统会回退到当前境界的默认视频资源。
- 该逻辑集中在 `/pages/battle/play` 的 `resolvePveSceneBackground` 方法中，可根据需要扩展读取其它元数据字段。

## 竞技场（PVP）对战
- 云函数会在生成战斗数据时同时封装参战双方当前的外观背景，并记录 `initiatorId/defenderId`，以便前端识别防守方的主界面背景。
- 回放/实时播放均调用 `resolvePvpDefenderBackgroundVideo`，按以下优先级选择视频：战斗记录内的防守方 → 当前上下文（如接受邀请时本人即防守方）→ 对手预览中透传的 `defenderBackground`。
- 若需新增或调整背景资源，请在成员外观设置中选择已上传的背景，或更新 `cloudfunctions/nodejs-layer/node_modules/common-config/index.js` 中的映射关系即可生效。
