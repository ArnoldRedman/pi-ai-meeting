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
// 耗时：单席位用时脚本里拿不到——实测 `results[0]` 的实际键只有 index/agent/sessionName/task/
// exitCode/usage/finalOutput/outputState/sessionFile/model/requestedModel/acceptance/artifactPaths/
// transcriptPath，没有 durationMs，也没有 progressSummary（类型里有，跨到脚本时被投影掉了）。
// 所以耗时改由父会话读每个席位 asyncDir 下 status.json 的 steps[0].durationMs。
// 返回值只能给客观数字（答案长度、turns、输入 token、cost、asyncDir），快慢判断由
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

// runs.all 的 key 有硬约束：^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$，且同一批不能重复。
// name 是用户手写在配置里的，可能带中文/空格/重名：直接当 key 会让整场在运行时失败
// （报错文本里根本不会出现 name），同名同参还会被静默复用成一份答案（两席变一席）。
function workflowKeys(labels) {
  const used = new Set();
  return labels.map((label, index) => {
    const safe = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(label) ? label : "seat" + (index + 1);
    let candidate = safe;
    for (let suffix = 2; used.has(candidate); suffix += 1) candidate = safe + "-" + suffix;
    used.add(candidate);
    return candidate;
  });
}

function modelRef(seat) {
  return seat.provider + "/" + seat.model + ":" + seat.thinking;
}

// 子会话自己的用量：turns/chars 是风格指示，lastInputTokens 只是「最后一次请求的新增输入」——
// 它不等于成本：成本看的是「请求次数 × 每次重发的上下文总量」，那个只能从 asyncDir/events.jsonl 里汇总
function effortOf(row, text) {
  const single = row && Array.isArray(row.results) && row.results[0] ? row.results[0] : null;
  const usage = single && single.usage ? single.usage : null;
  return {
    chars: text.length,
    turns: usage && typeof usage.turns === "number" ? usage.turns : null,
    lastInputTokens: usage && typeof usage.input === "number" ? usage.input : null,
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
const keys = workflowKeys(names);

// 第一轮：同题、并行、互相隔离（context fresh，否则后面的人会被前面的答案锚定）
const round1 = await runs.all(
  seats.map((seat, index) => ({
    key: keys[index],
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
    key: keys[index],
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
    lastInputTokens: row.lastInputTokens,
    cost: row.cost,
    asyncDir: row.asyncDir,
    // 没跑第二轮时立场就是第一轮的；两轮路径会把改判过的覆写成 2
    stanceRound: 1,
  })),
  median: {
    chars: median(first.map((row) => row.chars)),
    turns: median(first.map((row) => row.turns)),
  },
  summariseHint:
    "按 stance 聚类成方向：按主张的可执行差异分，不按措辞分；票数=席位数量，方向内必须能一句话概括",
  timingNote:
    "耗时不在返回值里：读每个席位 asyncDir 下 status.json 的 steps[0].durationMs（结构化数据，别去解析 call trace）",
};

if (args.cross !== true) return { tag, rounds: 1, ...summary, round1: first };

// 只让第一轮真给出了答案的席位参与互评：没答案的席位没什么可修订
const live = [];
for (let index = 0; index < first.length; index += 1) {
  if (first[index].ok && first[index].runId) live.push(index);
}
if (live.length < 2) return { tag, rounds: 1, crossSkipped: "有效席位不足 2 个，跳过交叉质询", ...summary, round1: first };

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
    // 第一轮要求过不代表这一轮会给：实测有席位改成写"修订结论"，导致 stance 抽不到
    "最后一行必须重新写一次：【结论】<你修订后的一句话主张，40 字以内>，后面不要再加内容。",
  ];
  return head.concat(body, tail).join("\n");
}

// resume 的子会话会沿用第一轮那个子会话的输出路径，必须显式换一个，否则同轮两个子会话抢同一个文件
const resumed = await runs.all(
  live.map((index) => ({
    key: keys[index] + "-r2",
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
          key: keys[live[slot]] + "-r2-fresh",
          agent: "oracle",
          model: modelRef(seats[live[slot]]),
          context: "fresh",
          output: false,
          // fresh 是没有上下文的：必须把原题单重新给它，否则它会对着一堆别人的答案
          // 回答一个它没见过的问题（不报错、不缺席，主持人只看到答非所问）
          task:
            brief +
            "\n\n========\n\n" +
            packetFor(live[slot]) +
            "\n\n【你自己的第一轮答案（请在它基础上修订）】\n" +
            first[live[slot]].text,
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

const round2 = seats.map((seat, index) => {
  const result = rowOf(index);
  if (!result.ok) return { seat: names[index], model: modelRef(seat), ok: false, error: result.error, text: "" };
  const text = cleanText(result.row && result.row.output ? String(result.row.output) : "");
  return {
    seat: names[index],
    model: modelRef(seat),
    ok: true,
    resumed: result.resumed,
    runId: result.row && result.row.runId ? result.row.runId : null,
    stance: stanceOf(text),
    text: text,
    ...effortOf(result.row, text),
  };
});

return {
  tag,
  rounds: 2,
  ...summary,
  // 票型必须用第二轮立场：第二轮出现改判时，只用第一轮的 stance 就是报旧票型（实测发生过）
  perSeat: summary.perSeat.map((row, index) => {
    const second = round2[index];
    const revised = second && second.ok && second.stance ? second.stance : null;
    return { ...row, stance: revised !== null ? revised : row.stance, stanceRound: revised !== null ? 2 : 1 };
  }),
  anonymity: seats.map((seat, index) => names[index] + " = 顾问 " + LETTERS[index]).join(" / "),
  round1: first,
  round2: round2,
};
