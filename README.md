# pi-ai-meeting

Pi 的多模型会议 skill：把 3–5 个**不同模型**（各带自己的供应商与思考档位）拉进同一场会议，**并行独立表态 → 匿名交叉质询 → 投票定案 → 验收修改**。

用于需要多个独立视角的**判断题**：设定审稿、方案选型、文案定稿、风险挑错；也用于需要互相拆解的真实分歧。

## 安装

先装它依赖的 `pi-subagents`（**本包不自带，pi 也不内置**，缺了就没法开会）：

```bash
pi install npm:pi-subagents     # 提供 subagent 工具与 oracle agent
```

缺它的现象：工具列表里没有 `subagent`；就算绕过也会报 `Unknown agent 'oracle'`。注意**不要**把它写进本包的 `dependencies`——那样会和你自己装的那份重复注册。

```bash
# git（推荐，跟着仓库 ref 走）
pi install git:github.com/ArnoldRedman/pi-ai-meeting

# git，钉住某个版本
pi install git:github.com/ArnoldRedman/pi-ai-meeting@v1.0.0

# npm（尚未发布到 npm，发布后可用）
pi install npm:pi-ai-meeting
```

管理：

```bash
pi list                          # 查看已安装
pi update git:github.com/ArnoldRedman/pi-ai-meeting
pi remove git:github.com/ArnoldRedman/pi-ai-meeting
```

> **移除时会残留一个配置文件**：`pi remove` 只清包目录和 settings 条目，**不动 `~/.pi/agent/ai-meeting.json`**（那是你自己配的席位表，扩展也没有卸载钩子能清自己）。想干净移除就先删它：
>
> ```bash
> rm ~/.pi/agent/ai-meeting.json      # Windows: del "%USERPROFILE%\.pi\agent\ai-meeting.json"
> pi remove git:github.com/ArnoldRedman/pi-ai-meeting
> ```
>
> 没跑过 `/ai-meeting:config` 就不会有任何残留。

## 每场会结束时给什么

不是"总结一次"就完了，而是四件东西：

1. **谁在拖时间 / 谁在摸鱼**（见上一节）；
2. **票型图**——先说清**统一还是未统一**；未统一就列 `A「保留原机制」2 票 —— sol、grok` / `B「换新机制」1 票 —— astra` / `C「先不动」1 票 —— ds`，每方向一句话主张 ＋ 代价，并说清**分歧的实质**（争的是改动幅度？代价归属？还是信息不够？）；
3. **三类分**：真洞 / 已知取舍 / 空话 ＋ "谁改了什么主意"；
4. **下一步菜单**（带代价，不替你选）：

```text
1. 采用 A —— 直接出具体改法
2. 四席二轮会：A/B/C 匿名重投，看票型是否移动
3. 三席两轮会（交叉验证）：移出最边缘一席让 A/B 对撞，目标收敛 —— 只传 seats 子集，不用改配置
4. 只深挖某一方向：把它写成待验证假设，让各席找反例与失效条件
5. 你给一个新方向：写进问题单开二轮
```

上限**两轮**（表态 + 收敛）：第二轮仍分裂就不再开会，把分歧和各自代价摆给你拍板。

## 配置席位

席位不写死在 skill 里，装完先配一次：

```text
/ai-meeting:config
```

交互式逐席选择 **供应商 → 模型 → 思考档位**（只列出你本机真实可用、且该模型确实支持的档位）。也可以用 `/ai-meeting:config raw` 直接用编辑器改 JSON。

配置写在 pi 配置目录下的 `ai-meeting.json`（通常是 `~/.pi/agent/ai-meeting.json`）：

```json
{
  "version": 1,
  "seats": [
    { "provider": "anthropic", "model": "claude-opus-4", "thinking": "high", "name": "opus", "note": "结构最清，保守" }
  ]
}
```

- 首次运行任何一次 `/ai-meeting:config`（或在无配置时开会）会自动生成一份默认配置：从你已认证的模型里挑最多 4 个**不同模型**（优先当前供应商）作为默认席位。
- `name` 是席位简称，必须唯一；`note` 只给人看。
- 改过模型配置后，在 pi 里按一次 `/model` 重载注册表，否则席位会硬失败（`Unknown subagent model ...`）。
- 席位数 3–5 合适；同一个模型挂在两个供应商别名下**不算**独立视角。

## 会自动报「谁在拖时间」

每场会开完，skill 都会拿**中位数**比一遍各席耗时，然后单独报一段：

- **某席 ≥ 中位数 × 2.0**（且多出 60 秒以上）→ 报它拖时间；如果它的 thinking 档明显高于其他席，**先判定是档位问题**，建议降档而不是踢人。
- **判"摸鱼"只看直接证据：它到底碰没碰过材料**（从工具调用记录里数材料命中数）。命中满就不是摸鱼，无论它多快；0–1 命中且工具调用极少才报。**不用轮数/token/字符数当判据**——一个 turn 里可以并发多个工具调用，实测某席 5 turns / 4 次批量 bash 就翻完了整个仓库（同类基准另两席是 47/67 turns），用轮数会把最能干的席位误判成摸鱼。
- 顺带一个反直觉事实：**慢的主因常是调用碎而不是干得多**。同一场实测 4 次批量 bash = 65 秒，79 次细碎 grep/read = 437 秒。
- 阈值是实测校准过的：旧版写 2.5×，一场会里某席 2.46×（436.7s vs 中位数 177.5s，比其他三席之和还多）刚好漏报，所以降到 2.0×。
- 建议一律三选一：降档重开 / 用 `/ai-meeting:config` 减席位 / 换模型，**不代替你改配置**。
- 反误报：快但输入 token 与答案长度都正常 → 只当"模型快"，不报摸鱼。

耗时不在脚本返回值里（run 结果没有时间字段），但每个席位的 `asyncDir` 下都有 `status.json`，`steps[0].durationMs` 就是它的真实用时；脚本另外提供 `chars`/`turns`/`inputTokens`/`cost` 作为"有没有真读材料"的配套证据。

## 开会贵吗？——不贵，而且通常比一个模型自己调研更省

> ⚠️ **先看清边界**：下面所有金额都是**某一台机器 + 某一个网关**的实测（该网关对缓存命中仍按全额输入价计费）。**换供应商、换价格档、换模型，数字会变**，甚至可能贵好几倍。可迁移的是**结构**：成本 ≈ 请求次数 × 每次重发的上下文量——而不是"一场会只要几分钱"这个数字本身。请按自己的网关复算（方法在本节末）。

**结论：一场会的花费几乎由"席位被要求做多少事"决定，而不是模型单价；同样一个任务，开会的总花费通常低于"让一个模型在长会话里自己调研"。**

原因是一个很硬的机制：

- **会议席位是 fresh 短上下文**：每席只带自己的系统提示 + 问题单（实测每次请求 1–3 万 token），互不继承历史。
- **而任何一个模型在长会话里连续干活时，每做一步都要把整段历史重发一遍**（实测 20–30 万 token/次）。回合越多，重复购买越多。

### 证据一：两种会议的每席位实收（同一台机器、同一个网关）

轻任务会（3 席 × 1 轮，纯判断、不读文件，423 秒）：

| 席位 | 请求数 | 实收 |
|---|---|---|
| grok | 1 | $0.162 |
| astra | 1 | $0.145 |
| sol | 1 | $0.030 |
| **席位合计** | **3** | **$0.34** |

重任务会（4 席 × 2 轮，席位要通读一整个代码仓库，562 秒）：

| 席位 | 请求数 | 输入侧 token（其中缓存重发） | 实收 | 占比 |
|---|---|---|---|---|
| ds | 73 | 5,253,605（96%） | $10.73 | 76% |
| grok | 50 | 3,084,451（93%） | $2.12 | 15% |
| astra | 6 | 140,144（50%） | $0.97 | 7% |
| sol | 6 | 164,059（54%） | $0.23 | 2% |
| **席位合计** | **135** | | **$14.05** | |

同样是"一场会"，差 40 倍。差异不在模型单价：单价最便宜的席位（$2/M）反而占了 76%，而单价贵 5 倍的那个（$10/$50）只花 $0.97。**差别在席位发了几次请求、每次重发多长的上下文**——那个 $10.73 的席位，是用 73 次碎步调用一个文件一个文件翻出来的（另一席 6 次批量调用就看完了同样的材料）。

### 证据二：同一个 10 分钟窗口，两种做法（最关键的一条）

| 做法 | 花费 |
|---|---|
| 一个模型（主会话、20–30 万 token 常驻上下文）自己调研、跑脚本、读日志 | **$17.40** |
| 同时段开一场 3 席会议 | **$0.34** |

同一台机器、同一时段、真实发生：**单个模型自己干的约 1/50**。这就是"开会反而省"的机制——把工作拆给几个短命 fresh 子会话，比在一个不断变长的会话里串行做便宜得多。

### 证据三：全天账单的构成

| 谁 | 请求数 | 费用 |
|---|---|---|
| 单个模型在主会话里长跑 | 1,183 | $468.29（77%） |
| 两场会、共 8 个席位 | ~400 | $14.4（3%） |

全天账单的大头是"长会话"，不是"开会"。

### 什么时候会贵（不是劝退，是给你预期）

- 让席位**通读大量材料**且允许它**碎步调用**时，单个席位能到 $10 量级；要求它批量读，同一任务能降到 $1 以内。
- `cross: true`（第二轮匿名交叉质询）大约多花半场时间与一半以内的钱；只想快速取值就用 `cross: false`。
- 席位数与成本大致线性；3–5 席是性价比区间。

### 怎么用你自己的网关数字复核

每个席位的 `asyncDir` 下有 `status.json`（用时、请求数）与 `events.jsonl`（每次请求的 token）。把 token 量乘上你自己网关的单价即可逐席核算。

**两个必知的统计口径**（不然会算错一倍以上）：

- **只数 `message_end`**。同一次 API 请求的用量会在 `message_end` 与 `turn_end` 里各出现一次（`message_start` 是全零），全算上会把 token 翻倍、请求数变三倍。
- **输入侧 token = `input + cacheRead + cacheWrite`**，不是只看 `input`（后者只是新增部分）。

### 边界（必须说清）

- 上面金额来自一个具体网关（例如它对**缓存命中仍按全额输入价**计费，$2/M），**换供应商数字会变**；但"成本 ≈ 请求次数 × 每次重发的上下文"这个结构不变。
- 缓存折扣只对"长会话"影响巨大，对"开会"影响很小——所以别为了省钱而不敢开会。

## 内容

```text
extensions/
└── ai-meeting.ts                 # /ai-meeting:config 命令
skills/ai-meeting/
├── SKILL.md                      # 何时开会、三条硬规矩、流程
└── references/
    ├── question-design.md        # 问题单写法 + 六类会议模板 + 汇总规则
    ├── meeting.js                # 会议脚本本体（并行表态 + 匿名互评 + 单席位兜底）
    └── pitfalls.md               # 实战坑与修法
```

`references/meeting.js` 是**直接调用的脚本文件**，不需要把代码复制进回复：

```js
subagent({
  workflow: "<本 skill 目录>/references/meeting.js",
  async: true,
  timeoutMs: 1800000,
  args: {
    seats: [ /* 粘贴 ai-meeting.json 里的 seats */ ],
    brief: "问题单全文（自包含；长材料写绝对路径让席位自己 read）",
    cross: true,   // true = 第一轮表态 + 第二轮匿名互评一次跑完
    tag: "设定-0725"
  }
})
```

## 前置条件

| 依赖 | 为什么需要 | 缺了怎么办 |
|---|---|---|
| **`pi-subagents`**（额外安装，非 pi 内置） | 开会用的 `subagent` 工具、`oracle` agent、`runs.all` 编排都来自它；耗时甄别读的 `status.json` 也是它写的 | `pi install npm:pi-subagents` |
| 至少 3 个已认证的不同模型 | 少于 3 席分不出独立视角，也判不了耗时异常 | `/ai-meeting:config` 会自动从你已认证的模型里选；不够就去配供应商 |
| pi 编码代理（宿主） | 扩展 import 宿主接口；已在 `peerDependencies` 里声明 | 无 |

## 维护

改动流程（本地仓库在 `D:\pi-ai-meeting`）：

```bash
cd /d D:\pi-ai-meeting
git add -A && git commit -m "..." && git push
pi update git:github.com/ArnoldRedman/pi-ai-meeting   # 让已安装的 checkout 跟上
```

在会话中改了 `SKILL.md` 后，`/reload` 生效。**不要**再往 `~/.pi/agent/skills/` 里放一份同名副本 —— 同名 skill 冲突时 Pi 保留先发现的并只打个警告，本地副本会静默盖掉包里的版本。

改了 `references/meeting.js` 里的文本处理（`cleanText` / `stanceOf`）或扩展里的配置读写（`readConfig` / `validate`）后跑自检：

```bash
node tests/clean-text.test.mjs   # 抹 harness 报告块、抽【结论】行
node tests/config.test.mjs       # 坏配置不被误当成"没配置"，校验不抛异常
```

两个测试都是**直接从产品源码里抠出函数来跑**（`tests/extract.mjs`），不在测试里重写一份，所以不会漂移。

发 npm 包前留意 `package.json` 的 `files`：新增资源目录（如 `extensions/`）必须加进去，否则 npm 路线装出来的包会缺东西。

发版：改 `package.json` 的 `version` → 提交 → `git tag -a v1.1.0 -m v1.1.0 && git push --tags`；钉版本的用法是 `pi install git:github.com/ArnoldRedman/pi-ai-meeting@v1.1.0`。

发到 npm 后即可用 `pi install npm:pi-ai-meeting`：

```bash
npm login        # 需要交互
npm publish
```

## License

MIT
