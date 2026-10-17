// Mirrors `src-tauri/src/features/messages/model.rs`.

export type StartFrom = "latest" | "earliest" | "offset" | "timestamp";

/** What to read: the toolbar's choices. */
export interface BrowseFilters {
  topic: string;
  /** null = all partitions */
  partition: number | null;
  from: StartFrom;
  /** Offset for "offset", epoch millis for "timestamp". */
  value: number | null;
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
}

export interface TailRequest {
  topic: string;
  /** null = all partitions */
  partition: number | null;
}

export interface Payload {
  text: string;
  encoding: "utf8" | "hex";
  size: number;
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

export interface CopyRequest {
  topic: string;
  partition: number;
  offset: number;
  targetTopic: string;
  /** null = partitioner decides (by key) */
  targetPartition: number | null;
}

/** A topic a message can be copied to. */
export interface CopyTarget {
  name: string;
  partitions: number;
}
