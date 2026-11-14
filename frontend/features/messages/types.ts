// Mirrors `crates/kui_desktop/src/features/messages/model.rs`.

export type StartFrom = "latest" | "earliest" | "offset" | "timestamp";

/** What to read: the toolbar's choices. */
export interface BrowseFilters {
  topic: string;
  /** null = all partitions */
  partition: number | null;
  from: StartFrom;
  /** Offset for "offset", epoch millis for "timestamp". */
  value: number | null;
  /** SQL-like filter (MQL, see `crates/kui_mql`); null = every message. */
  query: string | null;
}

/** Per partition, the position the next page continues from (opaque to the UI). */
export type BrowseCursor = Record<string, number>;

export interface BrowseRequest extends BrowseFilters {
  pageSize: number;
  /** `next` of the previous page; null for the first page. */
  cursor: BrowseCursor | null;
}

/** One page, newest first for "latest", otherwise oldest first. */
export interface BrowsePage {
  messages: KafkaMessage[];
  /** Messages from the start position to the end (an upper bound on compacted topics). */
  total: number;
  /** Cursor for the following page; null on the last one. */
  next: BrowseCursor | null;
  /**
   * With a query: how many messages were read to find this page's matches. A
   * search stops at a budget, so a page can be short or empty while `next` remains.
   */
  scanned: number | null;
}

export interface TailRequest {
  topic: string;
  /** null = all partitions */
  partition: number | null;
  /** Only stream messages matching this filter. */
  query: string | null;
}

/** Why a query doesn't parse; `start`/`end` index into the query text. */
export interface QueryProblem {
  message: string;
  start: number;
  end: number;
}

export interface Payload {
  text: string;
  encoding: "utf8" | "hex";
  size: number;
  /** `text` is only a prefix: the page's byte budget ran out. `size` is still the full length. */
  truncated?: boolean;
}

export interface MessageHeader {
  key: string;
  value: string | null;
}

export interface KafkaMessage {
  partition: number;
  offset: number;
  timestamp: number | null;
  key: Payload | null;
  value: Payload | null;
  headers: MessageHeader[];
}

export interface ProduceRequest {
  topic: string;
  partition: number | null;
  key: string | null;
  value: string | null;
  headers: { key: string; value: string }[];
}

export interface Delivered {
  partition: number;
  offset: number;
}

/** Where one message sits in its topic. */
export interface MessageRef {
  partition: number;
  offset: number;
}

export interface CopyRequest {
  topic: string;
  /** Copied in this order. */
  messages: MessageRef[];
  targetTopic: string;
  /** null = partitioner decides (by key) */
  targetPartition: number | null;
}

export interface CopyTarget {
  name: string;
  partitions: number;
}

export type ExportFormat = "json" | "ndjson" | "csv";

export type ExportSource =
  /** Browse order from `browse` (cursor included) until `limit` messages or the end. */
  | { kind: "range"; browse: BrowseRequest; limit: number }
  /** Specific messages, e.g. the checked rows. */
  | { kind: "messages"; topic: string; messages: MessageRef[] };

export interface ExportRequest {
  source: ExportSource;
  format: ExportFormat;
}

export interface Exported {
  /** Where the file was saved. */
  path: string;
  count: number;
}
