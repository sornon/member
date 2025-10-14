# 系统功能开关说明

系统功能开关存储在云开发数据库的 `systemSettings` 合集中，并复用 `feature_toggles` 文档。通过云函数 `bootstrap` 会确保该合集存在并预置默认数据，管理员端则通过 `admin` 云函数的 `getSystemFeatures` / `updateSystemFeature` 操作读取和更新该文档。

因此，为了支持收银台开关，无需新建新的合集，只需确保现有的 `systemSettings` 合集已经初始化即可。
