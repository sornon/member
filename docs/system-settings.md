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
    "registrationEnd": "",
    "maxParticipants": 64,
    "ruleLink": "",
    "announcement": ""
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
  - `maxParticipants`：参赛人数上限，云端会自动限制在 2~512 之间。
  - `ruleLink`：外部图文或活动详情地址，供会员端跳转查看。
  - `announcement`：活动公告与奖励说明文本，支持多行内容。

管理员页面在表单失焦时即会调用 `updateImmortalTournamentSettings` 进行持久化，云端函数会自动清理冗余字段并保
证数值范围合法。如需新增配置项，优先在 `DEFAULT_IMMORTAL_TOURNAMENT` 中声明默认值，再在前端表单中增加对应
字段即可。
