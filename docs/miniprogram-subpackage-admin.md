# 小程序后台管理分包说明

参考[微信官方分包文档](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/basic.html)，将后台管理页面从主包拆分为独立分包，减少主包体积并方便后续维护。以下记录了本次调整的步骤与注意事项。

## 分包配置
- 在 `miniprogram/app.json` 的 `subpackages` 中新增名称为 `admin`、根目录为 `subpackages/admin` 的分包，分包页面包括首页、宗门管理、预约审核、会员管理、存酒、会员详情、扣费单、订单、交易、备餐列表、菜单维护、活动管理、财务报表、数据清理和系统开关。
- 同时从主包 `pages` 列表中移除了上述后台页面，确保它们只在分包中声明。

## 文件迁移
- 原位于 `miniprogram/pages/admin/` 下的所有页面文件整体迁移至 `miniprogram/subpackages/admin/`，保持原有目录结构与文件名。
- 迁移后使用的组件和工具库依旧保持原有引用方式（绝对路径的组件引用不需要调整，指向 `services/`、`utils/` 等目录的相对路径深度与迁移前一致）。

## 路由与跳转更新
- 所有指向后台页面的跳转路径统一替换为 `/subpackages/admin/...`。首页入口改为 `/subpackages/admin/index`，后台内部的页面互跳也同步更新为分包路径。

## 验证建议
1. 在开发者工具中重新编译并预览，确认主包/分包体积符合发布要求。
2. 通过首页“管理员”入口进入后台，验证各页面加载、跳转和数据拉取正常。
3. 后续新增后台页面时，请直接创建在 `subpackages/admin/` 下，并补充到 `app.json` 分包配置和相关入口跳转路径。
