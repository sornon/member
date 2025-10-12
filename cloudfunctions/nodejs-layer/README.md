# 微信小程序公共模块

在命令行执行`zip -r nodejs-layer.zip node_modules/`进行打包，将zip包上传至腾讯云-云函数-层管理中。其他云函数要想引用公共模块，可以使用例如：`require('common-config')`。

当前层包含以下公共模块：

- `common-config`：会员等级、场景背景等通用配置。
- `combat-system`：战斗属性计算与模拟工具函数。
- `skill-model`：技能池、流派与属性聚合逻辑。
- `battle-schema`：战斗结果与回放数据的统一结构化封装，供 PVE/PVP 云函数直接引用。
