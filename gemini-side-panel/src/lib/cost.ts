import type { GeminiModelCost } from './models'

/**
 * Token usage reported by Gemini SDK `response.usageMetadata` aggregated after
 * a stream completes.
 */
export interface GeminiUsage {
  promptTokenCount: number
  candidatesTokenCount: number
  totalTokenCount: number
}

/**
 * Compute the USD spend for a single model response given its usage metadata
 * and the model's cost table. Returns 0 for models with unknown pricing.
 */
export function computeSpendUsd(usage: GeminiUsage, cost?: GeminiModelCost): number {
  if (!cost) return 0
  return (
    (usage.promptTokenCount * cost.inputPer1M + usage.candidatesTokenCount * cost.outputPer1M) /
    1_000_000
  )
}

// Fixed USD → JPY rate used for display. Actual Gemini billing is in USD so we
// keep the source-of-truth internal numbers in USD and only convert at the UI
// boundary. Bump this if you want a sharper approximation (公式請求値は別途確認)。
export const USD_TO_JPY_RATE = 150

/** Convert a USD amount to yen for display. */
export function usdToJpy(usd: number): number {
  return usd * USD_TO_JPY_RATE
}

/**
 * Format a USD amount as a yen string for the UI (小さい金額は小数2桁、
 * 大きくなるほど整数側に寄せる)。
 */
export function formatJpy(usd: number): string {
  const jpy = usdToJpy(usd)
  if (jpy === 0) return '¥0'
  if (jpy < 1) return `¥${jpy.toFixed(3)}` // ¥0.123
  if (jpy < 100) return `¥${jpy.toFixed(2)}` // ¥12.34
  return `¥${Math.round(jpy).toLocaleString('ja-JP')}` // ¥1,234
}

/**
 * Format a per-1M-token USD price as ¥ per 1M tokens (model selector labels).
 */
export function formatJpyPer1M(usdPer1M: number): string {
  const jpy = usdPer1M * USD_TO_JPY_RATE
  if (jpy >= 100) return `¥${Math.round(jpy).toLocaleString('ja-JP')}`
  if (jpy >= 10) return `¥${jpy.toFixed(1)}`
  return `¥${jpy.toFixed(2)}`
}
