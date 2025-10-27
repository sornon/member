# PVE 接口性能分析

## 背景

线上反馈显示调用 PVE 云函数时，`{ action: "profile" }` 与 `{ action: "battle", enemyId: "secret_realm_qi_refining_01" }` 均会触发 `cloud.callFunction` 的 3 秒超时。本文对 `cloudfunctions/pve/index.js` 做了逐段排查，整理当前性能瓶颈与设计隐患，作为后续优化依据。

## 调用链概览

### 档案加载 (`action = "profile"`)

1. 入口 `exports.main` 根据 `action` 路由到 `getProfile`。【F:cloudfunctions/pve/index.js†L3010-L3075】
2. `getProfile` 顺序执行：
   - 通过 `ensureMember` 查询 `members` 文档；
   - 调 `loadMembershipLevels` 读取等级表；
   - 调 `ensurePveProfile` 做档案归一化；
   - 最终调用 `decorateProfile` 组装返回值。【F:cloudfunctions/pve/index.js†L3063-L3075】

### 战斗模拟 (`action = "battle"`)

1. 入口同样先走 `ensureMember`、`loadMembershipLevels`、`ensurePveProfile`；
2. 校验冷却、敌人配置后，拉取系统参数 `applyGlobalGameParameters`；
3. 调用 `buildBattleSetup` + `runBattleSimulation` 执行 20 回合以内的回合制流程；
4. 归档结果并写回会员档案与战斗历史。【F:cloudfunctions/pve/index.js†L3078-L3134】

上述流程在单次调用内串行执行多次数据库读写，并伴随大量 CPU 计算，是造成超时的主要背景。

## 发现的性能瓶颈

### 1. 档案归一化重复做深拷贝与序列化

`ensurePveProfile` 在每次请求都会执行：

- `normalizeProfile` 返回新对象后，用两次 `JSON.stringify` 对比是否变化；
- 重新计算属性摘要，并再次 `JSON.stringify` 对比；
- 无论档案是否包含历史战斗，都会去 `memberPveHistory` 集合再读一次历史文档；
- 若判定有任何差异，立即调用 `savePveProfile` 写回会员档案并同步历史集合。【F:cloudfunctions/pve/index.js†L4775-L4833】【F:cloudfunctions/pve/index.js†L4702-L4760】

问题：

- `JSON.stringify` 针对含装备、技能、仓库等大对象时开销巨大，且在同一次请求里至少执行三次；
- 档案读写都会触发一次 `members.update` 与一次 `memberPveHistory.set`，即便只是读取档案也会产生写操作，增加 RTT 与锁冲突；
- 历史文档已在 `member.pveProfile` 中缓存的情况下依旧强制查询，导致多一次 I/O。

### 2. 返回装饰阶段重复计算属性

`decorateProfile` 并未复用 `ensurePveProfile` 刚写入的 `profile.attributeSummary`，而是再次完整调用 `calculateAttributes`、`decorateEquipment`、`decorateSkills` 等链路。【F:cloudfunctions/pve/index.js†L6100-L6127】

这些函数会：

- 遍历所有装备槽、套装加成、技能光环；
- 调用 `aggregateSkillEffects`、`calculateDerivedStatBlock` 等多层嵌套函数。

在 `profile` 接口上，这意味着一次请求内对同一份数据执行两次完整的属性计算，CPU 耗时成倍增加。

### 3. 战斗分支的高频数据库访问与归档成本

`simulateBattle` 在进入战斗循环前，会执行以下额外 I/O：

- `applyGlobalGameParameters` 每次直接从 `systemSettings` 读整份配置，缺乏内存缓存或 TTL；【F:cloudfunctions/pve/index.js†L192-L208】
- 战斗结束后 `savePveProfile` 触发两次写操作，同步石头余额时还会额外插入一条流水记录。

CPU 部分，战斗流程涉及：

- `buildBattleSetup` 再次调用 `calculateAttributes`、`buildRuntimeSkillLoadout` 创建 runtime；
- `runBattleSimulation` 在最多 20 回合的双重循环内创建多份事件日志、快照与深拷贝；【F:cloudfunctions/pve/index.js†L8065-L8235】
- `applyBattleOutcome` 再次执行 `normalizeProfile`、属性同步、秘境进度归并，并将整条战斗记录追加进历史数组，随后 `refreshAttributeSummary` 又会做一次全量属性计算。【F:cloudfunctions/pve/index.js†L8705-L8777】

如果敌方技能较多或奖励包含装备、技能，`ensureEquipmentOwned` / `ensureSkillOwned` 还会遍历背包与技能列表，加重 CPU 压力。

### 4. 设计层面导致的可扩展性问题

- **串行数据库访问**：`ensureMember` → `loadMembershipLevels` → `ensurePveProfile` → `loadPveHistory` → `savePveProfile` 全部顺序执行，任何一次高延迟都会放大总耗时。
- **缺乏冷启动优化**：`index.js` 体积超 8k 行，首包需要加载大量配置（技能库、秘境敌人、装备库）。冷启动时模块解析 + JIT 编译即可能接近 1 秒，留给业务逻辑的预算进一步被压缩。
- **历史记录写入模式**：`savePveHistory` 采用 `set` 覆盖，意味着每次战斗都需要传输包含日志与时间线的整条 JSON，体积与战斗复杂度线性增长，极易触发 3 秒限制。

### 5. 秘境五层战斗的剩余瓶颈

复盘 `{ action: "battle", enemyId: "secret_realm_qi_refining_05" }` 的日志发现：

- 战斗结果归档阶段再次调用 `normalizeProfile`，触发 `normalizeEquipment` / `normalizeSkills` 对全量装备与技能做深度遍历、序列化，消耗在百毫秒量级，角色存量越大耗时越长。【F:cloudfunctions/pve/index.js†L5400-L5576】
- 随后依次等待 `members.update`、`memberPveHistory.set` 与灵石流水 `add` 执行完毕，数据库 RTT 被串联，易叠加出 3 秒超时风险。

## 优化建议

1. **减少无意义的 JSON 序列化与写操作**
   - 在 `normalizeProfile` 内通过标记位返回“是否变更”，避免在 `ensurePveProfile` 层重复 `JSON.stringify`；
   - 档案仅在确实有字段差异时才调用 `savePveProfile`，并允许跳过历史写入；
   - 若 `member.pveProfile.__historyDoc` 已存在，可直接复用，无需每次查询 `memberPveHistory`。

2. **缓存昂贵的静态数据**
   - `applyGlobalGameParameters` 读取的系统参数可设置内存缓存与 30~60 秒 TTL；
   - 战斗结束后将抽象出来的奖励规则缓存，避免重复加载。

3. **复用属性摘要**
   - `decorateProfile` 可优先读取 `profile.attributeSummary`，仅在缺失时才调用 `calculateAttributes`；
   - 战斗流程中也应复用同一份属性摘要，避免 `refreshAttributeSummary` 与 `buildBattleSetup` 重复计算。

4. **异步/批量处理历史记录**
   - 将 `savePveHistory` 调整为 append + trim，而非整文档覆盖；
   - 对战斗日志做截断/压缩，或异步写入队列，降低同步调用耗时。

5. **并行化非依赖 I/O**
   - `ensureMember` 与 `loadMembershipLevels`、`applyGlobalGameParameters` 等无强依赖的查询可通过 `Promise.all` 并行执行，缩短总耗时。

通过以上优化，可显著降低 `profile` 与 `battle` 调用在数据库与 CPU 上的消耗，避免触发 3 秒超时限制。

## 本次实现的优化项

- **全局参数缓存**：`applyGlobalGameParameters` 在内存中缓存系统配置 60 秒，命中缓存时直接复用 `configureResourceDefaults` 的结果，避免每次战斗都访问 `systemSettings` 集合。【F:cloudfunctions/pve/index.js†L189-L225】
- **档案归一化与持久化调优**：
  - 使用轻量 `deepEqual` 替换三次 `JSON.stringify`，仅在结构确实发生变化时才写回会员文档；
  - 当只同步战斗/技能历史时跳过档案写入，历史文档缺失时才触发保存；
  - 复用 `profile.__historyDoc`，避免每次请求都读 `memberPveHistory`。【F:cloudfunctions/pve/index.js†L270-L332】
- **属性摘要复用**：`decorateProfile` 与 `buildBattleSetup` 优先使用 `profile.attributeSummary`，只有缺失时才重新计算，减少 CPU 密集型的属性汇总次数。【F:cloudfunctions/pve/index.js†L6149-L6161】【F:cloudfunctions/pve/index.js†L7923-L7929】
- **战斗归档优化**：
  - `applyBattleOutcome` 直接复用内存中的档案结构，避免再次执行 `normalizeProfile` 的全量装备/技能归一化，仅对奖励与秘境进度做增量更新。【F:cloudfunctions/pve/index.js†L8805-L8889】
  - `savePveProfile` 将会员档案更新与历史写入改为并行执行，减少串行 RTT。【F:cloudfunctions/pve/index.js†L4820-L4847】
  - `simulateBattle` 并行读取会员信息与等级表，并在写档案的同时异步处理灵石流水，缩短整体响应时间。【F:cloudfunctions/pve/index.js†L3145-L3203】
- **战斗历史归档与瘦身**：
  - 战斗结束后通过 `offloadBattleHistoryEntries` 将带有时间线的记录转存到全新的 `memberBattleArchive` 集合，成员文档内仅保留精简摘要与归档编号，避免每次更新都覆盖整份 JSON。【F:cloudfunctions/pve/index.js†L9041-L9176】
  - 历史日志写入时使用 `trimBattleLog` 做限长处理，新档案默认存储 30 条以内的战报摘要，归档文档则保留最多 120 条详细事件。【F:cloudfunctions/pve/index.js†L8825-L8852】【F:cloudfunctions/pve/index.js†L8893-L8965】
  - 新增 `battleArchive`/`battleReplay` 接口用于按需拉取归档回放，前端历史页面在缺少时间线时会自动触发补拉，保障回放功能不回退。【F:cloudfunctions/pve/index.js†L3020-L3023】【F:cloudfunctions/pve/index.js†L9178-L9222】【F:miniprogram/pages/pve/history.js†L4-L125】

## 部署与运维说明

1. **重新上传云函数**：在本地执行 `npm install --production`（若未安装依赖）并通过微信开发者工具或 `tcb functions deploy pve` 将 `cloudfunctions/pve` 重新部署到云端。
2. **无需新增索引**：优化仅涉及代码层缓存与条件写入，不需要对数据库集合调整索引。
3. **日志观察**：部署完成后，通过云开发控制台的「云函数日志」观察 `pve` 云函数的执行耗时，确认缓存命中后 `profile`、`battle` 调用均在 3 秒阈值内。
4. **创建战斗归档集合**：首次上线需在数据库中新建 `memberBattleArchive` 集合，可在云开发控制台创建，或执行 `tcb db:create memberBattleArchive`。该集合主要存放时间线与回放详情，当前无需额外索引。
5. **历史数据渐进迁移**：上线后的每次战斗请求会自动将最多 2 条遗留的历史记录转存到新集合，若需快速瘦身，可通过触发多次 `{ action: "battle" }` 调用或编写运维脚本批量刷新，待迁移完成后旧集合体积会显著下降。
