# 小程序分包配置说明

## 背景

主包体积已逼近 1.5M 上限，为避免发布受阻，将宗门系统页面迁移至分包。参考微信官方文档《[基础分包](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/basic.html)》进行配置。

## 目录调整

- 分包根目录：`miniprogram/subpackages/guild`
- 已迁移页面：
  - `index/index`
  - `members/index`
  - `tasks/index`
  - `boss/index`
  - `logs/index`
  - `attributes/index`
  - `create/index`
  - `detail/index`
  - `team/index`

原有 `miniprogram/pages/guild/*` 目录已整体移动到上述位置，分包内的相对引用无需调整（组件依旧通过绝对路径引用）。

## 配置变更

- `miniprogram/app.json` 新增 `subpackages` 配置，将宗门相关页面声明为 `guild` 分包。
- 导航入口及页面间跳转的路径已改为 `/subpackages/guild/...`，确保路由落在分包内。

## 后续指引

- 新增宗门页面时，请将文件放在 `miniprogram/subpackages/guild` 并在 `app.json` 对应分包的 `pages` 列表中注册。
- 其它页面如需跳转至宗门模块，统一使用分包路径 `/subpackages/guild/<page>/index`。
- 如需进一步拆分其他业务，可沿用相同方式创建新的 `subpackages/<name>` 目录，并在 `app.json` 中追加分包配置。
