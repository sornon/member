# 砍价活动「答题奖励砍价次数」前后台一体化设计与实现

## 1. 目标
- 在前台 `bhk-price-card__perk` 区域底部增加“答题增加砍价次数”奖励项。
- 奖励项点击后弹出答题交互，答对奖励 1 次砍价机会。
- 题库由活动管理后台按活动配置（题目、选项、正确答案）。
- 后台可开启/关闭答题奖励；关闭时前台完全不显示该奖励项。
- 同一用户同一活动：
  - 答对后只奖励一次，不可重复领奖；
  - 答错可反复作答。

## 2. 数据结构设计
在 `activity.bargainSettings` 新增：

```json
{
  "quizReward": {
    "enabled": true,
    "question": "BHK56 属于哪一品牌系列？",
    "options": ["Cohiba", "Davidoff", "Montecristo", "Partagas"],
    "answerIndex": 0
  }
}
```

### 字段约束
- `enabled`: `boolean`。
- `question`: `string`，建议 1~120 字。
- `options`: `string[]`，2~6 项，每项非空。
- `answerIndex`: `number`，范围 `[0, options.length-1]`。

## 3. 前端交互
1. 前台读取 `bargainConfig.quizReward.enabled`，若为 `true`，在 perk 列表底部渲染“答题增加砍价次数（答对 +1 次）”。
2. 点击后通过 `ActionSheet` 显示选项。
3. 调用 `bargainQuizAnswer`：
   - 正确且首次：`remainingSpins +1`；
   - 正确但已领：提示“已答对，不重复奖励”；
   - 错误：提示“回答错误，请重试”，不发奖励。

## 4. 后端规则
- 新增云函数 action：`bargainQuizAnswer`。
- 读取活动配置的 `quizReward`。
- 使用会话字段 `quizRewarded` 做幂等控制：
  - `quizRewarded=true` 表示该用户该活动已领过答题奖励。
- 答错不改 `quizRewarded`，允许重复答题。

## 5. 后台配置设计
在活动管理后台（`activityType=bargain`）新增配置区：
- 答题奖励开关（开启/关闭）
- 题目输入框
- 选项文本框（每行一个）
- 正确答案序号（0-based）

保存时写入 `payload.bargainSettings.quizReward`。

## 6. 本次开发改动范围
- 云函数（活动）：增加答题 action + 奖励发放逻辑。
- 云函数（后台）：增加 `quizReward` 规范化。
- 管理后台页面：增加答题奖励配置 UI 与提交字段。
- 前台砍价页：增加奖励入口、答题触发与领奖刷新。

## 7. 部署步骤（详细）
1. **部署云函数 activities**
   - 微信开发者工具 -> 云开发 -> 云函数 -> `activities` -> 上传并部署（云端安装依赖）。
2. **部署云函数 admin**
   - 同上部署 `admin`。
3. **发布小程序前端代码**
   - 编译确认 `miniprogram/pages/activities/bhk-bargain` 与 `miniprogram/subpackages/admin/activities` 无报错。
   - 上传代码并提审/发布。
4. **后台配置验证**
   - 管理后台编辑某个砍价活动：开启答题奖励，配置题目/选项/答案并保存。
5. **前台功能验证**
   - 前台进入该活动，确认出现“答题增加砍价次数”。
   - 首次答对：剩余砍价次数 +1。
   - 再次答对：不重复增加。
   - 答错：可继续答题。
6. **关闭验证**
   - 后台关闭答题奖励并保存，前台刷新后该 perk 行不显示。

## 8. 风险与防护
- 配置不完整（少选项/答案越界）会导致无法答题：通过后台标准化与前台兜底提示减轻影响。
- 重复发奖风险：通过 `quizRewarded` 字段做后端幂等。
- 活动切换污染：答题奖励跟随活动 ID 与砍价会话隔离。
