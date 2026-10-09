/**
 * /ai-meeting:config —— 配置多模型会议的席位
 *
 * 席位写在 <pi 配置目录>/ai-meeting.json，skill 开会前读这个文件。
 * 交互式流程从当前模型注册表里列供应商/模型/档位，避免手写模型 id 出错；
 * `/ai-meeting:config raw` 直接用编辑器改 JSON。
 *
 * 一条硬不变量：**坏配置绝不能被当成"没有配置"**。把两者混起来会在用户手写 JSON
 * 打错一个逗号时，静默把他的席位、name、note 覆盖成自动生成的默认四席。
 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// pi 的思考档位全集，顺序即强弱顺序
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const MAX_SEATS = 8;
// name 会被会议脚本当 workflow key，key 的合法字符集是它自己的硬约束
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type Seat = {
  provider: string;
  model: string;
  thinking: string;
  name?: string;
  note?: string;
};

type Config = {
  version: 1;
  seats: Seat[];
};

type ConfigRead =
  | { kind: "missing" }
  | { kind: "ok"; config: Config }
  | { kind: "invalid"; error: string; raw: string | null };

type ModelRegistry = ExtensionCommandContext["modelRegistry"];
type Model = ReturnType<ModelRegistry["getAvailable"]>[number];

function configPath(): string {
  return join(getAgentDir(), "ai-meeting.json");
}

// 模型自己声明的可用档位；没声明 thinkingLevelMap 时 pi 走供应商默认，所有档都给
function levelsFor(model: Model): string[] {
  const map = model.thinkingLevelMap;
  if (!map) return [...LEVELS];
  const supported = LEVELS.filter((level) => {
    const value = (map as Record<string, unknown>)[level];
    return value !== null && value !== undefined;
  });
  return supported.length > 0 ? supported : [...LEVELS];
}

// 默认档位取中档：既不是关掉思考，也不默认烧最多 token
function defaultLevel(model: Model): string {
  const levels = levelsFor(model);
  if (levels.includes("medium")) return "medium";
  if (levels.includes("high")) return "high";
  const nonMax = levels.filter((level) => level !== "max");
  return nonMax.length > 0 ? nonMax[nonMax.length - 1] : levels[levels.length - 1];
}

function chatModels(registry: ModelRegistry): Model[] {
  return registry.getAvailable().filter((model) => !model.type || model.type === "chat");
}

// 跨供应商轮转取席，同一模型 id 只取一次——别名供应商会让四席其实是同一个模型
function defaultSeats(registry: ModelRegistry, preferredProvider?: string): Seat[] {
  const models = chatModels(registry);
  const providers = [...new Set(models.map((model) => model.provider))].sort();
  if (preferredProvider && providers.includes(preferredProvider)) {
    providers.splice(providers.indexOf(preferredProvider), 1);
    providers.unshift(preferredProvider);
  }
  const used = new Set<string>();
  const picked: Seat[] = [];
  for (let round = 0; picked.length < 4; round += 1) {
    let added = false;
    for (const provider of providers) {
      const model = models.filter((candidate) => candidate.provider === provider)[round];
      if (!model || picked.length >= 4 || used.has(model.id)) continue;
      used.add(model.id);
      picked.push({ provider, model: model.id, thinking: defaultLevel(model) });
      added = true;
    }
    if (!added) break;
  }
  return picked.map((seat, index) => ({ ...seat, name: `seat${index + 1}` }));
}

// 三种结果分开返回：读不到（missing）/ 读得到但坏了（invalid）/ 正常（ok）
function readConfig(file: string): ConfigRead {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return { kind: "missing" };
    // 读不动（权限等）不等于没有：当成 invalid，绝不覆盖
    return { kind: "invalid", error: error instanceof Error ? error.message : String(error), raw: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { kind: "invalid", error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`, raw };
  }
  const problems = validateShape(parsed);
  if (problems.length > 0) return { kind: "invalid", error: problems.join("；"), raw };
  return { kind: "ok", config: parsed as Config };
}

function describe(config: Config): string {
  return config.seats
    .map((seat, index) => {
      const label = seat.name ? `${index + 1}. ${seat.name}` : `${index + 1}.`;
      return `${label}  ${seat.provider}/${seat.model}  :${seat.thinking}${seat.note ? `  ${seat.note}` : ""}`;
    })
    .join("\n");
}

function writeConfig(file: string, config: Config): void {
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

// print/json 模式下 ctx.ui.notify 是空操作，错误会被完全吞掉（连个输都没有）——那种时候必须打到 stdout
function report(ctx: ExtensionCommandContext, message: string, type: "info" | "error" = "info"): void {
  if (ctx.hasUI) ctx.ui.notify(message, type);
  else console.log(message);
}

// 只查结构，够不够开会由 validate 判；输入可能是任何合法 JSON，所以不许抛异常
function validateShape(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return ["顶层必须是一个对象"];
  const seats = (config as { seats?: unknown }).seats;
  if (!Array.isArray(seats)) return ["seats 必须是数组"];
  return [];
}

// 返回问题描述数组；空数组代表通过。同样是任何合法 JSON 进来都不许抛（raw 路径直接喂它）
function validate(config: unknown, registry: ModelRegistry): string[] {
  const shape = validateShape(config);
  if (shape.length > 0) return shape;
  const seats = (config as Config).seats;
  const problems: string[] = [];
  if (seats.length === 0) problems.push("seats 不能为空");
  if (seats.length > MAX_SEATS) problems.push(`席位最多 ${MAX_SEATS} 个`);
  const names = new Set<string>();
  const models = new Set<string>();
  seats.forEach((seat, index) => {
    const where = `第 ${index + 1} 席`;
    if (!seat || typeof seat !== "object") {
      problems.push(`${where} 必须是对象`);
      return;
    }
    if (!seat.provider || !seat.model) problems.push(`${where} 缺 provider 或 model`);
    if (!LEVELS.includes(seat.thinking)) problems.push(`${where} 的档位 ${seat.thinking} 不是 pi 认识的档位`);
    if (seat.name !== undefined) {
      if (typeof seat.name !== "string" || !NAME_PATTERN.test(seat.name)) {
        problems.push(`${where} 的 name「${seat.name}」只能用字母数字和 . _ -，且以字母数字开头`);
      } else if (names.has(seat.name)) {
        problems.push(`${where} 的 name「${seat.name}」和前面的席位重名（会把两席合成一席）`);
      } else {
        names.add(seat.name);
      }
    }
    if (seat.provider && seat.model) {
      const ref = `${seat.provider}/${seat.model}`;
      if (models.has(ref)) problems.push(`${where} 的 ${ref} 和其他席位是同一个模型（不算独立视角）`);
      else models.add(ref);
      if (!registry.find(seat.provider, seat.model)) {
        problems.push(`${where} 的 ${ref} 不在当前模型注册表里`);
      }
    }
  });
  return problems;
}

// 交互式选席：供应商 → 模型 → 档位，逐席走一遍
async function pickSeats(ctx: ExtensionCommandContext, current: Seat[]): Promise<Seat[] | undefined> {
  const counts = ["2", "3", "4（推荐）", "5"];
  const countChoice = await ctx.ui.select("会议席位数（不同模型才算独立视角）", counts);
  if (!countChoice) return undefined;
  const count = Number.parseInt(countChoice, 10);

  const models = chatModels(ctx.modelRegistry);
  const providers = [...new Set(models.map((model) => model.provider))].sort();
  if (providers.length === 0) {
    report(ctx, "当前没有可用模型，先用 /login 配置供应商", "error");
    return undefined;
  }

  const seats: Seat[] = [];
  for (let index = 0; index < count; index += 1) {
    const where = `席位 ${index + 1}/${count}`;
    const provider = await ctx.ui.select(`${where}：供应商`, providers);
    if (!provider) return undefined;
    const candidates = models.filter((model) => model.provider === provider);
    const modelChoice = await ctx.ui.select(
      `${where}：模型（${provider}）`,
      candidates.map((model) => model.id),
    );
    if (!modelChoice) return undefined;
    const model = candidates.find((candidate) => candidate.id === modelChoice);
    if (!model) return undefined;
    const levels = levelsFor(model);
    const level = await ctx.ui.select(`${where}：思考档位（${model.id} 支持这些）`, levels);
    if (!level) return undefined;
    // 保留手写的 name/note，重配同序号席位时不要丢
    const previous = current[index];
    seats.push({
      provider,
      model: model.id,
      thinking: level,
      name: previous?.name ?? `seat${index + 1}`,
      ...(previous?.note ? { note: previous.note } : {}),
    });
  }
  return seats;
}

// 直接编辑 JSON：保存时校验，不合法就带着原文重新打开（draft 是文本，坏配置也能进来修）
async function editRaw(ctx: ExtensionCommandContext, draft: string): Promise<Config | undefined> {
  let text = draft;
  for (;;) {
    const input = await ctx.ui.editor("ai-meeting.json（保存后校验，Esc 取消）", text);
    if (input === undefined) return undefined;
    text = input;
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      ctx.ui.notify(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`, "error");
      continue;
    }
    const problems = validate(parsed, ctx.modelRegistry);
    if (problems.length > 0) {
      const proceed = await ctx.ui.confirm("配置有问题，仍要保存？", problems.join("\n"));
      if (!proceed) continue;
    }
    return parsed as Config;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("ai-meeting:config", {
    description: "配置多模型会议的席位（供应商/模型/思考档位）",
    handler: async (args, ctx) => {
      const file = configPath();
      const useRaw = args.trim() === "raw";
      const read = readConfig(file);

      // 坏配置且不是"手工修"模式：报错停下，一个字都不写
      if (read.kind === "invalid" && (!useRaw || !ctx.hasUI)) {
        report(
          ctx,
          `配置文件有问题，已停下、不做任何改动：${file}\n${read.error}\n修好后重跑，或用 /ai-meeting:config raw 在这里改`,
          "error",
        );
        return;
      }

      let config: Config | undefined = read.kind === "ok" ? read.config : undefined;
      if (read.kind === "missing") {
        const seats = defaultSeats(ctx.modelRegistry, ctx.model?.provider);
        if (seats.length === 0) {
          report(ctx, "当前没有可用模型，先用 /login 配置供应商", "error");
          return;
        }
        config = { version: 1, seats };
        writeConfig(file, config);
        report(ctx, `已按当前可用模型生成默认配置：${file}`);
      }

      // 非交互模式（pi -p / json）：只保证文件存在，让模型自己读
      if (!ctx.hasUI) {
        console.log(`ai-meeting 配置：${file}\n${config ? describe(config) : ""}`);
        return;
      }

      if (useRaw) {
        // 坏配置就把原文交给编辑器（用户能看见自己打错在哪）
        const draft = config ? `${JSON.stringify(config, null, 2)}\n` : (read.raw ?? "{\n  \"version\": 1,\n  \"seats\": []\n}\n");
        const edited = await editRaw(ctx, draft);
        if (!edited) {
          report(ctx, "已取消，配置未改动");
          return;
        }
        writeConfig(file, edited);
        report(ctx, `已写入 ${file}\n${describe(edited)}`);
        return;
      }

      const seats = await pickSeats(ctx, config ? config.seats : []);
      if (!seats) {
        report(ctx, "已取消，配置未改动");
        return;
      }
      const next: Config = { ...(config ?? { version: 1, seats }), version: 1, seats };
      const problems = validate(next, ctx.modelRegistry);
      if (problems.length > 0) {
        const proceed = await ctx.ui.confirm("配置有问题，仍要保存？", problems.join("\n"));
        if (!proceed) {
          report(ctx, "已取消，配置未改动");
          return;
        }
      }
      writeConfig(file, next);
      report(ctx, `已写入 ${file}\n${describe(next)}`);
    },
  });
}
