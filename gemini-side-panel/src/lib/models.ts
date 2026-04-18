export interface GeminiModelOption {
  id: string
  label: string
}

export interface GeminiModelGroup {
  label: string
  models: GeminiModelOption[]
}

export const CUSTOM_MODEL_VALUE = '__custom__'

export const GEMINI_MODEL_GROUPS: GeminiModelGroup[] = [
  {
    label: 'Gemini 3.1 (Latest Preview)',
    models: [
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview) - 最新フラッグシップ推論' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview) - 高速・バランス型' },
      { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite (Preview) - 超軽量・低レイテンシ' },
    ],
  },
  {
    label: 'Gemini 2.5 (Stable)',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro - 高品質推論 (安定版)' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash - バランス型 (安定版)' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite - 軽量 (安定版)' },
    ],
  },
  {
    label: 'Gemini 2.0',
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash - 既定値 (後方互換)' },
    ],
  },
]

export const ALL_KNOWN_MODEL_IDS: string[] = GEMINI_MODEL_GROUPS.flatMap((g) =>
  g.models.map((m) => m.id)
)

export function isKnownModel(id: string): boolean {
  return ALL_KNOWN_MODEL_IDS.includes(id)
}
