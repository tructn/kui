//! TQL, the topic query language: a SQL `WHERE`-style condition tested
//! against each message of a Kafka topic.
//!
//! ```text
//! value.status = 'shipped' AND value.items[*].qty > 3
//! headers.x-source IN ('web', 'ios') OR key LIKE 'order-%'
//! timestamp >= '2026-10-01' AND lower(value.customer.name) CONTAINS 'ada'
//! ```
//!
//! `lexer` → `parser` (an `Expr` tree) → `evaluate` (per message). Messages
//! come in through the [`Record`] trait, so this crate knows nothing about
//! Kafka clients. The UI's completion (`src/features/messages/query/`)
//! mirrors the field roots, operators and functions defined here.

mod evaluate;
mod lexer;
mod parser;

use std::fmt;

use serde::Serialize;

/// A parsed filter, ready to test messages.
#[derive(Debug)]
pub struct Query {
    expr: parser::Expr,
}

impl Query {
    pub fn parse(input: &str) -> Result<Query, QueryError> {
        Ok(Query { expr: parser::parse(input)? })
    }

    pub fn matches<R: Record + ?Sized>(&self, record: &R) -> bool {
        evaluate::evaluate(&self.expr, &evaluate::Doc::new(record))
    }
}

/// One message as the query sees it.
pub trait Record {
    fn partition(&self) -> i32;
    fn offset(&self) -> i64;
    /// Epoch millis.
    fn timestamp(&self) -> Option<i64>;
    fn key(&self) -> Option<Payload<'_>>;
    fn value(&self) -> Option<Payload<'_>>;
    /// Headers in order, as (name, value); a null header has no value.
    fn headers(&self) -> impl Iterator<Item = (&str, Option<&str>)>;
}

/// A key or value as displayed.
#[derive(Debug, Clone, Copy)]
pub struct Payload<'a> {
    pub text: &'a str,
    /// The bytes were valid UTF-8, so `text` may be JSON. Otherwise `text` is
    /// a rendering (such as hex) and is only matched as plain text.
    pub utf8: bool,
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

impl fmt::Display for QueryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for QueryError {}
