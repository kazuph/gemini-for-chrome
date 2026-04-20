export interface GeminiModelCost {
  /** USD per 1M input tokens */
  inputPer1M: number
  /** USD per 1M output tokens */
  outputPer1M: number
}

export interface GeminiModelOption {
  id: string
  label: string
  /**
   * Token pricing in USD per 1M tokens. Left undefined for custom / unknown
   * models so the UI can silently skip cost display in those cases.
   */
  cost?: GeminiModelCost
}

export interface GeminiModelGroup {
  label: string
  models: GeminiModelOption[]
}

export const CUSTOM_MODEL_VALUE = '__custom__'

// Pricing reference (2026 Q1 preview / stable pricing, USD per 1M tokens):
// - gemini-3.1-pro-preview:        input $2.00  / output $15.00 (≤200K context)
// - gemini-3-flash-preview:        input $0.30  / output $2.50  (estimated, matches 2.5 Flash)
// - gemini-3.1-flash-lite-preview: input $0.25  / output $1.50  (official preview)
// - gemini-2.5-pro:                input $1.25  / output $10.00 (≤200K context)
// - gemini-2.5-flash:              input $0.30  / output $2.50
// - gemini-2.5-flash-lite:         input $0.10  / output $0.40
// - gemini-2.0-flash:              input $0.10  / output $0.40
export const GEMINI_MODEL_GROUPS: GeminiModelGroup[] = [
  {
    label: 'Gemini 3.x (Latest Preview)',
    models: [
      {
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro (Preview) - 最新フラッグシップ推論',
        cost: { inputPer1M: 2, outputPer1M: 15 },
      },
      {
        id: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash (Preview) - 高速・バランス型',
        cost: { inputPer1M: 0.3, outputPer1M: 2.5 },
      },
      {
        id: 'gemini-3.1-flash-lite-preview',
        label: 'Gemini 3.1 Flash Lite (Preview) - 軽量・低レイテンシ',
        cost: { inputPer1M: 0.25, outputPer1M: 1.5 },
      },
    ],
  },
  {
    label: 'Gemini 2.5 (Stable)',
    models: [
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro - 高品質推論 (安定版)',
        cost: { inputPer1M: 1.25, outputPer1M: 10 },
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash - バランス型 (安定版)',
        cost: { inputPer1M: 0.3, outputPer1M: 2.5 },
      },
      {
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash Lite - 軽量 (安定版)',
        cost: { inputPer1M: 0.1, outputPer1M: 0.4 },
      },
    ],
  },
  {
    label: 'Gemini 2.0',
    models: [
      {
        id: 'gemini-2.0-flash',
        label: 'Gemini 2.0 Flash - 既定値 (後方互換)',
        cost: { inputPer1M: 0.1, outputPer1M: 0.4 },
      },
    ],
  },
]

export const ALL_KNOWN_MODEL_IDS: string[] = GEMINI_MODEL_GROUPS.flatMap((g) =>
  g.models.map((m) => m.id)
)

export function isKnownModel(id: string): boolean {
  return ALL_KNOWN_MODEL_IDS.includes(id)
}

// Local yen formatter — kept self-contained in models.ts to avoid a circular
// import with cost.ts (which type-imports GeminiModelCost from here).
const USD_TO_JPY_FOR_LABEL = 150
function formatJpyPer1MLocal(usdPer1M: number): string {
  const jpy = usdPer1M * USD_TO_JPY_FOR_LABEL
  if (jpy >= 100) return `¥${Math.round(jpy).toLocaleString('ja-JP')}`
  if (jpy >= 10) return `¥${jpy.toFixed(1)}`
  return `¥${jpy.toFixed(2)}`
}

/**
 * Build the display label used in the Settings model <select>. Appends the
 * `(入力 ¥X / 出力 ¥Y / 1Mトークン)` suffix when pricing is known.
 * Internal cost numbers stay in USD; conversion to yen happens at display time.
 */
export function modelOptionDisplayLabel(m: GeminiModelOption): string {
  if (!m.cost) return m.label
  const inp = formatJpyPer1MLocal(m.cost.inputPer1M)
  const out = formatJpyPer1MLocal(m.cost.outputPer1M)
  return `${m.label} (入力 ${inp} / 出力 ${out} / 1Mトークン)`
}

/**
 * Look up the cost definition for a given model id. Returns undefined for
 * unknown / custom models.
 */
export function getCostForModel(modelId: string): GeminiModelCost | undefined {
  for (const group of GEMINI_MODEL_GROUPS) {
    for (const m of group.models) {
      if (m.id === modelId) return m.cost
    }
  }
  return undefined
}
