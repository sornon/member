# 常见问题排查

## 云函数 `common` 上传失败（CreateFailed）

**报错信息**

```
Error: TencentCloud API error: {
    "Response": {
        "Error": {
            "Code": "FailedOperation.UpdateFunctionCode",
            "Message": "当前函数处于CreateFailed状态，无法进行此操作，请稍后重试。"
        },
        "RequestId": "..."
    }
}
```

**原因分析**

首次在腾讯云开发控制台创建云函数时，如果目录为空、缺少入口函数或依赖未正确上传，平台会将函数标记为 `CreateFailed`。此状态下禁止继续更新代码，因此开发者工具或 CI 在上传 `common` 函数时会持续报错。

**处理步骤**

1. 登录 [云开发控制台](https://console.cloud.tencent.com/tcb) → 进入对应环境。
2. 打开“云函数”列表，定位到 `common` 函数。
3. 若状态为 `创建失败`，点击右侧操作栏的 **删除**，确认彻底移除。
4. 回到微信开发者工具或本地命令行，重新上传 `common` 目录；仓库已提供可用的 `index.js` 与 `package.json`，确保函数能够成功创建。

> 如需在 `common` 函数中托管共享依赖，可在 `cloudfunctions/common` 目录按需新增模块并重新部署；保持目录非空即可避免再次进入 `CreateFailed` 状态。

### 删除后再次上传出现 `ResourceNotFound.Function`

**报错信息**

```
Error: TencentCloud API error: {
    "Response": {
        "Error": {
            "Code": "ResourceNotFound.Function",
            "Message": "未找到指定的Function，请创建后再试。"
        },
        "RequestId": "..."
    }
}
```

**原因分析**

当在控制台删除 `common` 函数后，云环境中已经不存在该函数实例。微信开发者工具（或 `tcb` CLI）默认会调用“更新函数代码”接口，如果函数还未重新创建，则会返回 `ResourceNotFound.Function` 错误。

**处理步骤**

1. 登录 [云开发控制台](https://console.cloud.tencent.com/tcb) → 切换至目标环境。
2. 在“云函数”列表点击 **新建云函数**，选择“自定义创建”。
3. 将函数名称设置为 `common`，运行环境选择与项目一致的 Node.js 版本（推荐 Node.js 10 或更高），触发方式保持默认。模板可选择“空模板”。
4. 点击 **完成** 创建空函数实例。
5. 函数创建成功后，再使用微信开发者工具或命令行重新上传 `cloudfunctions/common` 目录，即可恢复部署。

> 若团队使用 `tcb` CLI 或 CI/CD 管道，也可先执行 `tcb functions:create common`（指定运行环境），确认创建成功后再执行 `tcb functions:deploy common`。

## `common` 与 `shared` 云函数的作用

- **定位**：这两个云函数用于托管公共模块与 npm 依赖，便于其他业务函数通过 `require` 引用共享代码，也能满足某些部署流程对非空函数包的要求。
- **是否必备**：当前版本的前台/后台业务不会直接调用 `common` 与 `shared`，因此若你完全不需要在云端保存共享代码，可以选择不创建它们。
- **为何推荐保留**：一旦后续需要上传公共工具或三方依赖，将它们放入 `cloudfunctions/common` 或 `cloudfunctions/shared` 目录后再部署即可复用；同时可以规避因目录为空导致的 `CreateFailed`、`ResourceNotFound.Function` 报错。

> 如果你决定临时删除 `common` 或 `shared`，请同步调整 CI/CD 或开发者工具的部署列表，避免脚本在上传阶段再次访问已删除的函数。
