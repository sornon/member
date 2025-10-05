# 微信小程序云函数

每一个文件夹都是独立的云函数，需要分别上传到微信小程序的云函数里，唯独nodejs-layer目录是公共模块，需要通过腾讯云的云函数后台-层管理进行打包上传，其他云函数如果用到公共模块时，需要在云函数配置的层管理中进行绑定。

## 公共模块绑定清单

以下云函数依赖 `common-config` 层提供的集合常量、管理员角色及交易状态配置。上传代码后，请在腾讯云开发控制台的“层管理”中为这些云函数绑定 `common-config` 公共模块，否则运行时会因为找不到共享配置而报错：

- `admin`
- `avatar`
- `bootstrap`
- `member`
- `menuOrder`
- `reservation`
- `stones`
- `tasks`
- `pve`
- `pvp`
- `wallet`

后续若有新增云函数引用 `require('common-config')`，也需要同步在部署说明中补充清单并在控制台完成层绑定。

此外，`cloudfunctions/nodejs-layer/node_modules/combat-system` 封装了角色属性汇总、伤害结算与战力评分等公共战斗公式。目前 `pve`、`pvp` 云函数均通过 `require('combat-system')` 引用该模块，部署时请将更新后的 `nodejs-layer` 打包为新的层版本并在上述两个云函数中完成绑定，否则会出现 `Cannot find module 'combat-system'` 的运行时错误。

## 云函数开发原则

- **禁止跨云函数调用**：跨云函数调用非常影响性能，禁止使用。
- **公共模块使用场景**：当多个云函数中需要引用相同的配置时，可以在nodejs-layer/node_modules/common-config/下进行更新。当多个函数中需要引用相同的函数时，可以在nodejs-layer/node_modules/创建所需的公共函数。遵循微信小程序公共模块规范。
