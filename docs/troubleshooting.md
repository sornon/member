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
