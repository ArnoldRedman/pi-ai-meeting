// 守两件不能退化的事：
//   1. 坏配置绝不能被当成"没有配置"（否则用户手写的席位/name/note 会被静默覆盖）
//   2. 任何合法 JSON 喂给校验都不许抛异常（raw 编辑器路径会直接把用户的输入喂进来）
//
//   node tests/config.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grab, grabConst, importTs, readSource } from "./extract.mjs";

const ext = readSource("../extensions/ai-meeting.ts");
const mod = await importTs(
  [
    'import { readFileSync } from "node:fs";',
    "type Config = any; type Seat = any; type ModelRegistry = any;",
    `const LEVELS = ${grabConst(ext, "LEVELS")};`,
    `const MAX_SEATS = ${grabConst(ext, "MAX_SEATS")};`,
    `const NAME_PATTERN = ${grabConst(ext, "NAME_PATTERN")};`,
    grab(ext, "validateShape"),
    grab(ext, "validate"),
    grab(ext, "readConfig"),
    "export { validate, readConfig };",
  ].join("\n"),
);
const { validate, readConfig } = mod;

// 模型都在注册表里，除非点名说不存在
const registry = { find: (provider, model) => model !== "missing-model" };
const seat = (over = {}) => ({ provider: "zhuzi", model: "m1", thinking: "medium", ...over });

// ---- 1) 合法 JSON 不许抛，且结构错误要说清 ----
const shapeCases = [
  [null, "顶层必须是一个对象"],
  [undefined, "顶层必须是一个对象"],
  [{}, "seats 必须是数组"],
  [{ seats: "x" }, "seats 必须是数组"],
  [[], "顶层必须是一个对象"],
  [{ seats: {} }, "seats 必须是数组"],
];
for (const [input, expected] of shapeCases) {
  let out;
  assert.doesNotThrow(() => {
    out = validate(input, registry);
  }, `validate(${JSON.stringify(input)}) 抛异常了`);
  assert.ok(out.includes(expected), `validate(${JSON.stringify(input)}) 应包含「${expected}」，实际 ${JSON.stringify(out)}`);
}
console.log("结构错误不再抛异常（原来 null / {} / {seats:[null]} / {seats:'x'} 全抛 TypeError）");

// 席位本身不是对象
assert.deepEqual(validate({ seats: [null] }, registry), ["第 1 席 必须是对象"]);

// ---- 2) name：会被当 workflow key，非法字符/重名都要拦 ----
const badName = validate({ seats: [seat({ name: "我的席位" })] }, registry);
assert.ok(badName.some((p) => p.includes("name")), `中文 name 应被拦，实际 ${JSON.stringify(badName)}`);
assert.ok(validate({ seats: [seat({ name: "has space" })] }, registry).some((p) => p.includes("name")), "带空格 name 应被拦");
const dupName = validate({ seats: [seat({ name: "sol" }), seat({ model: "m2", name: "sol" })] }, registry);
assert.ok(dupName.some((p) => p.includes("重名")), `重名应被拦，实际 ${JSON.stringify(dupName)}`);
assert.deepEqual(validate({ seats: [seat({ name: "sol" }), seat({ model: "m2", name: "astra" })] }, registry), []);

// ---- 3) 同一个模型出现两次不算独立视角 ----
const dupModel = validate({ seats: [seat(), seat()] }, registry);
assert.ok(dupModel.some((p) => p.includes("同一个模型")), `重复模型应被提示，实际 ${JSON.stringify(dupModel)}`);

// ---- 4) 档位与注册表 ----
assert.ok(validate({ seats: [seat({ thinking: "ultra" })] }, registry).some((p) => p.includes("档位")));
assert.ok(validate({ seats: [seat({ model: "missing-model" })] }, registry).some((p) => p.includes("注册表")));
assert.deepEqual(validate({ seats: [seat()] }, registry), [], "正常一席不该报问题");
assert.deepEqual(validate({ seats: [] }, registry), ["seats 不能为空"]);

// ---- 5) readConfig：missing / invalid / ok 三分，且坏文件不许被吞成 missing ----
const dir = mkdtempSync(join(tmpdir(), "ai-meeting-cfg-"));
const missing = join(dir, "nope.json");
assert.equal(readConfig(missing).kind, "missing", "文件不存在应为 missing");

const broken = join(dir, "broken.json");
writeFileSync(broken, '{ "version": 1, "seats": [ }', "utf8");
const brokenRead = readConfig(broken);
assert.equal(brokenRead.kind, "invalid", "坏 JSON 必须是 invalid，不能是 missing（否则会被默认配置覆盖）");
assert.ok(brokenRead.raw.includes("seats"), "invalid 要带上原文，好让编辑器里能改");
assert.ok(readFileSync(broken, "utf8").startsWith('{ "version": 1'), "readConfig 不许写文件");

const wrongShape = join(dir, "shape.json");
writeFileSync(wrongShape, '{"version":1,"seats":{"a":1}}', "utf8");
assert.equal(readConfig(wrongShape).kind, "invalid", "seats 不是数组也是 invalid");

const good = join(dir, "good.json");
writeFileSync(good, JSON.stringify({ version: 1, seats: [seat()] }), "utf8");
const goodRead = readConfig(good);
assert.equal(goodRead.kind, "ok", "正常配置应为 ok");
assert.equal(goodRead.config.seats.length, 1);

console.log("readConfig 三分正确，坏配置不会被当成没有配置");
console.log("config 自检通过");
