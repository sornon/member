# 小程序宗门系统分包说明

为解决主包体积超过 1.5M 无法上传的问题，将宗门相关页面拆分为独立分包，参考了[微信官方分包文档](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/basic.html)。本说明记录拆分步骤与注意事项，便于后续维护。

## 分包配置
- 在 `miniprogram/app.json` 中新增 `subpackages` 配置，创建名称为 `guild`、根目录为 `subpackages/guild` 的分包。
- 将原主包中的宗门页面（宗门首页、成员、任务、BOSS、日志、属性、创建、详情、团队）从 `pages` 列表移除，并放入分包的 `pages` 数组。

## 文件迁移
- 原位于 `miniprogram/pages/guild/` 下的所有页面文件整体移动到 `miniprogram/subpackages/guild/`。
- 原 `miniprogram/shared/guild.js` 工具文件随页面一起移动到 `miniprogram/subpackages/guild/shared/`，避免分包再去依赖主包同名文件，相关引用路径全部改为分包内的 `../shared/guild.js`。
- 迁移后组件引用仍保持绝对路径（例如 `/components/custom-nav/custom-nav`），无需调整；相对路径引用保持和迁移前一致。

## 路由与跳转更新
- 所有指向宗门页面的跳转路径统一替换为 `/subpackages/guild/...`，包括首页入口以及宗门内部的跳转按钮。
- 进入宗门系统的主入口路径变更为 `/subpackages/guild/index/index`。

## 验证建议
1. 重新编译并预览小程序，确认分包体积拆分后主包大小回落到 1.5M 以下。
2. 在开发者工具中打开宗门入口，逐个验证分包内页面可正常加载、跳转和下拉刷新等交互。
3. 若有新页面或资源新增到宗门系统，请直接创建在 `subpackages/guild/` 下，并同步更新 `app.json` 分包配置。
