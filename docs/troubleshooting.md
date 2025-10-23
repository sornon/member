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

## 秘境战斗速度判定导致的先手异常

**现象**

秘境战斗中，无论双方速度如何，始终按照“敌我轮流”固定顺序行动：例如敌方速度 126、我方速度 106 时，第一回合敌方先手，随后各回合依旧维持敌方出手、我方出手交替的模式，无法体现速度优势。

**原因分析**

旧版模拟器只在战斗开始时比较一次速度，随后每回合简单地在敌我之间轮换先手，忽略了速度变化或速度本身的持续影响。

**修复方案**

自 2024 年 6 月起，秘境战斗会在每个新回合开始时重新比较双方当前速度，并以此决定当回合的行动顺序；若任一方受到控制而跳过出手，会在记录跳过事件后再让另一方行动，确保速度优势能贯穿整场战斗。前端战斗回放也会在渲染每一回合前据此调整动作顺序，避免界面展示仍然呈现“敌我轮换”造成的误判。同一时期，比武竞技场亦采用相同的公共判定逻辑（`cloudfunctions/nodejs-layer/node_modules/combat-system`），保证 PVE/PVP 两侧的回合先后顺序完全一致。

## 战斗回放中被控制角色滤镜未及时解除

**现象**

角色被控制 1 回合后，下次实际出手时仍然保持黑白滤镜，界面上出现“灰度状态下攻击”的违和感。

**原因分析**

此前前端只在检测到“被控制”浮空文字时延迟套用黑白滤镜，但在角色重新获得行动权后并未提前清理状态，导致滤镜持续到攻击动画开始。

**修复方案**

自 2024 年 6 月 25 日起，战斗回放会在推进下一次行动前，根据该行动是否继续处于“被控制”跳过判定即时解除滤镜，确保角色在恢复出手时恢复彩色显示。

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
2. 在前端代码中统一改为引用云存储路径。仓库已新增 `miniprogram/shared/asset-paths.js`，用于集中维护云端基础路径，并被首页背景与角色图逻辑复用。
3. 日后新增背景/角色素材时，只需：
   - 将文件上传至对应云端目录；
   - 确保文件名与本地约定一致（例如 `1.jpg`、`male-b-1.png`）；
   - 无需重新打包图片到主包内，从而保持主包体积稳定在 1.5M 以下。

> 若需要临时回退为本地资源，可在 `asset-paths.js` 中调整基础路径为本地 `assets` 目录，但请注意这会再次增加主包体积。

## 点击“授权获取微信昵称”未弹出授权弹窗

**现象**

在入门引导页点击“授权获取微信昵称”后，直接提示“已获取微信昵称”或同步成功，但微信未再弹出用户授权确认窗口。

**原因分析**

1. 小程序使用 `wx.getUserProfile` 主动获取头像昵称信息（`pages/index/index.js` 的 `handleRequestUserProfile` 与 `handleAvatarPickerSyncWechat`）。该接口只要在按钮点击等用户触发场景中调用，就会返回 `userInfo`。【F:miniprogram/pages/index/index.js†L1366-L1393】【F:miniprogram/pages/index/index.js†L1529-L1565】
2. 当用户首次同意授权后，微信会缓存授权结果，再次调用 `wx.getUserProfile` 时直接返回上次授权的数据，不会重复弹窗；项目也会把 `authorizationStatus.profileAuthorized` 置为 `true`，在引导界面展示“已授权微信昵称”的状态。【F:miniprogram/pages/index/index.js†L1548-L1565】【F:miniprogram/pages/index/index.js†L968-L1008】

**处理建议**

- 若需要调试弹窗，可使用未授权过的小程序账号（或在微信 → 设置 → 隐私 → 授权管理中找到该小程序，撤销“头像、昵称”授权后重新进入）。
- 一般业务场景无需强制弹窗，只要 `userInfo` 正常返回即可继续保存会员资料；若前端确实未能拿到 `userInfo`，请检查按钮点击事件是否触发了 `wx.getUserProfile` 调用，或留意接口回调中的错误信息。
