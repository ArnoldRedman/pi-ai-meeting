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
- **`turns` 低得明显**（≤ 其他席位中位数一半且 ≤ 2）→ 报它**疑似没读材料**（浑水摸鱼）；快但 `turns` 正常就只是模型快，不误报。长短和 token 数只当参考——实测用它俩定案会误伤。
- 阈值是实测校准过的：旧版写 2.5×，一场会里某席 2.46×（436.7s vs 中位数 177.5s，比其他三席之和还多）刚好漏报，所以降到 2.0×。
- 建议一律三选一：降档重开 / 用 `/ai-meeting:config` 减席位 / 换模型，**不代替你改配置**。
- 反误报：快但输入 token 与答案长度都正常 → 只当"模型快"，不报摸鱼。

耗时不在脚本返回值里（run 结果没有时间字段），但每个席位的 `asyncDir` 下都有 `status.json`，`steps[0].durationMs` 就是它的真实用时；脚本另外提供 `chars`/`turns`/`inputTokens`/`cost` 作为"有没有真读材料"的配套证据。

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
