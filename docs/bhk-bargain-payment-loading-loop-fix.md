# 砍价活动支付后页面卡在 Loading 的问题排查与修复

## 问题现象
- 在砍价活动页面完成支付后，页面会短时间内反复重渲染。
- 随后 UI 停留在“活动情报加载中...”的 loading 画面，主体内容不再渲染。
- Network 中可观察到支付后伴随多次活动状态相关请求。

## 根因分析
支付成功回调链路会触发多次状态刷新（如 `handlePostPaymentSuccess`、`fetchActivityStatus` 等），每次刷新最终都会走到 `applySession`。

在修复前，`applySession` 每次都会无条件执行：
- `heroImageLoaded: false`

而页面的 loading 显示条件为：
- `loading || !heroImageLoaded`

这意味着即便 `loading` 已结束，只要 `heroImageLoaded` 被重置为 `false`，页面就会重新进入 loading 分支。

当多次刷新时，如果 `heroImage` 实际没有变化（同一张图），小程序对相同 `src` 的 `<image>` 不一定总会再次触发 `bindload`，导致 `heroImageLoaded` 可能无法回到 `true`，最终卡在 loading。

## 修复方案
在 `applySession` 中改为：
1. 先计算下一帧头图 `nextHeroImage`。
2. 当“当前头图已加载且新旧头图 URL 相同”时，保留已加载状态。
3. 仅在头图地址变化时，才将 `heroImageLoaded` 置为 `false`，等待新图加载回调。

核心逻辑：
- `keepHeroLoaded = this.data.heroImageLoaded && this.data.heroImage === nextHeroImage`
- `heroImageLoaded: keepHeroLoaded`

## 影响范围
- 仅影响砍价活动页头图加载状态管理。
- 不改变支付、库存、权益等业务逻辑。
- 头图切换场景仍会正常回到 loading 并等待新图加载完成。

## 验证建议
1. 正常进入砍价页，确认首次仍会显示 loading 并正常进入内容页。
2. 发起支付并完成，观察页面不再长时间停留在 loading。
3. 在支付后连续触发状态刷新，确认不会出现“反复重渲染后卡死”。
4. 人工切换不同活动（头图 URL 变化）时，确认 loading 行为符合预期。
