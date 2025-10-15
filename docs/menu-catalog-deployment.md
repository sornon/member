# 菜单商品管理功能部署说明

## 功能概览

本次迭代将原先保存在 `miniprogram/shared/menu-data.js` 的静态菜单迁移到云数据库中统一管理，新增的云函数 `menuCatalog` 负责提供菜单读取以及管理员的增补能力，同时在管理员端新增「商品管理」页面，支持：

- 维护一级类目（如酒水、用餐等），支持新增、重命名及调整排序
- 维护二级类目（如精品咖啡、红葡萄酒等），可配置常规排序及酒水专用的白天/夜间顺序
- 维护商品条目，支持新增、编辑名称/描述/单位/价格、调整起订量及上下架状态
- 实时刷新菜单数据，前端会员点餐页自动读取数据库配置

## 数据结构

新增了三个集合用于存储菜单数据，集合名称在 `common-config` 中暴露：

| 集合名            | 说明                     | 关键字段 |
| ----------------- | ------------------------ | -------- |
| `menuSections`    | 一级类目定义             | `sectionId`, `name`, `sortOrder`, `status` |
| `menuCategories`  | 二级类目定义（隶属一级） | `sectionId`, `categoryId`, `name`, `sortOrder`, `status`（支持可选的 `daySortOrder`、`nightSortOrder`） |
| `menuItems`       | 商品条目                 | `sectionId`, `categoryId`, `itemId`, `title`, `variants`, `minQuantity`, `sortOrder`, `status` |

`variants` 字段为数组，结构与原先菜单一致：`[{ label, unit, price }]`，价格仍以分为单位存储。

## 部署步骤

1. **上传云函数**：
   - 在微信开发者工具中选择云函数目录 `cloudfunctions/menuCatalog`，上传并部署到对应环境。
   - 确认云函数拥有读写上述三个集合的权限。

2. **创建集合**：
   - 在云开发控制台中手动创建 `menuSections`、`menuCategories`、`menuItems` 集合（若第一次运行云函数也会自动创建，但推荐提前创建以设置索引）。
  - 建议为以下字段建立唯一索引以避免重复，可在云开发控制台中进入 **数据库 → 目标集合 → 索引 → 新建索引**，并按照下列顺序为索引添加字段：
    1. 点击“添加索引字段”，选择字段名后再点击“添加字段”以继续追加下一列，直至包含全部字段；
    2. 勾选“唯一索引”后再点击“确定”。

    | 集合名 | 索引字段顺序 | 说明 |
    | --- | --- | --- |
    | `menuSections` | `sectionId` | 单字段唯一索引。 |
    | `menuCategories` | `sectionId` → `categoryId` | 联合唯一索引，确保同一一级类目下的 `categoryId` 不重复。 |
    | `menuItems` | `sectionId` → `categoryId` → `itemId` | 联合唯一索引，确保商品在所属类目下唯一。 |

    > 如仅添加了 `sectionId` 就提交（例如在 `menuCategories` 集合中创建成“唯一的 sectionId”），导入 `menuCategories.json` 时会因同一一级类目存在多条记录而提示 `duplicate key error collection ... index: sectionId`. 可在“索引”页删除错误的索引后，按照上述顺序重新创建联合索引，再次导入即可。

3. **初始化数据**（可选）：
   - **准备旧数据文件**：从版本库历史中导出变更前的 `miniprogram/shared/menu-data.js`，保存为 `miniprogram/shared/menu-data.legacy.js`（或任意位置，后续脚本需指向该路径）。示例命令：

     ```bash
     git show <commit-with-legacy-menu>:miniprogram/shared/menu-data.js \
       > miniprogram/shared/menu-data.legacy.js
     ```

     > ⚠️ **注意**：请将 `<commit-with-legacy-menu>`（或中文说明中的“含有旧菜单数据的提交哈希”）替换为真实的提交哈希，并且不要保留尖括号。若直接粘贴示例命令中的尖括号，Shell 会把 `<...>` 当成输入重定向从文件读取数据，从而提示 `No such file or directory`。可通过 `git log -- miniprogram/shared/menu-data.js` 查找仍包含旧数据的提交记录。

   - **生成导入文件**：执行 `scripts/export-menu-collections.js` 将旧版结构拆分为三个集合所需的 JSON Lines 文件。脚本会为每行生成一个文档，便于直接使用云开发导入工具：

     ```bash
     node scripts/export-menu-collections.js \
       --source miniprogram/shared/menu-data.legacy.js \
       --out dist/menu-catalog-seed
     ```

    成功执行后会得到 `menuSections.json`、`menuCategories.json`、`menuItems.json` 三个文件，每行一个 JSON 对象，字段已兼容 `sectionId`、`categoryId`、`itemId`、`variants` 以及带起订量的 `minQuantity`。其中 `menuCategories.json` 会依据旧版酒水菜单自动补齐 `daySortOrder` 与 `nightSortOrder` 字段，对应白天（09:00-16:59）与夜间的展示顺序。

   - **导入集合**：登录云开发控制台，依次进入目标集合的 **数据 → 导入**，选择“JSON”格式并上传对应文件（例如 `menuSections.json` → `menuSections` 集合，依此类推）。勾选“使用文件中 `_id`”选项即可沿用脚本生成的主键，避免重复。

   - 若无需批量导入，也可直接在管理员页面逐条录入。录入时价格以“元”为单位填写，云函数会自动转换为“分”保存。

4. **更新小程序端**：
   - 重新编译小程序，确保 `pages/admin/menu-catalog` 页面以及会员端点餐页的菜单均从云端获取。

## 使用指南

- 管理员进入「管理员中心 → 商品管理」即可查看和维护菜单。
- 列表默认以“名称（ID）”形式展示一级/二级类目及商品，点击后会按“一级类目 → 二级类目 → 商品”的顺序级联刷新右侧详情。
- 选中一级类目后，可在页面下方直接修改名称、排序并保存；选中二级类目会展示常规排序与白天/夜间排序输入框；选中商品可编辑名称、描述、规格、单位、价格、起订量以及上架状态。
- 页面右上角的“＋新增”按钮用于展开/收起新增表单，默认折叠以减少干扰；表单提交成功后会自动收起并刷新列表。
- 一级类目、二级类目均支持设置排序值，数值越小越靠前；可根据需要使用英文标识以便后续引用。
- 新增商品时：
  - `标识` 字段需保持唯一。
  - `价格` 以“元”为单位填写（支持小数）。
  - `规格`、`单位` 用于在点餐页展示，如“杯 /杯”。
  - `起订` 为可选项，不填视为 1；若填写将自动取整。
  - 可录入可选的描述与图片地址，前端将直接展示。
- 商品、类目创建或编辑后无需手动刷新会员端页面，数据会在下次打开点餐页时自动生效。

### 酒水二级类目分时段排序

- 管理员页新增的“白天排序”“夜间排序”输入框仅针对一级类目为 `drinks`（酒水）的二级类目生效。白天排序应用于每日 09:00-16:59，夜间排序应用于其余时段。
- 若两个字段均为空，则默认按照 `sortOrder` 值排序；若 `sortOrder` 也未设置，则仍会按照历史静态菜单中定义的顺序（精品咖啡、佐酒小食……）展示，确保兼容旧体验。
- 可在批量导入数据时直接在 `menuCategories.json` 中填写 `daySortOrder`、`nightSortOrder`，也可在后台表单中输入整数值，数值越小越靠前。
- 其他一级类目（如 `dining`）会忽略这两个字段，依旧使用 `sortOrder` 进行排序。

## 注意事项

- 若需新增更多层级或批量导入，可在 `menuCatalog` 云函数基础上扩展对应 action。
- 管理员页面已支持新增与编辑（含上下架），如需删除数据或批量调整，可在云开发控制台手动处理或扩展云函数 action。
- 为保持数据一致性，请避免继续修改 `shared/menu-data.js`，该文件仅作为空白占位与降级备用。
