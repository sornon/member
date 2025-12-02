# 平衡性配置后台与部署说明

本次新增「平衡性设定」管理员页面，用于管理 `cloudfunctions/nodejs-layer/node_modules/balance` 下的所有数值字段，支持暂存、测试与全局应用。

## 新增能力
- **后台入口**：管理员中心新增「平衡性设定」，可逐字段编辑等级曲线、装备成长、技能资源、PVE/PVP 参数，并展示默认值提示。
- **暂存与测试**：点击「暂存配置」会新建一条 `status=staging` 记录，并将旧的 `staging`（若存在）自动改为 `backup`，确保库内最多只有一条暂存配置；「测试暂存配置」基于暂存数据跑多轮 PVP PK，生成胜率/回合数报告。
- **应用到全局**：对测试结果满意后点击「应用到全局」，会自动把当前 `staging` 记录升级为 `status=use`，并将旧的 `use` 记录全部标记为 `status=backup`，实时刷新 PVE/PVP 云函数的运行时缓存，保证线上仅有一条生效配置。

## 部署步骤
1. **创建集合**：在云开发数据库中新建 `balanceConfigs` 集合，文档 `_id` 使用从 1 开始的自增数字（云函数会自动生成），并保留 `status` 字段用于区分 `use` / `staging` / `backup`。
2. **上传云函数**：重新部署以下云函数以加载新能力：
   - `cloudfunctions/admin`
   - `cloudfunctions/pvp`
   - `cloudfunctions/pve`
3. **上传公共模块**：若使用了独立云托管层，请确保 `cloudfunctions/nodejs-layer` 一并发布，使新的 `balance/config-loader` 与 `balance/config-store` 生效。
4. **更新小程序**：构建并上传小程序，包含新增页面 `subpackages/admin/balance-settings` 与首页入口。

## 使用指引
1. 管理员进入「平衡性设定」，按字段编辑后点击 **暂存配置**。当前值与默认值并行显示，便于比对。
2. 点击 **测试暂存配置**，系统会用暂存参数运行多轮 PVP 模拟，页面展示胜率、平局数、平均回合等指标。
3. 确认无误后点击 **应用到全局**，新配置将写入 `balanceConfigs` 集合并标记为 `use`，上一条线上配置会自动改为 `backup` 备份，PVE/PVP 云函数入口实时刷新缓存，立刻生效。
4. 如需回退，可将备份配置改为暂存后重新应用，或清空暂存配置再应用即可恢复默认。
