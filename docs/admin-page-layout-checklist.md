# 管理员页面通用布局排查清单（强制执行）

> 适用范围：`miniprogram/subpackages/admin/**` 下所有后台页面（新建/改版/修复）。

## 一、目标
确保所有后台页面统一使用本小程序的顶部导航规范，避免出现：
- 无左侧圆形返回箭头；
- 标题被系统状态栏/胶囊遮挡；
- 页面出现“第二导航头”导致视觉冲突；
- 页面结构与其他后台页不一致。

## 二、标准结构（必须一致）

### 1) 页面 WXML 顶部
```xml
<custom-nav title="页面标题" theme="dark"></custom-nav>
<view class="page">
  <!-- section-block ... -->
</view>
```

### 2) 页面 JSON 组件注册（必须）
```json
{
  "usingComponents": {
    "custom-nav": "/components/custom-nav/custom-nav",
    "custom-nav-placeholder": "/components/custom-nav-placeholder/custom-nav-placeholder"
  },
  "componentPlaceholder": {
    "custom-nav": "custom-nav-placeholder"
  }
}
```

### 3) 页面样式基础类（推荐与现有后台页一致）
- 根容器：`.page`
- 卡片区：`.section-block`
- 标题行：`.block-header` + `.block-title` + `.block-actions`

## 三、强制验收清单（提交前逐条打勾）

### A. 组件层
- [ ] 页面存在 `<custom-nav ...>`，且 `theme="dark"`。
- [ ] 页面 `index.json` 已注册 `custom-nav` 与 `custom-nav-placeholder`。
- [ ] 开发者工具 WXML 树中可看到 `<components/custom-nav/custom-nav>` 节点（不是空节点）。

### B. 布局层
- [ ] 顶部存在 custom-nav 占位留白（内容不贴顶、不压状态栏）。
- [ ] 左上角显示半透明圆形返回箭头（由 custom-nav 提供）。
- [ ] 页面内容区没有额外“第二导航头”与 custom-nav 竞争。

### C. 视觉一致性
- [ ] 背景、卡片、按钮、文字层级与管理员已有页面保持一致。
- [ ] 顶部主标题由 custom-nav 承担，不在内容区重复。
- [ ] 操作按钮（新建/刷新等）放在业务卡片头部，而非替代导航。

## 四、问题定位顺序（禁止跳步）
1. **先查组件注册**：`index.json -> usingComponents`。
2. **再查渲染树**：确认 `custom-nav` 节点真实挂载。
3. **再查占位留白**：是否生效，内容是否贴顶。
4. **最后才调样式**：仅在结构正确后进行 UI 微调。

## 五、提交说明模板（每次后台页面改动都要写）
- 根因一句话：
  - 例：`custom-nav 未注册，导致组件空渲染，箭头与顶部留白失效。`
- 验收证据：
  - 例：`WXML 树出现 components/custom-nav/custom-nav；页面显示左侧圆形返回按钮；内容区不再贴顶。`

## 六、禁止项
- 禁止只改 CSS 就声称“已修复导航问题”。
- 禁止在未检查 `index.json` 的情况下直接做 UI 返工。
- 禁止在页面顶部新增“伪导航区块”替代 custom-nav。

---

维护说明：
- 本清单作为管理员后台页面的固定验收标准。
- 后续新增后台页必须按本清单验收后才可合并。
