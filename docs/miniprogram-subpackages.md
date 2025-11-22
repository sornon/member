# 小程序分包配置说明

## 背景

主包体积已逼近 1.5M 上限，为避免发布受阻，将宗门系统和管理员后台页面迁移至分包。参考微信官方文档《[基础分包](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/basic.html)》进行配置。

## 目录调整

- 宗门分包
  - 根目录：`miniprogram/subpackages/guild`
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
  - 原有 `miniprogram/pages/guild/*` 目录已整体移动到上述位置。
  - 兼容处理：为避免历史缓存仍引用老路径，保留 `miniprogram/pages/guild/logs/index` 的占位页并自动重定向至 `/subpackages/guild/logs/index`。

- 管理员分包
  - 根目录：`miniprogram/subpackages/admin`
  - 已迁移页面：
    - `index`
    - `guild/index`
    - `reservations/index`
    - `members/index`
    - `wine-storage/index`
    - `member-detail/index`
    - `charge/index`
    - `orders/index`
    - `trading/index`
    - `menu-orders/index`
    - `menu-catalog/index`
    - `activities/index`
    - `finance-report/index`
    - `data-cleanup/index`
    - `system-switches/index`
  - 原有 `miniprogram/pages/admin/*` 目录已整体移动到上述位置。

## 配置变更

- `miniprogram/app.json` 新增 `admin` 与 `guild` 两个分包配置，将后台与宗门页面声明为分包。
- 导航入口及页面间跳转的路径已改为 `/subpackages/admin/...`、`/subpackages/guild/...`，确保路由落在对应分包内。

## 后续指引

- 新增后台或宗门页面时，请将文件放在对应分包目录并在 `app.json` 注册。
- 其它页面如需跳转至后台或宗门模块，统一使用分包路径 `/subpackages/admin/index`（后台首页）或 `/subpackages/admin/<page>/index`，宗门模块使用 `/subpackages/guild/<page>/index`。
- 如需进一步拆分其他业务，可沿用相同方式创建新的 `subpackages/<name>` 目录，并在 `app.json` 中追加分包配置。
