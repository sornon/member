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
  "equipmentEnhancement": {
    "maxLevel": 10,
    "guaranteedLevel": 3,
    "decayPerLevel": 10
  },
  "globalBackground": {
    "enabled": false,
    "backgroundId": "",
    "animated": false
  },
  "globalBackgroundCatalog": [],
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
- **equipmentEnhancement**：装备强化参数，供前后台共用。
  - `maxLevel`：强化等级上限，会员端会将达到上限的装备标记为不可强化。
  - `guaranteedLevel`：在该等级及以下强化必定成功。
  - `decayPerLevel`：超过保底等级后，每提升 1 级成功率衰减的百分比（例如 10 表示逐级 -10%）。
- **globalBackground**：全局背景开关，控制所有会员首页背景是否被统一覆盖。
  - `enabled`：开启后所有会员的背景强制跟随后台选中的素材，关闭时恢复个人自选背景。
  - `backgroundId`：背景素材编号，仅可引用 `globalBackgroundCatalog` 中的自定义素材；后台会在保存时自动校验，若素材缺失会回退到列表首项或禁用全局背景。
  - `animated`：是否同步启用动态背景效果，仅当素材本身包含视频时生效。
- **globalBackgroundCatalog**：管理员自定义的全局背景素材列表，包含 `id`、`name`、`mediaKey` 等字段，可选 `videoFile`、`realmName` 等描述信息。仅在该列表中的素材可以在后台页面选中并应用于全局背景，保存后会同步至会员端和战斗模块。

管理员页面的“全局背景”卡片提供启用开关、动态背景切换与背景列表预览。选择新的背景后会立即持久化到云端，
会员端下次刷新首页时会加载统一的图像/视频资源；管理员关闭开关后，会员将重新使用个人资料中保存的背景。

管理员页面同时新增“装备强化配置”卡片，展示当前的上限、保底等级与衰减系数。管理员调整参数后点击保存，即会调用 `updateEquipmentEnhancement` 接口同步到云端，会员端强化面板会在下一次打开时自动应用最新的配置。【F:miniprogram/pages/admin/system-switches/index.wxml†L160-L220】【F:miniprogram/pages/admin/system-switches/index.js†L600-L820】

### 全局背景管理操作指南

1. 登录管理员系统，进入“系统设置 → 全局背景”卡片，点击“管理背景”按钮新增或删除素材。新增时仅需填写展示名称与资源文件名（位于 `/assets/background/`，无需后缀），规则与会员资料页的自定义背景一致。
2. 保存后，素材列表会出现在背景网格中。点击任意卡片即可预览效果并查看对应文件名、视频资源等信息。
3. 若素材支持动态背景，可在“动态背景”开关处启用或关闭视频效果。
4. 打开“启用全局背景”开关后，所有会员的首页背景与动态效果将被强制同步为选定素材。
5. 如需恢复会员自定义背景，可关闭“启用全局背景”开关；关闭后会员端会重新读取各自保存的背景设置。

> 小提示：全局背景生效后，会员端的外观编辑弹窗会锁定背景相关控件，仅允许查看当前覆盖信息。

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
