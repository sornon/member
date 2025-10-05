0. **公共模块**：[等级相关的配置信息都维护在公共模块level-config](https://tcb.cloud.tencent.com/dev?envId=cloud1-8gyoxq651fcc92c2#/scf?tab=layer)，`bootstrap`、`admin`、`menuOrder`、`wallet`这4个云函数需要绑定该层，引用该公共模块的方法为：`require('level-config')`。
1. **修改配置文件**：仅在 `cloudfunctions/nodejs-layer/level-config.js` 中调整修为换算、境界阈值、权益等纯数据，避免在其他云函数中写死常量。
2. **重新部署相关云函数**：提交修改后需要同步上传 `bootstrap`、`admin`、`menuOrder`、`wallet` 等引用该配置的云函数，确保运行时代码读取到最新参数。
3. **重新执行初始化脚本**：在微信云托管后台或命令行工具中再次触发 `bootstrap` 云函数，脚本会以相同 `_id` 覆写 `membershipLevels`、`membershipRights` 等集合条目，从而下发新配置。
4. **与历史数据的兼容性**：
   - `membershipLevels` 集合仅作为静态配置，被覆写后用户历史升级记录仍可继续使用，不会造成重复主键冲突。
   - 若调整 `EXPERIENCE_PER_YUAN` 或大幅修改阈值，请提前评估是否需要对既有会员的修为值或权益发放策略做补偿；系统不会自动回溯或迁移历史流水。
   - 若上线前已发放实体权益，建议结合运营需求确认是否需要追加新权益或通知用户，以免造成预期差异。
- `cloudfunctions/member/index.js` 扩展等级接口，返回境界描述、常规奖励与里程碑奖励，便于前端呈现完整信息。
- `miniprogram/pages/membership` 页面新增“主境界进阶”与“等级列表”展示，结合 `formatDiscount`、`levelBadgeColor` 等工具函数，可视化成长进度与奖励结构。

该方案通过明确的阶段目标、高频反馈与阶段性大奖，营造沉浸式修仙旅程，既满足用户炫耀与收集需求，也为商户提供可控、可调整的运营模型。
