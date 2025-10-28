# 系统设置说明

系统设置集中存储在云开发数据库的 `systemSettings` 合集中，当前复用 `feature_toggles` 文档。通过云函数 `bootstrap`
会确保该合集存在并在首次部署时写入默认数据。管理员端页面通过 `admin` 云函数暴露的 `getSystemFeatures`、
`updateSystemFeature` 及 `updateImmortalTournamentSettings` 操作来读取和更新同一份文档。

## 默认结构

```jsonc
{
  "cashierEnabled": true,
  "immortalTournament": {
    "enabled": false,
    "registrationStart": "",
    "registrationEnd": ""
  },
  "cacheVersions": {
    "global": 1,
    "menu": 1
  },
  "homeEntries": {
    "activities": true,
    "mall": true,
    "secretRealm": false,
    "rights": true,
    "pvp": false,
    "trading": false
  },
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z"
}
```

> `createdAt` / `updatedAt` 字段由云函数自动维护，时间仅为示意。

## 配置项说明

- **cashierEnabled**：收银台快捷充值开关，保持原有逻辑不变。
- **immortalTournament**：仙界比武大会的集中配置，字段含义如下：
  - `enabled`：控制报名入口、战报展示等功能是否开放。
  - `registrationStart` / `registrationEnd`：报名窗口时间，字符串会直接同步至前台展示。
- **cacheVersions**：缓存版本号合集，管理员可在后台手动递增。
  - `global`：全局缓存版本。版本变化时会员端会清空本地存储（含点餐缓存、导航折叠状态等）并写入最新版本号。
  - `menu`：点餐菜单缓存版本。版本不一致时会员端会丢弃缓存的菜单及购物车并重新拉取。
- **homeEntries**：会员端首页入口开关，控制快捷入口的展示与隐藏。
  - `activities`：活动聚合入口，默认开启。
  - `mall`：线上商城入口，默认开启。
  - `secretRealm`：秘境挑战入口，默认关闭。
  - `rights`：会员权益专区入口，默认开启。
  - `pvp`：仙界比武大会入口，默认关闭。
  - `trading`：交易行入口，默认关闭。

管理员页面新增“缓存管理”模块，分别提供“刷新全局”“刷新菜单”两种操作。点击后会触发 `bumpCacheVersion`
动作，将对应的版本号加一。会员首页会在每次启动时优先校验 `cacheVersions` 并按需清理本地缓存，点餐页也会在
加载前确认 `menu` 版本，从而避免重复请求菜单数据。

管理员页面提供显式的“保存大会设置”按钮，调整报名窗口后需手动保存，云端函数会自动清理冗余字段。
如需新增配置项，优先在 `DEFAULT_IMMORTAL_TOURNAMENT` 中声明默认值，再在前端表单中增加对应字段即可。

### 比武大会数据重置

为便于测试或处理异常数据，系统设置页额外提供“重置当前届”“重置所有届”两项操作，对应云函数动作
`resetImmortalTournament`：

- **重置当前届**：清除该届的 `pvpMatches`、`pvpInvites`、`pvpLeaderboard` 数据，并移除 `pvpProfiles` 中对应赛季的参赛者
  档案，保证天梯榜单即时清空。赛季文档会重新标记为进行中，并刷新起止时间。旧赛季历史保留。
- **重置所有届**：移除所有 PVP 相关集合（赛季、战报、榜单、邀战、赛季档案）的数据，下一次会员进入比武入口时
  会自动从第一届重新开始。

操作执行前会弹出确认弹窗，请管理员谨慎使用。
