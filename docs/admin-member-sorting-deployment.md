# 管理员会员列表排序部署说明

## 问题原因

会员列表前端已经把 `sortBy` 传给 `AdminService.listMembers`，再由 `admin` 云函数转发给 `listMembers`。如果切换“累计充值升序/降序、最近活跃时间排序、注册时间排序”后列表看起来没有变化，通常有两个原因：

1. **云函数未重新部署**：小程序端更新后，如果线上 `admin` 云函数仍是旧版本，后端会忽略 `sortBy`，继续按默认注册时间倒序返回数据。
2. **直接使用数据库 `orderBy` 排历史字段不稳定**：历史会员数据里的 `totalRecharge`、`updatedAt` 等字段可能存在缺失、字符串/数字混用或需要复合索引的情况。此前代码直接在数据库层对原始字段 `orderBy`，会导致排序结果与页面展示的格式化金额/时间不一致，或者受云数据库索引配置影响。

本次修复后，`admin` 云函数会先拉取符合搜索条件的会员记录，再使用与页面展示一致的归一化逻辑进行排序：

- `rechargeAsc` / `rechargeDesc`：通过 `normalizeAmountFen(member.totalRecharge)` 按分为单位排序。
- `activeDesc`：按 `lastActiveAt`、`lastLoginAt`、`updatedAt`、消费/订单/交易时间、`createdAt` 的优先级取最近活跃时间。
- `registerDesc`：按 `createdAt` 倒序。

这样可以避免历史数据类型不一致或缺少复合索引导致的排序无效问题。

## 部署步骤

### 1. 部署 `admin` 云函数

在微信开发者工具中：

1. 打开项目。
2. 找到 `cloudfunctions/admin`。
3. 右键选择 **上传并部署：云端安装依赖**。
4. 等待部署成功。

也可以使用命令行部署，具体命令请以当前项目使用的云开发 CLI 配置为准，例如：

```bash
# 示例：使用 CloudBase CLI 部署 admin 云函数
cloudbase functions:deploy admin
```

> 注意：仅上传小程序代码不会更新云函数。排序逻辑在 `cloudfunctions/admin/index.js` 中，必须单独部署 `admin` 云函数。

### 2. 上传小程序代码

在微信开发者工具中：

1. 点击 **上传**。
2. 填写版本号与说明。
3. 上传包含 `miniprogram/subpackages/admin/members` 和 `miniprogram/services/api.js` 的最新小程序代码。

### 3. 验证排序

1. 进入 **管理员中心 → 会员列表**。
2. 点击“排序方式”，选择 **累计充值升序**。
3. 确认列表中的“累计充值”金额从小到大排列。
4. 选择 **累计充值降序**，确认金额从大到小排列。
5. 退出会员列表后再次进入，确认仍保留上次选择的排序方式。

## 运维提醒

- 当前排序为云函数内归一化排序，最多拉取符合条件的前 20,000 条会员记录后再分页，适合现阶段管理员后台使用。
- 如果会员规模超过 20,000，建议后续增加独立的规范化排序字段，例如 `totalRechargeSort`、`lastActiveAt`，并建立对应索引，再切回数据库层分页排序。
