# 微信小程序公共模块

在命令行执行`zip -r nodejs-layer.zip node_modules/`进行打包，将zip包上传至腾讯云-云函数-层管理中。其他云函数要想引用公共模块，可以使用例如：`require('common-config')`。
