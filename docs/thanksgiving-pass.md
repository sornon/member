# 感恩节通行证发售上线说明

## 功能概览
- 全局席位库存存储在 `bhkBargainStock` 集合，支付确认后自动减库存，减至 0 后前端会禁用购票按钮并提示售罄。
- 支付后调用 `activities` 云函数的 `bargainConfirmPurchase` 动作，持久化会员的购票状态（`ticketOwned`/`purchasedAt`），避免重复购票。
- 云端会同步校验会员权益：若已发放 `thanksgiving-pass` 权益，活动页自动识别已购状态，锁定按钮并展示“已获得通行证”。
- 会员档案奖励：进入活动页时会检测昵称非空且头像不为默认占位图（`avatar/default.png`），满足条件即可获赠 1 次额外砍价机会并写入 `thanksgivingProfileRewarded` 标记，防止重复发放。

## 部署步骤
1. 重新部署 `cloudfunctions/activities`：确保新建 `bhkBargainStock` 集合权限默认即可，云函数发布后会自动初始化库存文档。
2. 若此前未发放过权益，请一并部署 `cloudfunctions/member`，以使用 `grantRight` 动作写入感恩节通行证。
3. 若自定义过头像占位图，请确认云存储路径仍为 `avatar/default.png` 并与云函数中的 `DEFAULT_AVATAR` 一致，否则档案奖励的“默认头像”判定会失效；更换路径时请同步更新云函数常量后重新发布。
4. 小程序端重新构建并上传，确保 `miniprogram/pages/activities/bhk-bargain` 与 `miniprogram/services/api.js` 的最新支付确认流程生效。
5. 部署后可在数据库查看 `bhkBargainStock` 与 `bhkBargainRecords`：确认库存递减、`ticketOwned`/`purchasedAt` 字段更新正常；新增的 `thanksgivingProfileRewarded` 为 `true` 时表示档案奖励已落地；在“我的权益”中应能看到“感恩节通行证”。

### 近期修复
- 解决支付成功后首次回调可能出现“购票信息缺失”报错的问题：`bargainConfirmPurchase` 现在会在事务中补写缺失的砍价会话文档，再扣减库存并落地购票状态，避免页面刷新前的报错；原有库存扣减与防重复购票逻辑保持不变。
- 修复 `bhkBargainStock` 集合未落库导致库存始终显示 15 的问题：云函数现在会强制初始化库存文档并在事务内校验写入结果，再进行扣减，确保购票后库存实时减少且集合能看到数据。
- 修复进入活动页触发 `bargainGetActivity`/`bargainConfirmPurchase` 时出现 “document.set:fail -501007 invalid parameters. 不能更新_id的值” 的报错：初始化库存文档时不再携带 `_id` 字段，由集合 `doc()` 指定主键，避免云函数误判为更新 `_id`；部署 `activities` 云函数后即可生效，无需清理数据。
- 修复支付成功后因砍价会话写入 `_id` 导致的 `_id` 更新报错与库存不扣减：支付确认事务写库时去掉 `_id` 字段并使用 `doc()` 主键写入，支付成功后库存应立刻减少且不再出现报错。
- 感恩节活动总席位展示改为读取 `bhkBargainStock.totalStock`，活动页标题、副标题与规则说明都将显示数据库中的总库存，避免固定 15 席的误导。


## 体验校验
- 支付成功后刷新活动页，顶部卡片应显示斜体水印“已获得通行证”，并在地点下方出现“门票购买成功，请在权益中查看”链接。
- 重复进入活动页或重新发起支付时，应提示已购且按钮禁用；当库存为 0 时全体用户都不可支付。
