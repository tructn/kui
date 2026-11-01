//! The message filter: a SQL `WHERE`-style condition tested against each message.
//!
//! ```text
//! value.status = 'shipped' AND value.items[*].qty > 3
//! headers.x-source IN ('web', 'ios') OR key LIKE 'order-%'
//! timestamp >= '2026-10-01' AND lower(value.customer.name) CONTAINS 'ada'
//! ```
//!
//! `lexer` → `parser` (an `Expr` tree) → `evaluate` (per message). The UI's
//! completion (`src/features/messages/query/`) mirrors the field roots,
//! operators and functions defined here.

mod evaluate;
mod lexer;
mod parser;

use serde::Serialize;

use super::model::Message;
use crate::error::Error;

/// A parsed filter, ready to test messages.
#[derive(Debug)]
pub struct Query {
    expr: parser::Expr,
}

impl Query {
    pub fn parse(input: &str) -> Result<Query, QueryError> {
        Ok(Query { expr: parser::parse(input)? })
    }

    /// Parses `input`, or `None` when it is blank (no filter).
    pub fn optional(input: Option<&str>) -> Result<Option<Query>, Error> {
        match input.map(str::trim).filter(|q| !q.is_empty()) {
            Some(q) => Ok(Some(Query::parse(q).map_err(|e| Error::msg(format!("Invalid query: {}", e.message)))?)),
            None => Ok(None),
        }
    }

    pub fn matches(&self, message: &Message) -> bool {
        evaluate::evaluate(&self.expr, &evaluate::Doc::new(message))
    }
}

/// Why a query doesn't parse, with the UTF-16 range to underline.
#[derive(Debug, Serialize, PartialEq)]
pub struct QueryError {
    pub message: String,
    pub start: usize,
    pub end: usize,
}

impl QueryError {
    fn new(message: impl Into<String>, start: usize, end: usize) -> Self {
        QueryError { message: message.into(), start, end }
    }
}
