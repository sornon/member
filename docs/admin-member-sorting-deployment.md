# 管理员会员列表排序部署说明

## 本次线上超时原因

线上报错 `FUNCTIONS_TIME_LIMIT_EXCEEDED` / `Invoking task timed out after 3 seconds` 的直接原因是：上一版为了规避历史数据排序不一致，把会员列表的非默认排序改成了“云函数内拉取大量会员后再排序”。在云函数默认 3 秒超时时间内，如果会员数较多、云函数冷启动、或同时还要执行 `count()` / `loadLevels()`，就会超时，导致会员列表打不开。

本次修复已移除大批量内存排序，恢复为数据库分页排序：

- `rechargeAsc`：按 `totalRecharge` 升序。
- `rechargeDesc`：按 `totalRecharge` 降序。
- `activeDesc`：按 `updatedAt` 降序。
- `registerDesc` / 默认排序：按 `createdAt` 降序。

为了降低索引依赖和查询耗时，排序查询只使用一个 `orderBy` 字段，不再叠加第二排序字段。

## 为什么之前会感觉排序没变化

需要同时确认以下两点：

1. **必须部署 `admin` 云函数**：排序逻辑在 `cloudfunctions/admin/index.js`。如果只上传小程序，不部署云函数，线上仍会使用旧逻辑。
2. **历史会员字段要规范**：数据库排序依赖原始字段。请确认：
   - `totalRecharge` 是数字，单位为分；
   - `createdAt` 是日期类型；
   - `updatedAt` 是日期类型，并且会员发生充值、资料修改等行为时会更新。

如果历史数据中存在字符串金额或缺失时间字段，排序会以云数据库实际字段为准，表现可能和页面格式化展示不完全一致。建议通过一次性数据清理脚本把历史字段规范为数字/日期类型。

## 部署步骤

### 1. 部署 `admin` 云函数

在微信开发者工具中：

1. 打开项目。
2. 找到 `cloudfunctions/admin`。
3. 右键选择 **上传并部署：云端安装依赖**。
4. 等待部署成功。

也可以使用当前项目配置的 CloudBase CLI 部署，例如：

```bash
cloudbase functions:deploy admin
```

> 注意：仅上传小程序代码不会更新云函数。修复超时和排序查询的代码在 `cloudfunctions/admin/index.js`，必须单独部署 `admin` 云函数。

### 2. 上传小程序代码

在微信开发者工具中：

1. 点击 **上传**。
2. 填写版本号与说明。
3. 上传包含 `miniprogram/subpackages/admin/members` 和 `miniprogram/services/api.js` 的最新小程序代码。

### 3. 验证

1. 打开 **管理员中心 → 会员列表**，确认不再出现 `FUNCTIONS_TIME_LIMIT_EXCEEDED`。
2. 选择 **累计充值升序**，确认列表按 `totalRecharge` 从小到大加载。
3. 选择 **累计充值降序**，确认列表按 `totalRecharge` 从大到小加载。
4. 选择 **最近活跃时间排序**，确认列表按 `updatedAt` 从新到旧加载。
5. 退出会员列表后再次进入，确认仍保留上次选择的排序方式。

## 数据与索引建议

为保证排序稳定、性能可控，建议在云数据库 `members` 集合中确认或创建以下普通索引：

| 排序方式 | 字段 | 方向 |
| --- | --- | --- |
| 默认/注册时间排序 | `createdAt` | 降序 |
| 累计充值升序/降序 | `totalRecharge` | 升序、降序 |
| 最近活跃时间排序 | `updatedAt` | 降序 |

如果后续会员规模继续增长，建议新增专用排序字段，例如 `lastActiveAt`，并在所有登录、消费、充值、资料修改等行为中统一更新该字段，再把“最近活跃时间排序”切换到 `lastActiveAt`。
