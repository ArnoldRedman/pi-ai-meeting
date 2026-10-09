// ai-meeting 脚本骨架
// 用法：把本文件内容改写成 ```js workflow 代码块，放进**同一条**回复里，
//       并在同一回复调用 subagent({ workflow: true, async: true, context: "fresh", timeoutMs: 900000 })
// 注意：同一个回复里只能有一个 ```js workflow 块 + 一次 workflow:true 调用。

const seats = [
  { key: "sol", model: "zhuzi/gpt-6.1-sol:medium", label: "Sol" },
  { key: "astra", model: "zhuzi/gpt-6-astra:medium", label: "Astra" },
  { key: "grok", model: "zhuzi/grok-4.7:xhigh", label: "Grok" },
  { key: "ds", model: "zhuzi/deepseek/deepseek-flash:high", label: "DeepSeek" },
];

const dir = "C:\\Users\\zhuzi\\AppData\\Roaming\\com.zhizhang.app\\projects\\<项目名>\\大纲\\";

// ---- 问题单：用数组 join，避免模板字面量里出现意外换行 ----
const brief = [
  "你是多模型会议中的一位独立顾问。<一句话说明本轮要解决什么>。",
  "",
  "【作品／项目背景】<必须自包含：它们没有上一轮的上下文>",
  "",
  "【机制契约（不可违反，请逐条对照）】<把设定/约束逐条列出，防止它们重复我已经犯过的错>",
  "",
  "【材料】<可让它们用 read 工具按绝对路径读；中文路径可直接用。只读，不许写>",
  "",
  "【请回答以下几点，按编号写】",
  "1. <逼具体，要求引用原文条款>",
  "2. <第 2 问>",
  "",
  "【格式】中文，不超过 N 字。字数不必精确，不要为了数字数运行任何命令。",
  "如果某一点你认为没问题，就写「无」——不要为了交卷硬凑。",
].join("\n");

// ---- 第一轮：并行独立表态 ----
const round1 = await runs.all(
  seats.map((seat) => ({
    key: seat.key,          // 轮内唯一
    agent: "oracle",        // 只读顾问型 agent，够用且便宜
    model: seat.model,      // "provider/id:level"
    context: "fresh",       // 自包含材料，隔离上下文
    output: false,          // 不为短报告写产物文件
    task: brief,
  })),
);

// ---- 返回值：必须带 runId，第二轮 resume 要用 ----
return {
  seats: seats.map((seat, i) => ({ seat: seat.key, model: seat.model, ok: !!(round1[i] && round1[i].ok) })),
  answers: round1.map((row, i) => {
    const text = row && row.output ? String(row.output).trim() : "";
    return {
      seat: seats[i].key,
      runId: row && row.runId ? row.runId : null,   // ← 第二轮喂回去的关键
      text: text.length === 0 ? "(本轮无有效输出)" : text.slice(0, 3600),
    };
  }),
};

/* ============================================================
   第二轮（匿名交叉质询）模板：单独跑一次 workflow
   ------------------------------------------------------------
   const peers = { sol: `（sol 第一轮的全文，逐字粘贴）`, astra: `...`, grok: `...`, ds: `...` };
   const seat2 = [ {key:"sol", label:"A", model:"...", runId:"<第一轮 runId>"}, ... ];

   function packetFor(seat) {                      // 普通函数即可，别用 async
     const head = ["【第二轮：交叉质询】下面是其他三位顾问的答案（已匿名，未告知对应模型）。你自己是顾问 " + seat.label + "，你的答案略去。", ""];
     const body = [];
     for (const other of seat2) { if (other.key === seat.key) continue;
       body.push("--- 顾问 " + other.label + " ---", peers[other.key], ""); }
     const tail = ["只回答：你与他们的实质分歧、你被说服了什么、你修订后的结论。不要复述他们的答案。", "中文，不超过 450 字。"];
     return head.concat(body, tail).join("\n");
   }

   // 并行 + 单席位兜底（顺序 for 会让整场慢 4 倍，v1 我犯过）
   const launches = seat2.map((seat) => {
     const task = packetFor(seat);
     return runs.run(seat.key + "-r2", { resume: seat.runId, output: false, task })
       .catch(() => runs.run(seat.key + "-r2-fresh", {        // resume 被拒 → 降级 fresh
         agent: "oracle", model: seat.model, context: "fresh", output: false,
         task: task + "\n\n【你自己的第一轮答案（请在它基础上修订）】\n" + peers[seat.key],
       }))
       .catch((error) => ({ ok: false, seat: seat.key, error: String((error && error.message) || error) }));
   });
   const settled = await Promise.all(launches);
   return { anonymity: seat2.map(s => s.label + " = " + s.key), round2: settled.map((row, i) => ({
     seat: seat2[i].key, ok: !!(row && row.ok), error: (row && row.error) || null,
     text: String((row && row.output) || "").slice(0, 2800) })) };
   ============================================================ */
