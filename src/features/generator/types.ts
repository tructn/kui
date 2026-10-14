// Mirrors `src-tauri/src/features/generator/model.rs`.

export const LOCALES = [
  { value: "en", label: "English" },
  { value: "fr_fr", label: "French" },
  { value: "de_de", label: "German" },
  { value: "it_it", label: "Italian" },
  { value: "nl_nl", label: "Dutch" },
  { value: "pt_br", label: "Portuguese (BR)" },
  { value: "ja_jp", label: "Japanese" },
  { value: "zh_cn", label: "Chinese" },
] as const;

export type Locale = (typeof LOCALES)[number]["value"];

export interface RecordTemplate {
  /** Empty = no key. */
  key: string | null;
  value: string;
  headers: { key: string; value: string }[];
  locale: Locale;
}

export interface GenerateRequest {
  topic: string;
  partition: number | null;
  template: RecordTemplate;
  count: number;
  /** Messages per second; null = as fast as possible. */
  rate: number | null;
}

export interface GeneratedRecord {
  key: string | null;
  value: string;
  headers: { key: string; value: string }[];
}

export interface GenerateProgress {
  total: number;
  sent: number;
  failed: number;
  firstError: string | null;
  elapsedMs: number;
}

export interface GeneratorInfo {
  name: string;
  example: string;
  description: string;
}
