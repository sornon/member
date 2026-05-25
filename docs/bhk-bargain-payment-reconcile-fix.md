# 砍价活动支付成功后未扣库存/未发权益/钱包流水异常排查与修复

## 问题现象
将 `bhkBargainRecords.currentPrice` 人工改成 `0.01` 后，在前台完成支付，出现：

1. 库存未减少（应 `-1`）
2. 权益中心未拿到「感恩节通行证」
3. 钱包流水只有 `+0.01`（充值），没有 `-0.01`（消费），现金余额反而增加

## 根因分析
前台砍价页支付链路是：

1. 先调用 `wallet.createRecharge` 发起微信支付（会产生一笔充值流水）
2. 支付成功后再调用 `activities.bargainConfirmPurchase` 做“购票确认”（扣库存、写消费流水、发权益）

问题点在于：

- 若第 2 步调用失败，前端旧逻辑会把部分失败当“成功兜底”处理（本地直接标记 `ticketOwned=true`），从而掩盖真实失败；
- 一旦失败被掩盖，后端不会执行扣库存/消费流水/权益发放；因此只剩下第 1 步充值流水 `+0.01`。

## 修复方案
已在前台 `miniprogram/pages/activities/bhk-bargain/index.js` 做以下修复：

1. **移除错误的本地成功兜底**：购票确认失败时不再本地伪造 `ticketOwned=true`。
2. **增加确认重试**：`bargainConfirmPurchase` 增加最多 3 次短间隔重试，降低短暂网络/云函数抖动导致的失败概率。
3. **失败显式报错**：重试后仍失败时明确提示“购票状态同步失败，请联系客服处理”，避免误判成功。

## 影响与收益
修复后，支付成功但确认失败将不会再被“伪成功”吞掉，能保证：

- 库存、权益、钱包消费流水三者与购票状态的一致性；
- 问题可观测、可追踪，便于客服和运维补偿处理。

## 部署方法
按以下顺序发布：

1. **发布小程序前端代码**
   - 重新编译并上传当前小程序版本。
   - 在微信公众平台提交体验版/正式版。

2. **（建议）同步发布 `activities`、`wallet` 云函数最新版本**
   - 云开发控制台中分别上传部署（云端安装依赖）。
   - 保证支付与购票确认链路代码一致。

3. **回归验证（建议测试环境先验）**
   - 进入砍价活动，完成一次支付。
   - 验证 `bhkBargainStock.stockRemaining` 减 1。
   - 验证 `bhkBargainRecords` 对应会话 `ticketOwned=true` 且有 `chargeOrderId`。
   - 验证钱包流水同时存在：
     - 充值 `+金额`
     - 消费 `-同金额`
   - 验证权益中心已出现「感恩节通行证」。

## 新增：活动权益改为可配置（不再固定“感恩节通行证”）

### 目标
- 砍价活动支付成功后，发放的权益名称/ID改为活动配置驱动，而非前端写死。

### 本次实现
1. `activities` 云函数扩展 `bargainConfig`：新增
   - `rewardRightEnabled`
   - `rewardRightId`
   - `rewardRightName`
   - `rewardRightDescription`
2. 活动运行时会从 `activity.bargainSettings` 读取上述字段并覆盖默认值。
3. 前台砍价页发权益逻辑改为读取 `bargainConfig.rewardRight*` 动态发放。
4. 后台 `admin` 云函数新增权益主数据 CRUD 接口：
   - `listRightsMaster`
   - `createRightsMaster`
   - `updateRightsMaster`
   - `deleteRightsMaster`

### 部署
- 需同步部署：
  - `cloudfunctions/activities`
  - `cloudfunctions/admin`
  - 小程序前端（至少 `miniprogram/pages/activities/bhk-bargain` 与 `miniprogram/services/api.js`）

## 复盘：权益管理页顶部导航多次未对齐的原因与最终修复

### 现象
- 页面顶部看起来像“没有左箭头圆形返回按钮”；
- 标题区域与系统胶囊/状态栏视觉冲突，造成“被遮挡”的观感。

### 根因复盘
1. **对 custom-nav 的复用不彻底**：页面内容区额外放了“权益模板管理 + 顶部按钮”独立卡片，视觉上抢占了首屏顶部主视觉，弱化了真正的 `custom-nav`。
2. **未严格遵循后台页面一致性规范**：后台页面统一模式应为“`custom-nav(theme=dark)` + 内容区卡片”；此前把页面级操作按钮放在了最顶部单独卡片中，形成了“第二导航”。
3. **实现偏差重复出现**：前几次只做了局部样式调整，没有先抽象出“要复用的是导航结构而非仅颜色”，导致反复偏离预期。

### 最终修复（本次）
1. 保持并复用后台统一导航：`<custom-nav title="权益管理" theme="dark" />`。
2. 移除顶部独立“权益模板管理”导航感卡片，避免与 custom-nav 竞争。
3. 将“+ 新建权益”动作收敛到“新增/编辑权益”卡片头部，回归后台页面信息层级。
4. 内容区继续使用后台统一 `page + section-block + block-header` 结构。

### 验收点
- 顶部返回交互由 custom-nav 左侧圆形半透明箭头统一提供；
- 首屏不再出现“第二导航”导致的错觉遮挡；
- 与活动管理、管理员中心保持一致的导航层级与交互节奏。

## 复盘补充：为何权益管理页始终没有圆形返回箭头

### 最终根因（已定位）
不是样式细节问题，而是 **页面缺失 `index.json` 的组件声明**：

- `subpackages/admin/rights-master/index.wxml` 虽然写了 `<custom-nav ... />`；
- 但该页面目录下没有 `index.json`，因此没有声明：
  - `custom-nav: /components/custom-nav/custom-nav`
  - `custom-nav-placeholder: /components/custom-nav-placeholder/custom-nav-placeholder`
- 结果是 WXML 中的 `custom-nav` 未被注册为组件，调试器里呈现为空节点（`<>`），导致：
  - 左侧圆形返回箭头不显示；
  - nav placeholder 不生效，内容没有顶部留白，视觉上被系统区遮挡。

### 这次为何反复出错（自我复盘）
1. 之前多次把问题误判为“页面样式层级/按钮摆放”，只改了 UI 结构，没有先验证组件是否真正挂载。
2. 没有第一时间对比同目录其他后台页的 `index.json` 组件声明，遗漏了最关键的注册步骤。
3. 缺少“开发者工具 WXML 结构验收”闭环：若看到 `<components/custom-nav/custom-nav>` 不存在，应立即回查 page json。

### 最终修复
- 新增 `miniprogram/subpackages/admin/rights-master/index.json`，完整复用后台页通用组件声明与占位配置。

### 验收标准
- 开发者工具 WXML 树出现 `<components/custom-nav/custom-nav>` 节点；
- 顶部显示统一的左箭头半透明圆形返回按钮；
- 内容区自动拥有 nav placeholder 顶部留白，不再贴顶遮挡。
