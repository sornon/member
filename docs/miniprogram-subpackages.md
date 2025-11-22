# 小程序分包方案（宗门系统）

参考官方文档：[分包加载](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/basic.html)。为解决主包体积超过 1.5M 的问题，宗门相关页面已独立成分包，便于发布与后续扩展。

## 已完成的调整

- 将原先的宗门页面从 `pages/guild/**` 迁移至 `packages/guild/**`。
- 在 `miniprogram/app.json` 增加 `subpackages` 配置：
  - `root: "packages/guild"`
  - `name: "guild"`
  - `pages`: `index/index`、`members/index`、`tasks/index`、`boss/index`、`logs/index`、`attributes/index`、`create/index`、`detail/index`、`team/index`
- 所有前端跳转地址已改为 `/packages/guild/...`，首页入口与宗门内部导航保持一致。

## 后续操作指引

1. **本地预览与上传**：使用微信开发者工具重新导入项目，确认分包路径生效后再上传主包与分包。
2. **体积校验**：在“本地设置 → 预览设置”中开启“构建 npm”与“上传时检查包体积”，确认主包压缩后低于 1.5M。
3. **新增宗门页面**：
   - 将新页面放入 `miniprogram/packages/guild/` 下，并在 `app.json` 的 `subpackages[ name=guild ]` 中追加页面。
   - 所有跳转地址使用 `/packages/guild/<page>`，避免回退到主包路径。
4. **公共资源复用**：组件与工具方法仍从根目录引用，如 `/components/custom-nav/custom-nav`、`/shared`、`/utils`，无需重复复制到分包。
5. **回滚方案**：若需要暂时回退分包，可将宗门页面重新添加到 `app.json` 主包 `pages` 列表并调整跳转路径，但需再次校验主包体积。

## 常见问题

- **分包页面无法打开**：确认 `app.json` 已新增 `subpackages`，并确保跳转 URL 以 `/packages/guild/` 开头。
- **组件样式丢失**：检查分包页面的 `usingComponents` 是否仍指向以 `/` 开头的绝对路径；相对路径可能因层级变化导致解析失败。
- **上传提示未构建 npm**：分包后仍需按照原流程点击“构建 npm”，否则上传校验会失败。
