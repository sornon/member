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

## 首页角色形象未显示

**现象**

在首页选择新的头像（如 `male-b-1`）后，右下角对应的角色全身像未加载。

**原因分析**

首页角色图曾通过硬编码 ID 列表（仅包含部分 `c` 品级）来拼接图片路径，导致新增的 `b`/`a` 等品级头像虽然具备命名规范一致的角色图，但始终无法被映射出来。

**解决方案**

自 2024-05-10 起，首页会使用头像目录的统一清单（`shared/avatar-catalog.js`）动态生成角色图映射。只要为头像与角色图提供同名 PNG 资源（例如头像 `assets/avatar/male-b-1.png` 与角色图 `assets/character/male-b-1.png`），即可自动生效，无需再次修改前端页面代码。

> 补充：新增头像时仍需按照既定流程更新头像清单（`shared/avatar-catalog.js`），以便头像选择器、解锁逻辑及角色图映射同时感知新资源。

## 主包体积超过 1.5M 导致上传失败

**现象**

微信开发者工具在预览或上传时代码包体积检测失败，提示“主包大小超过 1.5M，无法上传”。

**原因分析**

项目的背景图与角色立绘（`assets/background/*`、`assets/character/*`）数量较多，随着新增资源累积会导致主包快速膨胀，超出微信小程序 1.5M 的主包限制。

**解决方案**

1. 将这两类静态资源上传到云开发的存储空间，保持目录结构不变，例如当前环境使用的：
   - `cloud://cloud1-8gyoxq651fcc92c2.636c-cloud1-8gyoxq651fcc92c2-1380371219/assets/background/`
   - `cloud://cloud1-8gyoxq651fcc92c2.636c-cloud1-8gyoxq651fcc92c2-1380371219/assets/character/`
2. 在前端代码中统一改为引用云存储路径。仓库已新增 `miniprogram/shared/asset-paths.js`，用于集中维护云端基础路径，并被首页背景与角色图逻辑复用；代码会在运行时自动将 `cloud://` 文件 ID 转换为云开发的 CDN 域名（例如 `https://636c-cloud1-8gyoxq651fcc92c2-1380371219.tcb.qcloud.la/...`），确保体验版与正式版都能直接加载图片。
3. 日后新增背景/角色素材时，只需：
   - 将文件上传至对应云端目录；
   - 确保文件名与本地约定一致（例如 `1.jpg`、`male-b-1.png`）；
   - 无需重新打包图片到主包内，从而保持主包体积稳定在 1.5M 以下。

> 若需要临时回退为本地资源，可在 `asset-paths.js` 中调整基础路径为本地 `assets` 目录，但请注意这会再次增加主包体积。
