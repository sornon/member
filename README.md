# 微信小程序会员体系

本仓库提供一套基于微信小程序云开发的会员体系示例项目，涵盖会员注册、等级成长、权益发放、任务及优惠券、在线预订、支付余额管理与虚拟形象等模块。项目以“修仙等级”作为主题包装，强调数值可配置、权益可扩展，并提供详尽的部署与二次开发指引，便于团队快速落地并根据业务调整。

## 功能概览

- **会员注册与账户激活**：利用微信一键登录和手机号授权，自动完成会员建档与初始数据写入。
- **修仙等级体系**：按 10 个主境界、100 个小等级构建充值成长模型，阈值与奖励可配置（详见 [等级方案](docs/level-plan.md)）。
- **权益管理**：权益数据存储于数据库，可按等级自动发放、设定有效期并支持后续重写。
- **任务与优惠券**：拉新、签到、消费返券、互动任务等统一由任务引擎处理，奖励发券自动化。
- **在线预订与下单**：可视化包房/卡座预约，支持定金/全额支付与权益券抵扣。
- **资产体系**：现金钱包支持充值消费流水，灵石作为虚拟货币独立结算；提供明细查询。
- **虚拟形象（Avatar）**：QQ 秀风格的装扮系统，等级与任务可解锁服饰并分享展示。
- **秘境 PVE 玩法**：构建属性、装备、技能抽卡与副本战斗体系，提供持续的成长与掉落激励。
- **仙缘档案编辑**：会员可自助修改道号、性别与头像，支持改名次数管控及改名卡补充次数。

## 技术栈

- **前端**：微信小程序原生框架（WXML/WXSS/JS），使用云开发 API 调用云函数。
- **后端**：微信云开发 CloudBase（云函数 + 云数据库 + 云存储）。云函数使用 Node.js 编写，默认依赖 `wx-server-sdk`。
- **项目结构**：前后端分离，所有业务调用均通过统一的 `services` 层转发到云函数，便于日后替换为自建服务器或其他 BaaS。

## 快速开始

> 以下步骤面向第一次接触微信云开发的同学，尽可能做到“开箱即用”。

### 1. 申请并配置开发环境

1. 安装最新版 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 在微信公众平台（小程序后台）创建或获取一个小程序 AppID。
3. 打开微信开发者工具，登录后选择“导入项目”，本地目录指向当前仓库根目录，填写 AppID。
4. 在工具中启用“云开发”，创建环境（免费版即可），记下 `envId`。

### 2. 初始化云开发资源

1. 在 `project.config.json` 中将 `cloudfunctionRoot` 保持默认，后续直接上传即可。
2. 打开“云开发控制台 → 数据库”，创建以下集合：
   - `members`
   - `memberExtras`
   - `memberTimeline`
   - `membershipLevels`
   - `membershipRights`
   - `memberRights`
   - `tasks`
   - `taskRecords`
   - `coupons`
   - `couponRecords`
   - `reservations`
   - `rooms`
   - `walletTransactions`
   - `stoneTransactions`
   - `avatars`
   - `errorlogs`
3. 在“云函数”面板中右键部署以下函数（需先安装依赖）：
   - `bootstrap`
   - `member`
   - `tasks`
   - `reservation`
   - `wallet`
   - `avatar`

部署方法：

```bash
# 在仓库根目录执行
npm install -g miniprogram-ci # 可选，用于 CI/CD
# 进入每个云函数目录安装依赖
cd cloudfunctions/member && npm install && cd -
# 也可在微信开发者工具中右键「安装依赖」
```

部署完成后，先执行一次 `bootstrap` 云函数，它会向数据库写入示例数据（等级、房间、任务等），便于演示及二次开发。

> 提醒：若对会员档案逻辑做了改动（例如改名次数、头像选择等），请重新部署 `member` 云函数并上传最新小程序前端代码。

### 3. 配置小程序前端

1. 在 `miniprogram/app.js` 中的 `env` 替换为你的云开发 `envId`。
2. 若有专属 CDN 或自建 API，可在 `miniprogram/services/config.js` 中调整服务端地址或云函数名称。
3. 使用开发者工具的“预览”或“真机调试”功能即可运行体验。

## 监控与错误日志

- 小程序在调用云函数出现异常时会自动写入 `errorlogs` 集合，记录接口名称、会员 ID、时间以及完整的错误信息，便于排查线上问题。
- 首次部署或升级到包含该功能的版本时，请确保已经创建 `errorlogs` 集合，可通过重新执行 `bootstrap` 云函数自动创建。

## 常见问题

- **云函数 `common` 上传报错 `CreateFailed`**：通常是首次创建云函数时目录为空导致。请先在云开发控制台删除状态为“创建失败”的 `common` 函数，再重新上传仓库内的 `cloudfunctions/common` 目录；若删除后提示 `ResourceNotFound.Function`，需要先在控制台重新创建同名函数实例。详见 [常见问题排查](docs/troubleshooting.md#云函数-common-上传失败createfailed)。

## 数据结构说明

### members

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | string | openid，云开发自动填充 |
| `nickName` | string | 用户昵称 |
| `mobile` | string | 绑定手机号 |
| `gender` | string | 性别，取值 `male` / `female` / `unknown` |
| `renameCredits` | number | 剩余改名次数，初始值为 1，可用改名卡增加 |
| `renameCards` | number | 改名卡库存数量 |
| `renameUsed` | number | 已经消耗的改名次数，便于审计 |
| `levelId` | string | 当前等级 ID |
| `experience` | number | 累积经验值（可映射到充值额） |
| `cashBalance` | number | 现金钱包余额（单位：分，用于店内实体消费） |
| `stoneBalance` | number | 灵石余额（整数，仅用于虚拟商品与玩法） |
| `createdAt` | Date | 注册时间 |
| `avatarConfig` | object | 虚拟形象配置 |

> 现金钱包与灵石为两套完全独立的账户体系，当前版本不支持兑换或折现，灵石数值仅以整数形式发放与消耗。

> 提示：增长速度较快的扩展字段（如头像解锁、等级奖励、改名记录）已迁移至 `memberExtras` 与 `memberTimeline` 集合，避免主档案文档持续膨胀，从而提升读取性能。

### memberExtras

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | string | 与会员 `openid` 一致 |
| `avatarUnlocks` | array | 已解锁的头像 ID，统一存放在扩展集合以便按需加载 |
| `claimedLevelRewards` | array | 已领取的等级奖励 ID 列表 |
| `createdAt` | Date | 创建时间 |
| `updatedAt` | Date | 最近更新时间 |

### memberTimeline

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | string | 文档 ID |
| `memberId` | string | 对应会员 `openid` |
| `type` | string | 日志类型（当前用于 `rename`） |
| `previous` | string | 变更前的值（改名时为旧昵称） |
| `current` | string | 变更后的值 |
| `source` | string | 变更来源（`manual`、`admin` 等） |
| `changedAt` | Date | 业务发生时间 |
| `createdAt` | Date | 日志写入时间 |

## 仙缘档案编辑

- **道号（`nickName`）**：
  - 新注册用户默认拥有 1 次改名机会（`renameCredits`）。
  - 使用“改名卡”会将 `renameCards` 库存转换为新的改名次数，并在 `memberTimeline` 中追加改名记录，同时累积 `renameUsed`。
  - 每次改名均会记录原名称、现名称、时间与来源，便于运营稽核。
  - 管理员后台修改道号同样写入 `memberTimeline`，来源标记为 `admin`，且不会扣减用户的改名次数。
- **性别（`gender`）**：支持 `male`、`female`、`unknown` 三种取值，可随时切换。
- **头像（`avatarUrl`）**：前端默认生成 5 个渐变风格的 SVG 头像供选择，也可一键同步微信头像。

> 如需在运营后台发放改名卡，可直接增加 `renameCards` 字段值，或结合任务/权益体系发卡；前端会在用户使用改名卡时自动调用 `redeemRenameCard` 动作同步次数。

### membershipLevels

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `_id` | string | 等级 ID（如 `foundation`） |
| `name` | string | 等级名称（筑基等） |
| `threshold` | number | 升级所需经验/充值额 |
| `discount` | number | 消费折扣（如 0.95） |
| `rewards` | array | 升级奖励（引用 `membershipRights` 或自定义描述） |
| `order` | number | 排序，越大等级越高 |

### membershipRights & memberRights

- `membershipRights` 存储所有可配置权益；
- `memberRights` 记录用户获发的权益券（含有效期、状态、使用记录），便于未来重写权益逻辑。

### tasks / taskRecords / coupons / couponRecords

任务定义、任务执行记录、优惠券定义与领取记录，以支持拉新、签到、返券等玩法。

### rooms / reservations

房间及预约订单，支持在线预订、权益抵扣、支付状态追踪。

### walletTransactions

充值与消费流水，区分 `type`（`recharge`、`spend`、`refund`）方便财务对账。

### stoneTransactions

灵石收支流水，记录任务奖励、活动发放与消耗，所有数值均以整数存储，且不可与现金钱包互转。

### avatars

虚拟形象素材表，记录可穿戴的部件、解锁条件、资源链接。

## 云函数说明

| 云函数 | 作用 | 主要动作 |
| ------ | ---- | -------- |
| `bootstrap` | 初始化示例数据 | 写入等级、权益、房间、任务等基础数据 |
| `member` | 会员档案、等级逻辑 | 注册、查询、经验更新、权益发放、获取权益列表 |
| `tasks` | 任务与优惠券 | 列表、进度更新、领取优惠券、校验使用次数 |
| `reservation` | 卡座预约 | 查询可用房间、创建订单、核销权益、取消订单 |
| `wallet` | 现金钱包 | 充值下单、余额支付、流水记录、组合支付计算 |
| `stones` | 灵石账户 | 灵石余额查询、流水记录 |
| `avatar` | 虚拟形象 | 查询素材、保存用户搭配、生成分享图占位 |

> 如需迁移至自建后端，只需在 `miniprogram/services` 中替换为 HTTPS 请求，即可保持前端逻辑不变。

## 二次开发建议

1. **会员权益重写**：
   - 所有权益定义均存于 `membershipRights` 集合，云函数 `member` 中的 `grantLevelRewards` 使用该集合数据生成用户权益，保持数据驱动；
   - 若需更复杂的权益（如多次核销、动态库存），建议新增 `rightsEngine` 云函数或引入规则引擎。
2. **支付合规**：生产环境必须在商户平台开通“微信支付分账”或“余额账户”相关资质，并确保遵守《微信支付商户平台服务协议》。
3. **数据安全**：
   - 使用云函数时默认可获取 `OPENID`，请勿在前端直接信任传入的 openid；
   - 对金额字段统一使用“分”为单位存储，避免浮点误差；
   - 提供操作日志与异常监控（可扩展到腾讯云 `CLS` 或第三方监控）。
4. **运营支撑**：
   - 建议结合企业微信或社群机器人，将任务/等级达成信息推送给客服，提高服务体验；
   - 定期复盘任务完成率、优惠券使用率、等级分布等指标，优化数值策划。

## 常见问题（FAQ）

1. **为什么运行时报 `cloud not defined`？**
   - 确保在微信开发者工具中勾选了“使用云服务”，并在 `app.js` 中初始化 `wx.cloud.init`。
2. **如何调试云函数？**
   - 可在微信开发者工具的“云函数”面板中使用“本地调试”或 `log.info` 输出；
   - 也可以使用 `cloudfunctions` 目录中的 `npm run local`（需自行扩展）在本地 Node.js 环境调试。
3. **能否接入线下会员卡？**
   - 可以，通过微信会员卡开卡组件，或在 `member` 云函数中新增 `bindCard` 方法写入线下卡号。

## 许可协议

本项目以 MIT 许可证开源，可自由使用与二次开发。欢迎提交 Issue 或 PR 一同完善。

