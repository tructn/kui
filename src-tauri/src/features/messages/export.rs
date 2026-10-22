//! Writes messages to a file as JSON, NDJSON or CSV.
//!
//! Every format has the same fields. Keys and values are text: UTF-8 as is,
//! anything else as hex, with `keyEncoding` / `valueEncoding` saying which.

use std::io::Write;

use chrono::{DateTime, SecondsFormat};
use serde::Serialize;

use super::model::{ExportFormat, Message, MessageHeader};
use crate::error::Result;

const CSV_COLUMNS: &str = "topic,partition,offset,timestamp,key,keyEncoding,value,valueEncoding,headers";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Record<'a> {
    topic: &'a str,
    partition: i32,
    offset: i64,
    /// ISO 8601 in UTC, to the millisecond.
    timestamp: Option<String>,
    key: Option<&'a str>,
    key_encoding: Option<&'a str>,
    value: Option<&'a str>,
    value_encoding: Option<&'a str>,
    headers: &'a [MessageHeader],
}

impl<'a> Record<'a> {
    fn new(topic: &'a str, m: &'a Message) -> Self {
        Record {
            topic,
            partition: m.partition,
            offset: m.offset,
            timestamp: m
                .timestamp
                .and_then(DateTime::from_timestamp_millis)
                .map(|t| t.to_rfc3339_opts(SecondsFormat::Millis, true)),
            key: m.key.as_ref().map(|p| p.text.as_str()),
            key_encoding: m.key.as_ref().map(|p| p.encoding),
            value: m.value.as_ref().map(|p| p.text.as_str()),
            value_encoding: m.value.as_ref().map(|p| p.encoding),
            headers: &m.headers,
        }
    }
}

/// Streams messages to `out` one at a time, so an export never holds them all.
pub struct ExportWriter<W: Write> {
    out: W,
    format: ExportFormat,
    topic: String,
    count: usize,
}

impl<W: Write> ExportWriter<W> {
    pub fn new(mut out: W, format: ExportFormat, topic: &str) -> Result<Self> {
        match format {
            ExportFormat::Json => out.write_all(b"[")?,
            ExportFormat::Csv => writeln!(out, "{CSV_COLUMNS}")?,
            ExportFormat::Ndjson => {}
        }
        Ok(Self { out, format, topic: topic.to_string(), count: 0 })
    }

    pub fn write(&mut self, message: &Message) -> Result<()> {
        let record = Record::new(&self.topic, message);
        match self.format {
            ExportFormat::Json => {
                self.out.write_all(if self.count == 0 { b"\n  " } else { b",\n  " })?;
                serde_json::to_writer(&mut self.out, &record)?;
            }
            ExportFormat::Ndjson => {
                serde_json::to_writer(&mut self.out, &record)?;
                self.out.write_all(b"\n")?;
            }
            ExportFormat::Csv => {
                let headers = serde_json::to_string(record.headers)?;
                let cells = [
                    csv_cell(record.topic),
                    record.partition.to_string(),
                    record.offset.to_string(),
                    record.timestamp.unwrap_or_default(),
                    record.key.map(csv_text).unwrap_or_default(),
                    record.key_encoding.unwrap_or_default().to_string(),
                    record.value.map(csv_text).unwrap_or_default(),
                    record.value_encoding.unwrap_or_default().to_string(),
                    csv_text(&headers),
                ];
                writeln!(self.out, "{}", cells.join(","))?;
            }
        }
        self.count += 1;
        Ok(())
    }

    /// Closes the document and returns how many messages were written.
    pub fn finish(mut self) -> Result<usize> {
        if self.format == ExportFormat::Json {
            self.out.write_all(if self.count == 0 { b"]\n" } else { b"\n]\n" })?;
        }
        self.out.flush()?;
        Ok(self.count)
    }
}

/// A cell holding message data. Spreadsheets run a cell starting with `=`, `+`,
/// `-` or `@` as a formula, so such text gets a leading `'` (OWASP's advice for
/// CSV injection). Plain numbers like `-1` are left alone.
fn csv_text(text: &str) -> String {
    let formula = text.starts_with(['=', '+', '-', '@', '\t', '\r']) && text.trim().parse::<f64>().is_err();
    if formula { csv_cell(&format!("'{text}")) } else { csv_cell(text) }
}

/// Quotes a cell when it holds a comma, quote or line break (RFC 4180).
fn csv_cell(text: &str) -> String {
    if text.contains([',', '"', '\n', '\r']) { format!("\"{}\"", text.replace('"', "\"\"")) } else { text.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::messages::codec::decode;

    fn message(offset: i64, key: Option<&[u8]>, value: Option<&[u8]>) -> Message {
        Message {
            partition: 1,
            offset,
            timestamp: Some(1_700_000_000_123),
            key: key.map(decode),
            value: value.map(decode),
            headers: vec![MessageHeader { key: "source".into(), value: Some("kui".into()) }],
        }
    }

    fn export(format: ExportFormat, messages: &[Message]) -> String {
        let mut out = Vec::new();
        let mut writer = ExportWriter::new(&mut out, format, "orders").unwrap();
        for m in messages {
            writer.write(m).unwrap();
        }
        assert_eq!(writer.finish().unwrap(), messages.len());
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn json_is_one_parseable_array() {
        let text = export(ExportFormat::Json, &[message(0, Some(b"k"), Some(b"{\"a\":1}")), message(1, None, None)]);
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed[0]["topic"], "orders");
        assert_eq!(parsed[0]["timestamp"], "2023-11-14T22:13:20.123Z");
        assert_eq!(parsed[0]["value"], "{\"a\":1}");
        assert_eq!(parsed[0]["valueEncoding"], "utf8");
        assert_eq!(parsed[0]["headers"][0]["key"], "source");
        assert_eq!(parsed[1]["key"], serde_json::Value::Null);
    }

    #[test]
    fn empty_json_export_is_an_empty_array() {
        let parsed: serde_json::Value = serde_json::from_str(&export(ExportFormat::Json, &[])).unwrap();
        assert_eq!(parsed, serde_json::json!([]));
    }

    #[test]
    fn ndjson_has_one_object_per_line() {
        let text = export(ExportFormat::Ndjson, &[message(0, None, Some(b"a\nb")), message(1, None, Some(&[0xff]))]);
        let lines: Vec<serde_json::Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["value"], "a\nb");
        assert_eq!((&lines[1]["value"], &lines[1]["valueEncoding"]), (&"ff".into(), &"hex".into()));
    }

    #[test]
    fn csv_quotes_cells_that_need_it() {
        let text = export(ExportFormat::Csv, &[message(7, Some(b"k,1"), Some(b"say \"hi\"\nbye"))]);
        let mut lines = text.splitn(2, '\n');
        assert_eq!(lines.next().unwrap(), CSV_COLUMNS);
        assert_eq!(
            lines.next().unwrap(),
            "orders,1,7,2023-11-14T22:13:20.123Z,\"k,1\",utf8,\"say \"\"hi\"\"\nbye\",utf8,\
             \"[{\"\"key\"\":\"\"source\"\",\"\"value\"\":\"\"kui\"\"}]\"\n"
        );
    }

    #[test]
    fn csv_defuses_spreadsheet_formulas_but_not_numbers() {
        assert_eq!(csv_text("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
        assert_eq!(csv_text("@SUM(A1)"), "'@SUM(A1)");
        assert_eq!(csv_text("-1"), "-1");
        assert_eq!(csv_text("+3.5"), "+3.5");
        assert_eq!(csv_text("-2+cmd"), "'-2+cmd");
    }
}
