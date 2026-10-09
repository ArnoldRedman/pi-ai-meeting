# pi-ai-meeting

Pi 的多模型会议 skill：把 3–5 个不同模型（不同 provider／model／思考档位）拉进同一场会议，**并行独立表态 → 匿名交叉质询 → 投票定案 → 验收修改**。

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

## 内容

```text
skills/ai-meeting/
├── SKILL.md                      # 席位配置、三条硬规矩、六步流程
└── references/
    ├── question-design.md        # 问题单写法 + 六类会议模板
    ├── workflow-template.js      # 可复制的 workflow 脚本骨架
    └── pitfalls.md               # 十二条实战坑
```

## 前置条件

skill 里的默认席位读本机 `~/.pi/agent/models.json` 的 `providers → models`，默认四席是 `zhuzi` provider 下的 `gpt-6.1-sol` / `gpt-6-astra` / `grok-4.7` / `deepseek/deepseek-flash`。

**换模型或改 `models.json` 后，需要在 pi 里按一次 `/model` 重载注册表**，否则该席位会 0 秒硬失败（`Unknown subagent model ... in the active Pi model registry`）。改席位表见 `SKILL.md`。

## License

MIT
