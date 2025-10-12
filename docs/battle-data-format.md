# 战斗过程数据格式规范

> **适用范围**：秘境（PVE）与竞技场（PVP）战斗模拟、实时播放、战报回放、后台审计等所有需要解析战斗过程的场景。

为了摆脱“根据文字描述再反推动画”的低效流程，本规范将战斗过程抽象为结构化数据。云函数在结算战斗时需直接生成下述 JSON 结构，前端与运营工具均可依据同一份数据渲染动画、统计伤害与复盘异常。

## 顶层结构

```jsonc
{
  "participants": {
    "player": {
      "id": "member-001",
      "displayName": "踏星客",
      "portrait": "https://.../avatar.png",
      "maxHp": 13250,
      "hp": { "current": 13250 },
      "combatPower": 28934
    },
    "opponent": {
      "id": "boss-417",
      "displayName": "玄火尊",
      "portrait": "https://.../boss.png",
      "maxHp": 16800
    }
  },
  "timeline": [ /* 详见下节 */ ],
  "outcome": {
    "winnerId": "member-001",
    "result": "victory",
    "rounds": 7,
    "rewards": { "stone": 120, "drops": [] },
    "summary": {
      "title": "战斗结果 · 胜利",
      "text": "你成功击败玄火尊，炼气境更进一步。"
    }
  },
  "metadata": {
    "mode": "pve",
    "seed": "f47ac10b-58cc-4372-8f5f-4d00a6e7a123",
    "generatedAt": 1714982330123
  }
}
```

### participants
- `player` / `opponent`：参战双方的静态信息，至少包含 `id`、`displayName`（或 `name`）、`portrait` 与 `maxHp`。
- 可按需扩展 `attributes`、`equipment`、`skillLoadout` 等字段，用于客服排查或分享卡片渲染。

### timeline
`timeline` 是一组按时间排序的动作节点，每个节点描述一次技能、普攻或触发事件。前端将直接使用该数组驱动动画，无需解析文字日志。

```jsonc
{
  "id": "round-3-action-1",
  "round": 3,
  "sequence": 1,
  "actorId": "member-001",
  "actorSide": "player",
  "skill": {
    "id": "skill_liuyun",
    "name": "流云剑诀",
    "type": "active",
    "element": "wind",
    "level": 4,
    "resource": { "type": "rage", "cost": 35 }
  },
  "events": [
    {
      "type": "damage",
      "targetId": "boss-417",
      "value": 2186,
      "crit": true,
      "penetration": 320,
      "element": "wind",
      "breakdown": { "base": 1280, "crit": 1.5, "bonus": 0.14 }
    },
    {
      "type": "status",
      "targetId": "boss-417",
      "statusId": "def_down",
      "statusName": "防御破绽",
      "operation": "apply",
      "duration": 2
    },
    {
      "type": "resource",
      "targetId": "member-001",
      "resourceType": "rage",
      "before": 45,
      "change": -35,
      "after": 10
    }
  ],
  "state": {
    "player": {
      "hp": { "before": 13250, "after": 13250, "max": 13250 },
      "shield": { "before": 0, "after": 0 },
      "buffs": [{ "id": "sword_echo", "stacks": 1, "duration": 2 }]
    },
    "opponent": {
      "hp": { "before": 9800, "after": 7614, "max": 16800 },
      "shield": { "before": 0, "after": 0 },
      "debuffs": [{ "id": "def_down", "duration": 2 }]
    }
  },
  "summary": {
    "title": "第3回合 · 流云剑诀",
    "text": "踏星客施展流云剑诀，对玄火尊造成 2186 点风系伤害（暴击），并施加防御破绽。"
  },
  "tags": ["single", "burst"],
  "metadata": { "seed": "...-3-1" }
}
```

#### 字段说明
- `round` / `sequence`：回合与同回合内的出手顺序。
- `actorId` / `actorSide`：执行动作的单位，可直接映射 `participants`。
- `skill`：触发本动作的技能或普攻信息，若为被动触发可将 `type` 设为 `passive` 并省略 `resource`。
- `events`：本动作产生的一系列离散效果，常见类型如下：
  - `damage`：伤害结算，必填 `targetId` 与 `value`，可附带 `crit`、`penetration`、`element`、`shieldDamage`、`breakdown` 等扩展字段。
  - `heal`：治疗或吸血，记录 `value` 与目标。
  - `status`：状态变化，使用 `operation` 表示 `apply`（施加）、`refresh`（刷新）、`remove`（移除）。
  - `shield`：护盾值变化，使用 `change`、`before`、`after` 表示增减。
  - `resource`：妖气/怒气等战斗资源的收支。
  - `dodge`、`block`：闪避或格挡判定，可单独成事件也可与 `damage` 共存。
- `state`：动作结算后的战斗状态快照，至少包含双方的 `hp.before/after/max`，可扩展 `shield`、`buffs/debuffs`、`combo` 等信息。
- `summary`：前端可直接使用的标题与描述；若为空，前端会根据结构化数据自动拼装句子。
- `tags`：动作标签（如 `aoe`、`finisher`、`counter`），便于筛选与可视化。

### outcome
- `winnerId`：胜者 ID，失败方可留空。
- `result`：`victory` / `defeat` / `draw`。
- `rounds`：实际执行的总回合数。
- `rewards`：奖励数据，可直接用于结算弹窗。
- `summary`：复盘页展示用文案。

## 兼容性策略

前端已优先读取 `battle.timeline`。若数组为空或不符合结构化规范，会回退到旧版文字日志解析，以兼容历史战报。升级云函数时可先并行输出 `log` 与 `timeline`，待客户端灰度完成后再移除文字日志。

## 生成指引

1. **模拟阶段**：战斗模拟器在每次动作后生成一条时间线节点，填充 `events` 与 `state`。
2. **聚合阶段**：模拟结束后统计双方伤害、治疗、护盾等汇总数据，写入 `participants` 与 `outcome`。
3. **签名阶段**：将 `participants`、`timeline`、`outcome`、`metadata` 序列化后计算签名哈希，随战报一同返回，确保前端无法篡改。
4. **落库阶段**：`pveHistory`、`pvpMatches` 均保存完整的结构化数据，客服工具可直接读取进行可视化与导出。

通过该规范，战斗呈现、回放、运营分析、作弊审计将共享同一份数据来源，杜绝“文字描述 → 二次解析 → 动画”的信息损耗，显著提升研发效率与可维护性。
