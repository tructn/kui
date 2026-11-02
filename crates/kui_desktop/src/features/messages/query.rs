//! Connects messages to the TQL filter (the `kui_tql` crate).

pub use kui_tql::{Query, QueryError};

use super::model::{Message, Payload};
use crate::error::{Error, Result};

/// Parses `input`, or `None` when it is blank (no filter).
pub fn optional(input: Option<&str>) -> Result<Option<Query>> {
    match input.map(str::trim).filter(|q| !q.is_empty()) {
        Some(q) => Ok(Some(Query::parse(q).map_err(|e| Error::msg(format!("Invalid query: {e}")))?)),
        None => Ok(None),
    }
}

impl kui_tql::Record for Message {
    fn partition(&self) -> i32 {
        self.partition
    }

    fn offset(&self) -> i64 {
        self.offset
    }

    fn timestamp(&self) -> Option<i64> {
        self.timestamp
    }

    fn key(&self) -> Option<kui_tql::Payload<'_>> {
        self.key.as_ref().map(payload)
    }

    fn value(&self) -> Option<kui_tql::Payload<'_>> {
        self.value.as_ref().map(payload)
    }

    fn headers(&self) -> impl Iterator<Item = (&str, Option<&str>)> {
        self.headers.iter().map(|h| (h.key.as_str(), h.value.as_deref()))
    }
}

fn payload(p: &Payload) -> kui_tql::Payload<'_> {
    kui_tql::Payload { text: &p.text, utf8: p.encoding == "utf8" }
}
