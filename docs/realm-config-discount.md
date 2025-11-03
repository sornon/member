# Realm Config `discount` 字段说明

`common-config/index.js` 中的 `realmConfigs` 为每个境界阶段提供了一组静态配置，其中的 `discount` 字段用于描述该境界的消费折扣（例如 0.98 代表 98 折）。在系统中，这个字段主要承担以下职责：

- **写入会员等级文档**：引导脚本在执行 `cloudfunctions/bootstrap/index.js` 的 `buildMembershipLevels()` 时，会把每个境界的 `discount` 数值同步到生成的等级记录里，存储在 `membershipLevels` 集合的 `discount` 字段中，供后续查询使用。 【F:cloudfunctions/bootstrap/index.js†L168-L224】
- **向客户端透出**：会员云函数的 `getProgress` 接口会将等级列表中的 `discount` 原样返回，让小程序前端能够展示各等级对应的折扣信息。 【F:cloudfunctions/member/index.js†L1347-L1399】

目前仓库中没有找到直接按照该折扣自动计算消费价格的实现，实际结算时仍以优惠券、饮品券等权益为主要扣减手段。换句话说，`discount` 主要起到存档与展示的作用，为未来可能的折扣计算预留了配置入口。 【F:cloudfunctions/nodejs-layer/node_modules/common-config/index.js†L349-L421】【F:cloudfunctions/menuOrder/index.js†L120-L209】【F:cloudfunctions/wallet/index.js†L1465-L1491】
