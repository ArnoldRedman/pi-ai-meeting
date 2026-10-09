// ai-meeting 会议脚本：第一轮并行独立表态 ＋（可选）第二轮匿名交叉质询
//
// 用法：直接在回复里把本文件当脚本文件调用，不要复制代码
//   subagent({
//     workflow: "<本 skill 目录>/references/meeting.js",
//     async: true,
//     timeoutMs: 1800000,
//     args: { seats, brief, cross, tag }
//   })
//
// args 约定（上限 16 KiB，所以长材料写绝对路径让各席位自己去 read）：
//   seats: 直接粘贴 ai-meeting.json 里的 seats 数组，别改字段名
//   brief: 问题单全文（自包含）
//   cross: true 才跑第二轮匿名互评；审稿/机制挑错/方案选型用 true，纯表态用 false
//   tag:   可选，只用来在返回值里标记本场会议，例如 "设定-0725"
//
// 返回值里每个席位都带第一轮/第二轮的 runId：后续投票轮、验收轮可以拿它 resume，
// 不必重跑第一轮。
//
// 耗时：单席位用时脚本里拿不到（run 结果没有时间字段），但在每个席位 asyncDir 的
// status.json 里有 steps[0].durationMs，父会话按 runId/asyncDir 去读即可。
// 所以返回值给客观数字（答案长度、turns、输入 token、cost、asyncDir），快慢判断由
// 父会话按 SKILL.md 的流程做。

const seats = Array.isArray(args.seats) ? args.seats : [];
if (seats.length === 0) throw new Error("args.seats 为空：先读 ai-meeting.json，把 seats 传进来");

const brief = typeof args.brief === "string" ? args.brief.trim() : "";
if (!brief) throw new Error("args.brief 为空：把问题单原文放进 args.brief");

const tag = typeof args.tag === "string" && args.tag.trim() !== "" ? args.tag.trim() : "meeting";

function seatKey(seat, index) {
  const name = typeof seat.name === "string" ? seat.name.trim() : "";
  return name !== "" ? name : "seat" + (index + 1);
}

function modelRef(seat) {
  return seat.provider + "/" + seat.model + ":" + seat.thinking;
}

// 子会话自己的用量：turns 低 + 答案短 + 输入 token 少，是"没真读材料"的客观证据
// 耗时不在 run 结果里，但在 asyncDir/status.json 的 steps[0].durationMs（父会话去读）
function effortOf(row, text) {
  const single = row && Array.isArray(row.results) && row.results[0] ? row.results[0] : null;
  const usage = single && single.usage ? single.usage : null;
  return {
    chars: text.length,
    turns: usage && typeof usage.turns === "number" ? usage.turns : null,
    inputTokens: usage && typeof usage.input === "number" ? usage.input : null,
    cost: usage && typeof usage.cost === "number" ? usage.cost : null,
    asyncDir: row && typeof row.asyncDir === "string" ? row.asyncDir : null,
  };
}

// 有的供应商网关会在回答里塞一段 harness 报告（实测 gpt-6.1-sol 开头就是 ```acceptance-report 的 JSON）。
// 它会污染第二轮喂给别家的答案、灌大 chars、干扰票型聚类，所以整段抹掉（不限位置，实测它也可能不在开头）
// shortcut: 只认 acceptance-report 这个标签；以后发现有别的 harness 块就加进这个正则
function cleanText(raw) {
  return raw
    .replace(/(?:^|\n)[ \t]*```(?:acceptance-report|acceptance_report)[\s\S]*?```[ \t]*\n?/g, "\n")
    .trim();
}

// 问题单要求每席最后一行是【结论】<一句话>；抓不到就返回 null，由主持人自己读原文
function stanceOf(text) {
  const found = text.match(/【结论】[^\n]*/g);
  if (!found || found.length === 0) return null;
  return found[found.length - 1].replace("【结论】", "").trim();
}

function median(numbers) {
  const sorted = numbers.filter((value) => typeof value === "number").sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const names = seats.map(seatKey);

// 第一轮：同题、并行、互相隔离（context fresh，否则后面的人会被前面的答案锚定）
const round1 = await runs.all(
  seats.map((seat, index) => ({
    key: names[index],
    agent: "oracle",
    model: modelRef(seat),
    context: "fresh",
    // output 必须显式关掉：开了就会被塞一句 "Output saved to: ..." 到返回文本里，
    // 那句会跟着喂给别的席位，而且 outputReference 传不出脚本边界（拿不到真实路径）
    output: false,
    task: brief,
  })),
);

const first = round1.map((row, index) => {
  const text = cleanText(row && row.output ? String(row.output) : "");
  return {
    seat: names[index],
    model: modelRef(seats[index]),
    ok: !!(row && row.ok),
    runId: row && row.runId ? row.runId : null,
    stance: stanceOf(text),
    text: text,
    ...effortOf(row, text),
  };
});

const summary = {
  perSeat: first.map((row) => ({
    seat: row.seat,
    model: row.model,
    ok: row.ok,
    stance: row.stance,
    chars: row.chars,
    turns: row.turns,
    inputTokens: row.inputTokens,
    cost: row.cost,
    asyncDir: row.asyncDir,
  })),
  median: {
    chars: median(first.map((row) => row.chars)),
    turns: median(first.map((row) => row.turns)),
    inputTokens: median(first.map((row) => row.inputTokens)),
  },
  summariseHint:
    "按 stance 聚类成方向：按主张的可执行差异分，不按措辞分；票数=席位数量，方向内必须能一句话概括",
  timingNote:
    "耗时不在返回值里：读每个席位 asyncDir 下 status.json 的 steps[0].durationMs（结构化数据，别去解析 call trace）",
};

if (args.cross !== true) return { tag, rounds: 1, ...summary, seats: first };

// 只让第一轮真给出了答案的席位参与互评：没答案的席位没什么可修订
const live = [];
for (let index = 0; index < first.length; index += 1) {
  if (first[index].ok && first[index].runId) live.push(index);
}
if (live.length < 2) return { tag, rounds: 1, crossSkipped: "有效席位不足 2 个，跳过交叉质询", ...summary, seats: first };

// 第二轮：匿名互评。只喂别家答案、不告诉谁是谁，否则会变成"是我提的我就坚持"
const LETTERS = "ABCDEFGH";

function packetFor(self) {
  const head = [
    "【第二轮：交叉质询】下面是其他几位顾问各自独立给出的答案（已匿名，不告诉你对应谁）。",
    "你自己是顾问 " + LETTERS[self] + "，你的第一轮答案已从下面略去——你记得它，不用复述。",
    "",
  ];
  const body = [];
  for (let index = 0; index < first.length; index += 1) {
    if (index === self || !first[index].ok) continue;
    body.push("--- 顾问 " + LETTERS[index] + " ---", first[index].text, "");
  }
  const tail = [
    "只回答三点，按编号写：",
    "1. 你与他们的实质分歧（措辞差异不算分歧，没有就写「无」）",
    "2. 你被说服了什么（没有就说没有，别为了交卷硬凑）",
    "3. 你修订后的结论",
    "如果谁的判断更立得住，直接承认，不要为了保面子硬撑。不要复述他们的答案。",
  ];
  return head.concat(body, tail).join("\n");
}

// resume 的子会话会沿用第一轮那个子会话的输出路径，必须显式换一个，否则同轮两个子会话抢同一个文件
const resumed = await runs.all(
  live.map((index) => ({
    key: names[index] + "-r2",
    resume: first[index].runId,
    output: false,
    task: packetFor(index),
  })),
);

// resume 被拒的席位补一轮 fresh（带上它自己第一轮的答案）：单席位失败不许带崩整场
const stale = [];
for (let slot = 0; slot < resumed.length; slot += 1) {
  if (!(resumed[slot] && resumed[slot].ok)) stale.push(slot);
}
const retried =
  stale.length === 0
    ? []
    : await runs.all(
        stale.map((slot) => ({
          key: names[live[slot]] + "-r2-fresh",
          agent: "oracle",
          model: modelRef(seats[live[slot]]),
          context: "fresh",
          output: false,
          task: packetFor(live[slot]) + "\n\n【你自己的第一轮答案（请在它基础上修订）】\n" + first[live[slot]].text,
        })),
      );

function rowOf(index) {
  const slot = live.indexOf(index);
  if (slot < 0) return { ok: false, error: "第一轮无有效答案，未参与质询" };
  const row = resumed[slot];
  if (row && row.ok) return { ok: true, row: row, resumed: true };
  const retrySlot = stale.indexOf(slot);
  const retryRow = retrySlot < 0 ? null : retried[retrySlot];
  if (retryRow && retryRow.ok) return { ok: true, row: retryRow, resumed: false };
  return { ok: false, error: (row && row.error) || (retryRow && retryRow.error) || "质询轮失败" };
}

return {
  tag,
  rounds: 2,
  ...summary,
  anonymity: seats.map((seat, index) => names[index] + " = 顾问 " + LETTERS[index]).join(" / "),
  round1: first,
  round2: seats.map((seat, index) => {
    const result = rowOf(index);
    if (!result.ok) return { seat: names[index], ok: false, error: result.error, text: "" };
    const text = cleanText(result.row && result.row.output ? String(result.row.output) : "");
    return {
      seat: names[index],
      ok: true,
      resumed: result.resumed,
      runId: result.row && result.row.runId ? result.row.runId : null,
      stance: stanceOf(text),
      text: text,
      ...effortOf(result.row, text),
    };
  }),
};
