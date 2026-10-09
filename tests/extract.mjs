// 测试共用工具：从产品源码里抠出函数/常量来跑，避免测试里重写一份导致与实现漂移。
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// relativePath 相对本文件（tests/）
export function readSource(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

// 按函数名抠出源码（大括号配平）
export function grab(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`源码里找不到 function ${name}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} 的大括号不配平`);
}

export function grabConst(source, name) {
  const match = source.match(new RegExp(`const ${name} = ([^;\\n]+);`));
  if (!match) throw new Error(`源码里找不到 const ${name}`);
  return match[1];
}

// 把 TS 片段落成临时 .mts 再 import：Node 会剥掉类型标注，于是测的就是产品代码本身
// （用 .mts 而不是 .ts，避免 Node 猜测模块类型时的告警）
export async function importTs(source) {
  const file = join(mkdtempSync(join(tmpdir(), "ai-meeting-test-")), "under-test.mts");
  writeFileSync(file, source, "utf8");
  return import(pathToFileURL(file).href);
}
