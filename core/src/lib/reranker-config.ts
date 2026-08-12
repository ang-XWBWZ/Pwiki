// reranker-config.ts — config.json 中 Cross-Encoder 精排配置的读写

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { configFile } from "../config.js";
import {
  DEFAULT_RERANKER_CONFIG,
  type RerankerConfig,
  type RerankerDType,
} from "./types.js";

type ConfigDocument = Record<string, unknown> & {
  reranker?: Partial<RerankerConfig>;
};

const VALID_DTYPES = new Set<RerankerDType>(["int8", "fp16", "fp32"]);

function readDocument(): ConfigDocument {
  try {
    const path = configFile();
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed as ConfigDocument : {};
  } catch {
    // 与既有 config 读取保持一致：损坏配置不会阻断基础搜索。
    return {};
  }
}

/** 读取 config.json 的 reranker 区段；未配置时始终为默认关闭。 */
export function getRerankerConfig(): RerankerConfig {
  return {
    ...DEFAULT_RERANKER_CONFIG,
    ...(readDocument().reranker ?? {}),
  };
}

/** 在写入前验证，避免把无法预测的 dtype/数值带到首次搜索。 */
export function validateRerankerConfig(config: RerankerConfig): RerankerConfig {
  if (typeof config.enabled !== "boolean") {
    throw new Error("reranker.enabled must be a boolean");
  }
  if (typeof config.model !== "string" || !config.model.trim()) {
    throw new Error("reranker.model must be a non-empty model identifier");
  }
  if (!VALID_DTYPES.has(config.dtype)) {
    throw new Error("reranker.dtype must be one of: int8, fp16, fp32");
  }
  for (const key of ["inputTopK", "outputTopK", "maxLength", "batchSize"] as const) {
    const value = config[key];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`reranker.${key} must be a positive integer`);
    }
  }
  return config;
}

/**
 * 更新现有 config.json 的 reranker 区段。保留 sources、semantic 和其它未知字段，
 * 因而不会引入第二份配置文件。
 */
export function setRerankerConfig(patch: Partial<RerankerConfig>): RerankerConfig {
  const document = readDocument();
  const next = validateRerankerConfig({
    ...DEFAULT_RERANKER_CONFIG,
    ...(document.reranker ?? {}),
    ...patch,
  });
  document.reranker = next;
  writeFileSync(configFile(), JSON.stringify(document, null, 2), "utf-8");
  return next;
}
