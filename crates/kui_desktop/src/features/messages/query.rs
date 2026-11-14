//! Connects messages to the MQL filter (the `kui_mql` crate).

pub use kui_mql::{Query, QueryError};

use super::model::{Message, Payload};
use crate::error::{Error, Result};

/// Parses `input`, or `None` when it is blank (no filter).
pub fn optional(input: Option<&str>) -> Result<Option<Query>> {
    match input.map(str::trim).filter(|q| !q.is_empty()) {
        Some(q) => Ok(Some(Query::parse(q).map_err(|e| Error::msg(format!("Invalid query: {e}")))?)),
        None => Ok(None),
    }
}

impl kui_mql::Record for Message {
    fn partition(&self) -> i32 {
        self.partition
    }

    fn offset(&self) -> i64 {
        self.offset
    }

    fn timestamp(&self) -> Option<i64> {
        self.timestamp
    }

    fn key(&self) -> Option<kui_mql::Payload<'_>> {
        self.key.as_ref().map(payload)
    }

    fn value(&self) -> Option<kui_mql::Payload<'_>> {
        self.value.as_ref().map(payload)
    }

    fn headers(&self) -> impl Iterator<Item = (&str, Option<&str>)> {
        self.headers.iter().map(|h| (h.key.as_str(), h.value.as_deref()))
    }
}

fn payload(p: &Payload) -> kui_mql::Payload<'_> {
    kui_mql::Payload { text: &p.text, utf8: p.encoding == "utf8" }
}
