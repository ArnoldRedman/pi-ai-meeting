// meeting.js 里两段纯文本逻辑的自检：cleanText（抹掉 harness 报告块）与 stanceOf（抓【结论】行）
//
//   node tests/clean-text.test.mjs
import assert from "node:assert/strict";
import { grab, readSource } from "./extract.mjs";

const src = readSource("../skills/ai-meeting/references/meeting.js");
const cleanText = eval(`(${grab(src, "cleanText")})`);
const stanceOf = eval(`(${grab(src, "stanceOf")})`);

// 真实抓到的污染样本：gpt-6.1-sol 在一次普通表态里自己塞的 acceptance-report 块
const polluted = '```acceptance-report\n{\n  "criteriaSatisfied": [{"id": "criterion-1", "status": "satisfied"}],\n  "changedFiles": []\n}\n```\n\n① 首轮应形成结论并标明分歧。\n\n【结论】首轮先出结论，有实质分歧再开第二轮。';
const clean = "先展示各方向的票型图。\n\n【结论】先给出各方向的票型图，再给出主持人的汇总意见。";
const midline = '正文第一段。\n\n```acceptance-report\n{"x":1}\n```\n\n【结论】块在中间也要抹掉。';

// 1) 剥块：不管在开头还是中间
assert.ok(!cleanText(polluted).includes("acceptance-report"), "开头那块没被剥掉");
assert.ok(!cleanText(midline).includes("acceptance-report"), "中间那块没被剥掉");
assert.ok(cleanText(polluted).includes("① 首轮应形成结论"), "剥块时误删了正文");
assert.ok(cleanText(midline).includes("正文第一段。"), "剥中块时误删了正文");

// 2) 干净样本必须原样返回（不能误伤正常回答）
assert.equal(cleanText(clean), clean, "干净样本被改动了");

// 3) 抓结论行：末次出现优先，抓不到返回 null
assert.equal(stanceOf(cleanText(polluted)), "首轮先出结论，有实质分歧再开第二轮。");
assert.equal(stanceOf(cleanText(clean)), "先给出各方向的票型图，再给出主持人的汇总意见。");
assert.equal(stanceOf("没有结论行"), null, "没有【结论】时应返回 null");
assert.equal(stanceOf("【结论】第一版\n又改了\n【结论】最终版"), "最终版", "应取最后一次出现的结论");

console.log("cleanText / stanceOf 自检通过");
