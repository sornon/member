# 砍价活动类型抽象设计（感恩节 + 音乐会）

## 目标
- 将「感恩节砍价活动」与「音乐会砍价活动」统一为同一活动类型：`bargain`。
- 在后台活动管理中支持该类型的配置，不再依赖纯文案型基础活动。
- 音乐会默认配置：
  - 盈利模式：门票售卖（`ticketingMode=paid-ticket`）
  - 基础金额：`1500`
  - 最低价：`998`
  - 分享后获得砍价次数：`shareRewardAttempts=1`

## 数据模型
活动新增以下字段：
- `activityType`: `standard | bargain`
- `activityTemplate`: `'' | thanksgiving-bargain | concert-bargain`
- `bargainSettings`（仅 `activityType=bargain` 时有效）
  - `startPrice`
  - `floorPrice`
  - `shareRewardAttempts`
  - `ticketingMode`（固定 `paid-ticket`）

当活动不是砍价类型时，`bargainSettings` 会被置为 `null`。

## 后端实现
文件：`cloudfunctions/admin/index.js`
- `normalizeActivityPayload` 新增上述字段归一化。
- 新增：
  - `normalizeActivityType`
  - `normalizeActivityTemplate`
  - `normalizeBargainSettings`
- `decorateActivityRecord` 将新字段透传到管理端。

这样保证：
1. 后台新建活动即可配置类型。
2. 历史活动（不带新字段）自动回落为 `standard`，无兼容性风险。
3. 音乐会可直接复用感恩节砍价玩法配置结构。

## 管理端改造
文件：`miniprogram/subpackages/admin/activities/index.js` + `index.wxml`
- 列表卡片增加活动类型展示（通用 / 砍价）。
- 编辑器新增“活动类型”选择器。
- 选择 `bargain` 后显示：
  - 活动模板
  - 基础金额
  - 最低价
  - 分享奖励次数
- 提交时将配置写入 `payload.bargainSettings`。

## 使用建议（音乐会活动）
后台创建活动时建议填写：
- 活动类型：`砍价活动`
- 活动模板：`concert-bargain`
- 基础金额：`1500`
- 最低价：`998`
- 分享奖励次数：`1`
- 方案/价格文案：建议明确“门票售卖”属性，避免和储值类活动混淆。

## 后续扩展
当前实现先完成“类型抽象 + 可配置化”。
后续可继续在 `cloudfunctions/activities` 中按 `activityType/bargainSettings` 动态生成砍价规则，实现完全去硬编码化（替代仅按固定活动 ID 返回砍价配置）。

## 部署配置与发布步骤（本次更新重点）

### 1) 云函数部署（手动）
1. 打开微信开发者工具，切换到当前云环境（建议先在测试环境验证）。
2. 右键 `cloudfunctions/admin` → **上传并部署：云端安装依赖（不上传 node_modules）**。
3. 再右键 `cloudfunctions/activities` → **上传并部署：云端安装依赖**（本次前台按 `activityType=bargain` 进入砍价页，需要同步上线）。
4. 部署完成后，在云开发控制台「云函数」页确认两个函数版本时间均为本次发布时间。

### 2) 小程序端部署（手动）
1. 在微信开发者工具执行「工具 → 构建 npm」（如项目启用了 npm 依赖）。
2. 执行「上传」，填写版本号（例如 `activity-bargain-concert-20260521`）与更新说明。
3. 在微信公众平台提交审核/发布，并在发布完成后确认线上版本号。
4. 管理员端进入小程序后先执行一次「清缓存并重启」，避免分包缓存导致旧活动编辑器未刷新。

### 2.1 创建“音乐会砍价活动”操作步骤（手动）
1. 管理后台 → 活动管理 → 新建活动。
2. 活动类型选择 **砍价活动（感恩节/音乐会）**。
3. 填写 `activityTemplate=concert-bargain`。
4. 砍价参数填写：
   - 基础金额 `1500`
   - 最低价 `998`
   - 分享奖励次数 `1`
5. 填写头图（`coverImage`）与活动文案（标题、tagline、礼遇、说明）。
6. 发布后到前台活动列表点击该活动，确认进入砍价活动页并正确显示新头图/文案。

### 3) 数据库与兼容策略
- 集合：沿用既有 `activities` 集合，无需新增集合。
- 历史数据兼容：
  - 未包含 `activityType` 的旧活动默认按 `standard` 处理。
  - `activityType !== bargain` 时，`bargainSettings` 统一回写/透出为 `null`。
  - **老版本管理端仅更新基础字段时**：不会覆盖新字段（`activityType/activityTemplate/bargainSettings`），避免误清空新配置。
  - **仅提交 `activityType=standard` 的场景**：后端会自动清空 `bargainSettings`，避免遗留脏配置。
  - **仅提交 `bargainSettings` 的场景**：后端自动推断为 `activityType=bargain`，避免类型与配置不一致。
- 运营创建“音乐会砍价”活动建议字段：
  - `activityType=bargain`
  - `activityTemplate=concert-bargain`
  - `bargainSettings.startPrice=1500`
  - `bargainSettings.floorPrice=998`
  - `bargainSettings.shareRewardAttempts=1`
  - `bargainSettings.ticketingMode=paid-ticket`（后端固定）

### 4) 发布后验收清单（建议逐项执行）
1. 进入管理后台 → 活动管理 → 新建活动，确认出现“活动类型”选择器。
2. 选择“砍价活动（感恩节/音乐会）”后，确认出现：
   - 活动模板
   - 基础金额
   - 最低价
   - 分享奖励次数
3. 保存后再次进入编辑，确认上述值可正确回显。
4. 返回活动列表，确认卡片出现“类型：砍价活动”。
5. 抽检数据库对应活动文档，确认新字段结构正确（尤其 `bargainSettings`）。

### 5) 回滚方案
- 若线上出现兼容问题，可临时将新建活动改回 `activityType=standard`，不影响原有活动基础信息创建流程。
- 紧急回滚代码时，只需回滚 `admin` 云函数与管理端分包；数据库中新增字段为向后兼容字段，不会阻塞旧版读取。

## 风险评估（开发/线上同云环境）

结论：**可以安全实现**，但需要遵循发布顺序和字段兼容策略。

### 可控风险
1. **先发云函数、后发前端**：旧版前端不认识新字段，但不会报错；新版后端对缺失字段有默认值和保留策略。
2. **新旧管理端并存编辑同一活动**：旧版编辑仅更新基础字段，不会覆盖砍价字段；新版编辑可完整读写新字段。
3. **历史活动文档无新字段**：后端会回落默认类型，不需要做全量数据迁移。

### 需注意的风险点
1. 若业务前台后续要“按活动动态跑砍价规则”，当前 `cloudfunctions/activities` 仍有一部分基于固定活动 ID 的逻辑，需再做动态化改造后再启用。
2. 同云环境下请避免“只回滚前端、不回滚云函数 schema 约束”的长时间分裂状态，建议按发布窗口统一升级。

## 问题复盘：音乐会配置为 `concert-bargain` 后前台未进入完整砍价玩法

### 现象
- 运营已完成活动配置（`activityType=bargain` + `activityTemplate=concert-bargain`），但会员从前台活动列表进入后，未呈现与感恩节活动一致的完整砍价页能力。

### 根因分析
1. **活动列表入口已按类型跳转，但云函数仍按“固定感恩节活动 ID”执行业务**。  
   砍价云函数原逻辑在会话键、库存键、配置读取、活动透出等环节大量使用 `BHK_BARGAIN_ACTIVITY_ID` 常量，导致新活动即使进入砍价页，也会落到旧活动上下文。
2. **砍价配置未按活动文档动态读取**。  
   `startPrice/floorPrice/heroImage/endTime` 等没有从当前活动的 `bargainSettings/coverImage` 读取，音乐会活动配置无法生效。

### 修复方案（已开发）
1. `cloudfunctions/activities` 新增活动运行时解析：按 `event.id` 读取活动文档；仅当 `status=published && activityType=bargain` 时进入砍价流程。
2. 会话与库存主键改为“按活动隔离”：  
   - 砍价会话：`${activityId}_${openid}`  
   - 库存文档：`doc(activityId)`
3. 砍价配置改为“活动优先”：优先使用活动文档中的 `bargainSettings.startPrice/floorPrice`、`coverImage`、`endTime`，未配置再回落默认值。
4. 返回 payload 中的 `activity` 改为当前活动文档，确保音乐会文案与头图正确透出。

### 手动部署补充（本次修复必须执行）
1. **重新部署 `cloudfunctions/activities`（必须）**：本次问题核心在该函数，若不重发，前台仍会命中旧 ID 逻辑。
2. 建议同时重新上传小程序并发布，确保前台页面与最新云函数参数约定一致。
3. 发布后验收：
   - 新建/编辑音乐会活动，确认 `activityType=bargain`、`activityTemplate=concert-bargain`、`1500/998/1` 已保存。
   - 前台活动列表进入该活动后，检查标题、头图、价格初始值、最低价是否与音乐会配置一致。
   - 数据库检查 `bhkBargainRecords` 新增记录键是否为 `${音乐会活动ID}_${openid}`，`bhkBargainStock` 是否使用音乐会活动 ID 作为文档键。


## Concert 模版新增：答题奖励砍价次数（可开关）
- 新增 `bargainConfig.quiz.enabled` 开关：
  - `true`：启用答题玩法，需配置题目。
  - `false`：关闭答题玩法，无需配置题目。
- 新增 `bargainConfig.quiz.rewardAttempts`：每题答对奖励次数（默认 1）。
- 新增 `bargainConfig.quiz.questions[]`：`id/question/options/answer/tip`。
- 交互规则：无论用户答对或答错，前端都显示“正确答案 + Tips”；仅答对时增加砍价次数。

### 小白部署步骤（一步一步）
1. 打开微信开发者工具，导入项目。
2. 右键上传并部署云函数 `cloudfunctions/activities`（必须勾选“云端安装依赖”）。
3. 编译小程序，确认活动页可见“答题加砍价次数”模块。
4. 在管理端把活动模板设置为 `concert-bargain` 并发布活动。
5. 若不想用答题玩法，将 `quiz.enabled` 设为 `false` 后重新部署云函数即可。


## 故障修复：活动页黑屏（Unexpected token 265:4）

### 现象
- 打开 `pages/activities/bhk-bargain/index` 后黑屏。
- 控制台报错：`Unexpected token, expected "," (265:4)`。

### 根因
- `miniprogram/pages/activities/bhk-bargain/index.js` 的 `data` 对象中，`quizResultMessage` 后缺少逗号，导致 JS 语法错误，页面模块加载失败。

### 修复内容
- 在 `quizResultMessage: ''` 后补上逗号，恢复对象字面量语法正确性。

### 小白部署步骤（修复黑屏）
1. 打开微信开发者工具并拉取最新代码。
2. 确认文件 `miniprogram/pages/activities/bhk-bargain/index.js` 中 `quizResultMessage` 后有逗号。
3. 在微信开发者工具点击 **编译**，确认不再出现 `Unexpected token`。
4. 右键云函数 `cloudfunctions/activities`，选择 **上传并部署：云端安装依赖**。
5. 点击小程序 **上传**，填写版本号和“修复活动页黑屏”说明，提交审核/发布。
6. 发布后用测试账号进入活动 `-test`，确认页面可正常打开。

### 验收清单
- 页面可打开，不再白屏/黑屏。
- 控制台无 `Unexpected token` 报错。
- “答题奖励开关”为滑动开关，关闭时不显示答题模块。


## 活动-test 无答题入口排查与部署

### 常见原因
1. 前端未更新到含答题入口的新版本。
2. `cloudfunctions/activities` 未部署到最新，返回 payload 不含 quiz。
3. 活动配置中关闭了“答题奖励开关”（`quizEnabled=false`）。

### 正确部署顺序（必须按顺序）
1. 微信开发者工具右键部署 `cloudfunctions/admin`（云端安装依赖）。
2. 微信开发者工具右键部署 `cloudfunctions/activities`（云端安装依赖）。
3. 重新编译小程序，确认活动页出现“答题加砍价次数”模块。
4. 在管理员中心-活动管理-test：
   - 选择砍价活动模板；
   - 打开“答题奖励开关”；
   - 填写题目、A/B/C 选项、正确答案，Tips 可不填；
   - 保存并发布。
5. 前台重新进入活动-test验证：应出现答题入口；提交后显示正确答案与 tips。

### 本次兼容兜底
- 当前端检测到 `quizEnabled=true` 但题目为空时，会显示“题库未配置，请联系管理员”。
- 同时前端会回落默认三道题，避免仅显示规则却无入口。


### 若部署后仍无答题入口（重点）
- 需确认前端 `applySession` 已把 `bargain.quiz` 写入页面 `data.quiz`。
- 如果漏写该字段，会出现“规则里有答题奖励，但页面不渲染答题入口”的现象。

#### 重新部署步骤（含缓存处理）
1. 部署 `cloudfunctions/activities`（云端安装依赖）。
2. 上传并发布小程序版本。
3. 在微信开发者工具点“清缓存并编译”；真机端退出小程序后重进。
4. 管理端确认对应活动：`activityType=bargain` 且 `quizEnabled=true`。
5. 再进入 `活动-test` 页面，检查是否出现“答题加砍价次数”模块。


### 提交答案报错 `ensureBhkBargainSession is not defined` 的修复部署

该错误说明线上 `cloudfunctions/activities` 仍在旧代码分支，`bargainQuizAnswer` 内调用了不存在的方法。

**修复后代码行为**：改为调用现有方法 `getOrCreateBargainSession(config, { openid, activityId })`。

**请按以下步骤重新部署：**
1. 微信开发者工具右键 `cloudfunctions/activities`。
2. 选择 **上传并部署：云端安装依赖**。
3. 等待部署成功后，在云函数日志确认最新发布时间。
4. 小程序端“清缓存并编译”，真机退出后重进。
5. 重新进入 `活动-test`，点击答题提交验证。

若仍报错，请截图云函数日志中的 `callId` 和最新 `errMsg`。


## 答题玩法与排行榜部署步骤（务必按顺序）

### 一、部署云函数
1. 在微信开发者工具中，右键 `cloudfunctions/admin` → **上传并部署：云端安装依赖**。
2. 右键 `cloudfunctions/activities` → **上传并部署：云端安装依赖**。
3. 确认两者部署时间为最新，避免前后端协议不一致。

### 二、上传小程序前端
1. 编译小程序，确认页面无报错。
2. 点击“上传”，填写版本号与说明（建议写明“答题弹窗/排行榜发布”）。
3. 提交审核并发布正式版（如仅测试可先在体验版验证）。

### 三、管理端配置活动
1. 进入 **管理员中心-活动管理-test**。
2. 选择活动类型为 `bargain`，模板为 `concert-bargain`。
3. 打开“答题奖励开关”。
4. 填写题目、A/B/C 选项、正确答案，Tips 可为空。
5. 保存并发布活动。

### 四、验证清单
1. 前台活动页出现“去答题”按钮。
2. 点击后弹出题目弹窗，一次显示一道题。
3. 选项可高亮；提交后在弹窗内显示“正确答案 + Tips”。
4. 答错后再次点击“去答题”会进入下一题。
5. 页面出现“答题排行榜（Top10）”，并只展示前 10 名的答对次数。

### 五、常见问题排查
- 若看不到答题入口：
  - 检查 `quizEnabled` 是否开启；
  - 清缓存并重新编译；
  - 确认 `cloudfunctions/activities` 已部署到最新。
- 若提交答案报云函数错误：
  - 到云函数日志按 `callId` 排查；
  - 再次部署 `cloudfunctions/activities`（云端安装依赖）。


### 报错修复：`quizRanking is not defined`（小白版）
如果你在活动页看到以下报错：
- `ReferenceError: quizRanking is not defined`

说明云函数 `activities` 版本不是最新，或线上代码里 `buildBargainPayload` 没有正确传入排行榜数据。

#### 一步一步修复
1. 打开微信开发者工具。
2. 找到 `cloudfunctions/activities`。
3. 右键选择 **上传并部署：云端安装依赖**。
4. 等待部署成功后，打开云函数日志确认最新时间。
5. 小程序端点击 **清缓存并编译**。
6. 真机上完全退出小程序，再重新进入 `活动-test`。

#### 验证点
- 页面可正常打开，不再出现 `quizRanking is not defined`。
- “答题排行榜（Top10）”可以正常显示（至少空列表不报错）。


### 排行榜不显示的修复与部署（小白版）
**现象**：活动页没有“答题排行榜（Top10）”，或一闪而过后消失。

**根因**：前端 `applySession` 每次刷新会把 `quizRanking` 清空。

**修复后行为**：
- 若接口返回排行榜，前端会用接口数据更新；
- 若本次接口未返回排行榜，前端保留当前榜单，不再清空。

**部署步骤**：
1. 更新小程序代码后重新编译。
2. 上传小程序版本。
3. 清缓存并重新进入活动页。
4. 若仍无榜单，确认至少有 1 条答题正确记录（榜单仅显示前10且空数据不展示）。


### 排行榜仍不显示（最终排查）
如果你确认有人答对过题，但排行榜仍不显示，最常见原因是云数据库索引问题：
- 旧代码按 `correctCount + updatedAt` 双字段排序，在部分环境会因为缺少复合索引导致查询失败。
- 失败后前端拿到空数组，所以页面不显示榜单。

本次已改为仅按 `correctCount` 排序，避免依赖复合索引。

**部署步骤（小白版）**
1. 右键部署 `cloudfunctions/activities`（云端安装依赖）。
2. 开发者工具“清缓存并编译”。
3. 真机退出小程序后重新进入活动页。
4. 至少用一个账号答对1题，再返回页面查看排行榜。

**若仍不显示**
- 打开云函数日志，搜索关键字：`[bargain-quiz-rank] list failed`。
- 若出现该日志，请把完整错误截图发我（通常是权限或集合字段类型异常）。


### 活动-test 排行榜仍不显示（本次最终修复）
本次前端新增了“双保险”：
1. 提交答案后，如果接口没立即返回排行榜，会自动再请求一次 `bargainStatus` 拉取榜单。
2. 关闭答题弹窗时也会自动刷新一次榜单。

同时页面会固定显示“答题排行榜（Top10）”区域：
- 有数据就显示前10名；
- 没数据就显示“暂无排行榜数据，先答对1题后再返回查看”。

#### 小白部署步骤
1. 部署云函数 `cloudfunctions/activities`（云端安装依赖）。
2. 上传小程序前端版本。
3. 开发者工具点击“清缓存并编译”。
4. 真机完全退出小程序后重新进入 `活动-test`。
5. 先答对1题，点击“我知道了”关闭弹窗，观察排行榜是否刷新。


### 答对1题后排行榜仍无排名（已修复）
**问题原因**：云数据库在极短时间内可能出现“写入后立即查询未可见”的情况，导致刚答对后榜单仍为空。

**修复方式**：
- 后端在答题成功后，若Top10查询暂时没查到当前用户，会把当前用户的最新答对次数补入返回榜单（临时兜底），确保页面立刻看到排名。

**小白部署步骤**：
1. 右键部署 `cloudfunctions/activities`（选择“云端安装依赖”）。
2. 等部署成功后，重新编译小程序并上传。
3. 清缓存后进入 `活动-test`。
4. 答对1题，关闭弹窗后查看“答题排行榜（Top10）”，应立即出现排名。


### 新规则：题目答完后提示“暂无更多题目”
- 前端现在会读取会话里的 `quizAnsweredIds`。
- 点击“去答题”时仅弹出“未答过”的题目。
- 若全部题目都已答过，会弹窗提示：`暂无更多题目`。

#### 部署步骤（小白版）
1. 上传并部署 `cloudfunctions/activities`（云端安装依赖）。
2. 上传小程序前端代码。
3. 开发者工具点击“清缓存并编译”。
4. 真机退出小程序后重进 `活动-test`。
5. 连续答题直到题目用尽，确认出现“暂无更多题目”提示。


### 修复：答题后弹窗自动关闭、再次仍是第一题
**问题原因**：
1. 页面刷新会话时把弹窗状态重置，导致提交后弹窗被关掉。
2. 答题完成到云端状态同步有延迟，前端若立即刷新，可能短暂拿到旧 `quizAnsweredIds`，从而又出现第一题。

**修复点**：
- 提交答案后，前端在 `applySession` 时强制保留弹窗和答题结果。
- 本地先合并当前题目到 `quizAnsweredIds`，避免短暂回读旧数据导致重复第一题。

**小白部署步骤**：
1. 上传并部署 `cloudfunctions/activities`（云端安装依赖）。
2. 上传小程序前端。
3. 清缓存并编译。
4. 真机退出小程序后重进 `活动-test`。
5. 验证：
   - 提交答案后弹窗不自动关闭，题目下方显示正确答案和Tips；
   - 关闭弹窗后再点“去答题”，会进入下一道题；
   - 全部题做完后提示“暂无更多题目”。


### 报错修复：`ReferenceError: extras is not defined`
**现象**：活动页加载时报错，提示：`normalizeSession` 内 `extras is not defined`。

**根因**：`normalizeSession(session, bargain)` 这个函数没有 `extras` 参数，但代码误用了 `extras.quizAnsweredIds`。

**修复**：改为仅使用 `session.quizAnsweredIds`（无则回退页面已有数据）。

#### 小白部署步骤
1. 上传小程序前端代码（`miniprogram/pages/activities/bhk-bargain/index.js`）。
2. 开发者工具点击“清缓存并编译”。
3. 真机退出小程序后重进 `活动-test`。
4. 观察控制台不再出现 `extras is not defined`。
