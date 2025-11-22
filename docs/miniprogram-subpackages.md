# 小程序分包方案

为解决主包超过 1.5M 无法发布的问题，主包保留核心页面，宗门与管理员相关页面拆分为两个分包，以减小首包体积并减少非核心资源的首屏加载。

## 配置位置

分包通过修改 `miniprogram/app.json` 中的 `subPackages` 字段完成，不需要调整页面目录结构。每个分包都指定了根目录与包含的页面：

- **guild 分包**：`pages/guild` 下的宗门功能页面。
- **admin 分包**：`pages/admin` 下的管理员与运营工具页面。

## 当前配置摘要

```json
{
  "subPackages": [
    {
      "root": "pages/guild",
      "name": "guild",
      "pages": [
        "index/index",
        "members/index",
        "tasks/index",
        "boss/index",
        "logs/index",
        "attributes/index",
        "create/index",
        "detail/index",
        "team/index"
      ]
    },
    {
      "root": "pages/admin",
      "name": "admin",
      "pages": [
        "index",
        "guild/index",
        "reservations/index",
        "members/index",
        "wine-storage/index",
        "member-detail/index",
        "charge/index",
        "orders/index",
        "trading/index",
        "menu-orders/index",
        "menu-catalog/index",
        "activities/index",
        "finance-report/index",
        "data-cleanup/index",
        "system-switches/index"
      ]
    }
  ]
}
```

## 开发与发布注意事项

- 主包 `pages` 字段只保留核心页面（如首页、会员、商城、战斗等）。分包页面不再出现在主包页面列表中。
- 分包根目录下的资源会随分包打包，跨分包引用 JS 或资源会受到微信分包限制；公共模块建议放在主包的 `shared` 或 `services` 中。
- 如需新增宗门或管理员页面，请直接放在对应分包根目录下并同步更新 `subPackages` 配置。
- TabBar 仅可配置在主包页面内，如需调整请确保目标页面仍在主包。
- 开发者工具版本需不低于 1.06.2406242 才能调试分包入口文件，发布环境无额外要求。

执行 `npm run build` 或云端打包时，微信开发者工具会按照以上配置自动生成分包，首包体积应低于 1.5M。
