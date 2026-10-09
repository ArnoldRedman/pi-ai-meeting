# pi-ai-meeting

Pi 的多模型会议 skill：把 3–5 个**不同模型**（各带自己的供应商与思考档位）拉进同一场会议，**并行独立表态 → 匿名交叉质询 → 投票定案 → 验收修改**。

用于需要多个独立视角的**判断题**：设定审稿、方案选型、文案定稿、风险挑错；也用于需要互相拆解的真实分歧。

## 安装

```bash
# git（推荐，跟着仓库 ref 走）
pi install git:github.com/ArnoldRedman/pi-ai-meeting

# git，钉住某个版本
pi install git:github.com/ArnoldRedman/pi-ai-meeting@v1.0.0

# npm（发布后可用）
pi install npm:pi-ai-meeting
```

管理：

```bash
pi list                          # 查看已安装
pi update git:github.com/ArnoldRedman/pi-ai-meeting
pi remove git:github.com/ArnoldRedman/pi-ai-meeting
```

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

需要 `pi-subagents` 提供 `subagent` 工具与 `oracle` agent（本包不自带）：

```bash
pi install npm:pi-subagents
```

## 维护

改动流程（本地仓库在 `D:\pi-ai-meeting`）：

```bash
cd /d D:\pi-ai-meeting
git add -A && git commit -m "..." && git push
pi update git:github.com/ArnoldRedman/pi-ai-meeting   # 让已安装的 checkout 跟上
```

在会话中改了 `SKILL.md` 后，`/reload` 生效。**不要**再往 `~/.pi/agent/skills/` 里放一份同名副本 —— 同名 skill 冲突时 Pi 保留先发现的并只打个警告，本地副本会静默盖掉包里的版本。

发版：改 `package.json` 的 `version` → 提交 → `git tag -a v1.1.0 -m v1.1.0 && git push --tags`；钉版本的用法是 `pi install git:github.com/ArnoldRedman/pi-ai-meeting@v1.1.0`。

发到 npm 后即可用 `pi install npm:pi-ai-meeting`：

```bash
npm login        # 需要交互
npm publish
```

## License

MIT
