# 砍价活动答题奖励（+1 次砍价）设计、实现与部署说明

## 目标
- 前台在 `bhk-price-card__perk` 最下方新增“答题增加砍价次数”入口。
- 后台可配置开关、题目、选项、答案（单选题）。
- 答对后奖励 1 次砍价，且同一用户同一活动仅能领取一次；答错可重复作答。

## 数据结构（activity.bargainSettings）
新增：
```json
"quizReward": {
  "enabled": true,
  "question": "BHK56 品鉴会主打哪一类体验？",
  "options": ["雪茄品鉴", "高尔夫", "马术"],
  "answerIndex": 0
}
```

## 前台交互
1. 当 `quizReward.enabled=true` 且配置合法时，`bhk-price-card__perks` 末尾显示答题奖励项。
2. 点击后弹出选项面板。
3. 选择答案后调用 `bargainAnswerQuiz`：
   - 正确且未奖励：`remainingSpins +1`，提示“回答正确，已+1次砍价”。
   - 正确但已奖励：不重复奖励。
   - 错误：提示“回答错误，可重试”，不封禁重复答题。

## 后端规则
- 新增云函数 action: `bargainAnswerQuiz`。
- 在 `bargainStatus` 返回中附带 `quizReward`（不下发正确答案）。
- 事务内校验并更新会话记录 `bhkBargainRecords`：
  - 记录 `quizRewarded=true` 防重复奖励。

## 管理后台
- 砍价活动编辑表单新增：
  - 答题奖励开关；
  - 题目；
  - 选项（每行一项）；
  - 正确答案下标（从 0 开始）。

## 部署步骤（详细）
1. 云函数部署：上传并部署 `cloudfunctions/activities`（云端安装依赖）。
2. 小程序代码上传：确保 `miniprogram/pages/activities/bhk-bargain`、`miniprogram/services/api.js`、`miniprogram/subpackages/admin/activities` 已更新。
3. 管理后台发布：进入活动管理，编辑砍价活动并开启答题奖励，填写题目/选项/答案。
4. 验证：
   - 前台出现“答题奖励”行；
   - 首次答对后砍价次数 +1；
   - 再次答对不再增加；
   - 答错可重复作答。

## 回滚方案
- 后台将 `quizReward.enabled` 改为 `false`，前台入口立即隐藏；
- 如需彻底回滚代码，回退本次版本并重新部署云函数与小程序。
