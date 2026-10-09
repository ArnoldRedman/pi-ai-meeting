/**
 * /ai-meeting:config —— 配置多模型会议的席位
 *
 * 席位写在 <pi 配置目录>/ai-meeting.json，skill 开会前读这个文件。
 * 交互式流程从当前模型注册表里列供应商/模型/档位，避免手写模型 id 出错；
 * `/ai-meeting:config raw` 直接用编辑器改 JSON。
 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// pi 的思考档位全集，顺序即强弱顺序
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const MAX_SEATS = 8;

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

function readConfig(file: string): Config | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Config;
    return Array.isArray(parsed?.seats) ? parsed : undefined;
  } catch {
    // 文件不存在或不是合法 JSON；两种情况都由调用方决定怎么处理
    return undefined;
  }
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

// 返回问题描述数组；空数组代表通过
function validate(config: Config, registry: ModelRegistry): string[] {
  const problems: string[] = [];
  if (config.seats.length === 0) problems.push("seats 不能为空");
  if (config.seats.length > MAX_SEATS) problems.push(`席位最多 ${MAX_SEATS} 个`);
  config.seats.forEach((seat, index) => {
    const where = `第 ${index + 1} 席`;
    if (!seat.provider || !seat.model) problems.push(`${where} 缺 provider 或 model`);
    if (!LEVELS.includes(seat.thinking)) problems.push(`${where} 的档位 ${seat.thinking} 不是 pi 认识的档位`);
    if (seat.provider && seat.model && !registry.find(seat.provider, seat.model))
      problems.push(`${where} 的 ${seat.provider}/${seat.model} 不在当前模型注册表里`);
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
    ctx.ui.notify("当前没有可用模型，先用 /login 配置供应商", "error");
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

// 直接编辑 JSON：保存时校验，不合法就带着原文重新打开
async function editRaw(
  ctx: ExtensionCommandContext,
  file: string,
  config: Config,
): Promise<Config | undefined> {
  let draft = JSON.stringify(config, null, 2);
  for (;;) {
    const text = await ctx.ui.editor("ai-meeting.json（保存后校验，Esc 取消）", draft);
    if (text === undefined) return undefined;
    draft = text;
    let parsed: Config;
    try {
      parsed = JSON.parse(text) as Config;
    } catch (error) {
      ctx.ui.notify(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`, "error");
      continue;
    }
    const problems = validate(parsed, ctx.modelRegistry);
    if (problems.length > 0) {
      const proceed = await ctx.ui.confirm("配置有问题，仍要保存？", problems.join("\n"));
      if (!proceed) continue;
    }
    return parsed;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("ai-meeting:config", {
    description: "配置多模型会议的席位（供应商/模型/思考档位）",
    handler: async (args, ctx) => {
      const file = configPath();
      let config = readConfig(file);
      if (!config) {
        const seats = defaultSeats(ctx.modelRegistry, ctx.model?.provider);
        if (seats.length === 0) {
          ctx.ui.notify("当前没有可用模型，先用 /login 配置供应商", "error");
          return;
        }
        config = { version: 1, seats };
        writeConfig(file, config);
        ctx.ui.notify(`已按当前可用模型生成默认配置：${file}`, "info");
      }

      // 非交互模式（pi -p / json）：只保证文件存在，让模型自己读
      if (!ctx.hasUI) {
        console.log(`ai-meeting 配置：${file}\n${describe(config)}`);
        return;
      }

      const useRaw = args.trim() === "raw";
      const seats = useRaw ? undefined : await pickSeats(ctx, config.seats);
      if (!useRaw && !seats) {
        ctx.ui.notify("已取消，配置未改动", "info");
        return;
      }

      const next: Config = { ...config, version: 1, seats: seats ?? config.seats };
      const edited = useRaw ? await editRaw(ctx, file, next) : next;
      if (!edited) {
        ctx.ui.notify("已取消，配置未改动", "info");
        return;
      }

      writeConfig(file, edited);
      ctx.ui.notify(`已写入 ${file}\n${describe(edited)}`, "info");
    },
  });
}
