# 管理员扣费与充值功能说明

## 管理员端

### 权限控制
- 扣费单与充值功能均通过云函数 `admin` 暴露，只有包含 `admin` 或 `developer` 角色的账户可以调用。
- 小程序首页仅在具备对应角色时展示“管理员”入口，新建的“创建扣费单”页面也沿用了该限制。

### 扣费流程
1. 在“创建扣费单”页面录入消费项目（名称、单价、数量），并可勾选“记为用餐”以便财务统计。
2. 前端会实时以“元”为单位计算订单合计金额，创建时转换为“分”保存，避免精度损失。
3. 调用 `admin.createChargeOrder` 云函数写入 `chargeOrders` 集合，生成 10 分钟有效期的待支付订单，返回格式化数据与扫码 payload（`member-charge:<orderId>`）。
4. 页面使用内置二维码工具绘制二维码画布，同时云函数会生成可在“微信扫一扫”中识别的小程序跳转链接（优先 Scheme，失败时降级为 URL Link），
   管理员可展示给会员扫描。
5. 管理端支持刷新订单状态，实时查看是否完成支付。

### 充值流程
- 管理员在会员资料页可通过“为该会员充值”按钮弹出金额输入框。
- 金额输入采用元，提交时转换为分，云函数 `admin.rechargeMember` 以事务形式：
  - 给会员账户余额累加。
  - 记录充值流水（`walletTransactions` 中 type=`recharge`，source=`admin`）。
- 成功后自动刷新会员信息，金额显示始终保持为元。

## 会员端

### 扫码扣费
1. 钱包页面新增“扫码扣费”按钮，调用微信扫码能力并解析 `member-charge:<orderId>` 文本。
2. 跳转至“确认消费”页面，调用 `wallet.loadChargeOrder` 获取订单明细、金额、灵石奖励以及有效期。
3. 会员确认后触发 `wallet.confirmChargeOrder`：
   - 事务校验余额（以分为单位），不足则抛错提示充值。
   - 扣减现金余额，按扣费金额的 100 倍（即等同于金额的分值）增加灵石。
   - 写入消费流水（`walletTransactions` type=`spend`，source=`chargeOrder`）与灵石流水（`stoneTransactions` type=`earn`）。
   - 更新扣费单状态为 `paid`，记录会员及完成时间。
4. 完成后返回钱包，用户余额与灵石均已刷新。

### 失败与过期处理
- 扫码后若订单已过期、已完成或被取消，前端会展示对应状态，确认按钮自动禁用。
- 云函数在确认时也会再次校验有效期并同步更新状态，避免并发问题。

## 数据模型
- `chargeOrders`
  - `status`: `pending | paid | cancelled | expired`
  - `items`: `{ name, price, quantity, amount, isDining }[]`（金额单位：分，`isDining` 用于财务统计）
  - `totalAmount`: 分
  - `stoneReward`: 默认等于 `totalAmount`
  - `diningAmount`: 勾选为用餐的项目合计（分，已按实际总额封顶）
  - `createdBy`, `memberId`, `createdAt`, `updatedAt`, `confirmedAt`, `expireAt`
- 流水表沿用原有集合，无需新增结构。

## 注意事项
- 管理员页面以及会员页面所有金额展示均为元（两位小数），存储及运算统一使用分。
- 扣费单默认 10 分钟有效期，如需调整可修改 `createChargeOrder` 中的 `expireAt` 计算。
- 二维码内容为简单文本，会员端解析时同时兼容 JSON 格式备用字段，方便未来扩展。
- 首次部署或升级到包含扣费功能的版本时，请重新执行一次 `bootstrap` 云函数，确保已经创建 `chargeOrders` 集合。
