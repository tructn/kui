//! Recursive-descent parser for the filter language:
//!
//! ```text
//! query     := [WHERE] or EOF
//! or        := and (OR and)*
//! and       := not (AND not)*
//! not       := NOT not | '(' or ')' | predicate
//! predicate := operand [ cmp operand | [NOT] LIKE/ILIKE/CONTAINS operand
//!                      | [NOT] IN '(' operand, … ')' | [NOT] BETWEEN operand AND operand
//!                      | IS [NOT] NULL ]
//! operand   := literal | path | function '(' operand ')'
//! path      := root ('.' name | '[' index | '*' | 'name' ']')*
//! ```

use super::QueryError;
use super::lexer::{Tok, Token, tokenize};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Root {
    Key,
    Value,
    Headers,
    Partition,
    Offset,
    Timestamp,
}

impl Root {
    pub const ALL: [(&'static str, Root); 6] = [
        ("key", Root::Key),
        ("value", Root::Value),
        ("headers", Root::Headers),
        ("partition", Root::Partition),
        ("offset", Root::Offset),
        ("timestamp", Root::Timestamp),
    ];

    fn named(name: &str) -> Option<Root> {
        Root::ALL.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, r)| *r)
    }

    /// Whether names can follow (`value.a`); the number fields have no parts.
    fn has_fields(self) -> bool {
        matches!(self, Root::Key | Root::Value | Root::Headers)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Segment {
    Field(String),
    Index(i64),
    /// `[*]`: every element of an array (or value of an object).
    Each,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Func {
    Lower,
    Upper,
    Length,
    Type,
    Trim,
}

impl Func {
    pub const ALL: [(&'static str, Func); 5] = [
        ("lower", Func::Lower),
        ("upper", Func::Upper),
        ("length", Func::Length),
        ("type", Func::Type),
        ("trim", Func::Trim),
    ];

    fn named(name: &str) -> Option<Func> {
        Func::ALL.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, f)| *f)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Literal {
    Str(String),
    Num(f64),
    Bool(bool),
    Null,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Operand {
    Literal(Literal),
    Path { root: Root, segments: Vec<Segment> },
    Call(Func, Box<Operand>),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Cmp {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TextOp {
    Like,
    ILike,
    Contains,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    And(Box<Expr>, Box<Expr>),
    Or(Box<Expr>, Box<Expr>),
    Not(Box<Expr>),
    Compare(Operand, Cmp, Operand),
    Text(Operand, TextOp, Operand),
    In(Operand, Vec<Operand>),
    Between(Operand, Operand, Operand),
    IsNull(Operand),
    /// A bare operand: true when it exists and is not `null`, `false`, `0` or `''`.
    Truthy(Operand),
}

/// Words that can't be field roots or function names, so a typo reads as an error.
const KEYWORDS: [&str; 13] =
    ["and", "or", "not", "like", "ilike", "contains", "in", "between", "is", "null", "true", "false", "where"];

pub fn parse(input: &str) -> Result<Expr, QueryError> {
    let tokens = tokenize(input)?;
    let mut p = Parser { tokens, at: 0, depth: 0, connectives: 0 };
    if p.peek().is_keyword("where") {
        p.at += 1;
    }
    if p.peek().tok == Tok::Eof {
        return Err(p.error_here("Type a condition, e.g. value.status = 'active'"));
    }
    let expr = p.or()?;
    if p.peek().tok != Tok::Eof {
        let what = if p.peek().tok == Tok::RParen { "Unmatched ')'" } else { "Expected AND, OR or the end" };
        return Err(p.error_here(what));
    }
    Ok(expr)
}

/// Parentheses, `NOT` and function calls may nest this deep. Evaluation and `Drop` recurse over
/// the tree, so unbounded input would overflow the stack, which aborts the app.
const MAX_DEPTH: usize = 64;

/// AND / OR / NOT nodes in one query. Chains grow the tree downwards without nesting, so
/// `MAX_DEPTH` alone doesn't bound recursion.
const MAX_CONNECTIVES: usize = 500;

struct Parser {
    tokens: Vec<Token>,
    at: usize,
    depth: usize,
    connectives: usize,
}

impl Parser {
    fn peek(&self) -> &Token {
        &self.tokens[self.at]
    }

    fn next(&mut self) -> Token {
        let token = self.tokens[self.at].clone();
        if token.tok != Tok::Eof {
            self.at += 1;
        }
        token
    }

    fn eat_keyword(&mut self, keyword: &str) -> bool {
        let found = self.peek().is_keyword(keyword);
        if found {
            self.at += 1;
        }
        found
    }

    fn expect(&mut self, tok: Tok, what: &str) -> Result<Token, QueryError> {
        if self.peek().tok == tok { Ok(self.next()) } else { Err(self.error_here(format!("Expected {what}"))) }
    }

    fn error_here(&self, message: impl Into<String>) -> QueryError {
        let token = self.peek();
        QueryError::new(message, token.start, token.end)
    }

    fn nested<T>(&mut self, parse: impl FnOnce(&mut Self) -> Result<T, QueryError>) -> Result<T, QueryError> {
        if self.depth >= MAX_DEPTH {
            return Err(self.error_here(format!("Too deeply nested (at most {MAX_DEPTH} levels)")));
        }
        self.depth += 1;
        let result = parse(self);
        self.depth -= 1;
        result
    }

    fn connective(&mut self) -> Result<(), QueryError> {
        self.connectives += 1;
        if self.connectives > MAX_CONNECTIVES {
            return Err(self.error_here(format!("Too many AND / OR / NOT (at most {MAX_CONNECTIVES})")));
        }
        Ok(())
    }

    fn or(&mut self) -> Result<Expr, QueryError> {
        let mut left = self.and()?;
        while self.eat_keyword("or") {
            self.connective()?;
            left = Expr::Or(Box::new(left), Box::new(self.and()?));
        }
        Ok(left)
    }

    fn and(&mut self) -> Result<Expr, QueryError> {
        let mut left = self.not()?;
        while self.eat_keyword("and") {
            self.connective()?;
            left = Expr::And(Box::new(left), Box::new(self.not()?));
        }
        Ok(left)
    }

    fn not(&mut self) -> Result<Expr, QueryError> {
        if self.eat_keyword("not") {
            self.connective()?;
            return Ok(Expr::Not(Box::new(self.nested(Self::not)?)));
        }
        if self.peek().tok == Tok::LParen {
            self.next();
            let inner = self.nested(Self::or)?;
            self.expect(Tok::RParen, "')'")?;
            return Ok(inner);
        }
        self.predicate()
    }

    fn predicate(&mut self) -> Result<Expr, QueryError> {
        let left = self.operand()?;
        let cmp = match self.peek().tok {
            Tok::Eq => Some(Cmp::Eq),
            Tok::Ne => Some(Cmp::Ne),
            Tok::Lt => Some(Cmp::Lt),
            Tok::Le => Some(Cmp::Le),
            Tok::Gt => Some(Cmp::Gt),
            Tok::Ge => Some(Cmp::Ge),
            _ => None,
        };
        if let Some(cmp) = cmp {
            self.next();
            let right = self.operand()?;
            // `x = null` reads naturally; treat it as `x IS NULL` instead of SQL's always-unknown.
            return Ok(match (&right, cmp) {
                (Operand::Literal(Literal::Null), Cmp::Eq) => Expr::IsNull(left),
                (Operand::Literal(Literal::Null), Cmp::Ne) => Expr::Not(Box::new(Expr::IsNull(left))),
                _ => Expr::Compare(left, cmp, right),
            });
        }

        if self.eat_keyword("is") {
            let negated = self.eat_keyword("not");
            if !self.eat_keyword("null") {
                return Err(self.error_here("Expected NULL"));
            }
            let expr = Expr::IsNull(left);
            return Ok(if negated { Expr::Not(Box::new(expr)) } else { expr });
        }

        let negated = self.peek().is_keyword("not")
            && ["like", "ilike", "contains", "in", "between"].iter().any(|k| self.tokens[self.at + 1].is_keyword(k));
        if negated {
            self.next();
        }
        let expr = if let Some(op) = self.text_op() {
            Expr::Text(left, op, self.operand()?)
        } else if self.eat_keyword("in") {
            self.expect(Tok::LParen, "'(' after IN")?;
            let mut items = vec![self.operand()?];
            while self.peek().tok == Tok::Comma {
                self.next();
                items.push(self.operand()?);
            }
            self.expect(Tok::RParen, "',' or ')'")?;
            Expr::In(left, items)
        } else if self.eat_keyword("between") {
            let low = self.operand()?;
            if !self.eat_keyword("and") {
                return Err(self.error_here("Expected AND in BETWEEN … AND …"));
            }
            Expr::Between(left, low, self.operand()?)
        } else {
            return match self.peek() {
                t if t.tok == Tok::Eof || t.tok == Tok::RParen || t.is_keyword("and") || t.is_keyword("or") => {
                    Ok(Expr::Truthy(left))
                }
                _ => Err(self.error_here("Expected an operator: =, !=, <, >, LIKE, CONTAINS, IN, BETWEEN or IS")),
            };
        };
        Ok(if negated { Expr::Not(Box::new(expr)) } else { expr })
    }

    fn text_op(&mut self) -> Option<TextOp> {
        let op = [("like", TextOp::Like), ("ilike", TextOp::ILike), ("contains", TextOp::Contains)]
            .into_iter()
            .find(|(word, _)| self.peek().is_keyword(word))?
            .1;
        self.next();
        Some(op)
    }

    fn operand(&mut self) -> Result<Operand, QueryError> {
        let token = self.next();
        let word = match &token.tok {
            Tok::Str(s) => return Ok(Operand::Literal(Literal::Str(s.clone()))),
            Tok::Num(n) => return Ok(Operand::Literal(Literal::Num(*n))),
            Tok::Ident(word) => word.clone(),
            Tok::Eof => return Err(QueryError::new("Expected a field or value", token.start, token.end)),
            _ => return Err(QueryError::new("Expected a field or value", token.start, token.end)),
        };
        match word.to_ascii_lowercase().as_str() {
            "true" => return Ok(Operand::Literal(Literal::Bool(true))),
            "false" => return Ok(Operand::Literal(Literal::Bool(false))),
            "null" => return Ok(Operand::Literal(Literal::Null)),
            _ => {}
        }
        if self.peek().tok == Tok::LParen {
            let func = Func::named(&word).ok_or_else(|| {
                let names: Vec<_> = Func::ALL.iter().map(|(n, _)| *n).collect();
                QueryError::new(format!("Unknown function '{word}' (use {})", names.join(", ")), token.start, token.end)
            })?;
            self.next();
            let arg = self.nested(Self::operand)?;
            self.expect(Tok::RParen, "')'")?;
            return Ok(Operand::Call(func, Box::new(arg)));
        }
        let Some(root) = Root::named(&word) else {
            let hint = if KEYWORDS.contains(&word.to_ascii_lowercase().as_str()) {
                format!("'{word}' needs a field before it")
            } else {
                format!("Unknown field '{word}': start with key, value, headers, partition, offset or timestamp")
            };
            return Err(QueryError::new(hint, token.start, token.end));
        };
        let mut segments = Vec::new();
        loop {
            match self.peek().tok {
                Tok::Dot => {
                    self.next();
                    let name = self.next();
                    match name.tok {
                        Tok::Ident(n) | Tok::QuotedIdent(n) | Tok::Str(n) => segments.push(Segment::Field(n)),
                        Tok::Num(n) if n.fract() == 0.0 && n >= 0.0 => segments.push(Segment::Field(format!("{n}"))),
                        _ => return Err(QueryError::new("Expected a field name after '.'", name.start, name.end)),
                    }
                }
                Tok::LBracket => {
                    self.next();
                    let inner = self.next();
                    segments.push(match inner.tok {
                        Tok::Star => Segment::Each,
                        Tok::Num(n) if n.fract() == 0.0 => Segment::Index(n as i64),
                        Tok::Str(n) | Tok::QuotedIdent(n) => Segment::Field(n),
                        _ => {
                            return Err(QueryError::new(
                                "Expected an index, * or 'name' inside [ ]",
                                inner.start,
                                inner.end,
                            ));
                        }
                    });
                    self.expect(Tok::RBracket, "']'")?;
                }
                _ => break,
            }
            if !root.has_fields() {
                let t = &self.tokens[self.at - 1];
                return Err(QueryError::new(format!("'{word}' is a number and has no fields"), t.start, t.end));
            }
        }
        Ok(Operand::Path { root, segments })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(root: Root, segments: &[Segment]) -> Operand {
        Operand::Path { root, segments: segments.to_vec() }
    }

    fn field(name: &str) -> Segment {
        Segment::Field(name.into())
    }

    fn s(text: &str) -> Operand {
        Operand::Literal(Literal::Str(text.into()))
    }

    #[test]
    fn and_binds_tighter_than_or() {
        let expr = parse("WHERE key = 'a' OR key = 'b' AND offset > 3").unwrap();
        let Expr::Or(_, right) = expr else { panic!("expected OR at the top, got {expr:?}") };
        assert!(matches!(*right, Expr::And(..)));
    }

    #[test]
    fn paths_with_quotes_indexes_and_wildcards() {
        let expr = parse(r#"value.items[*]."unit price"[0]['x'] >= 10"#).unwrap();
        assert_eq!(
            expr,
            Expr::Compare(
                path(Root::Value, &[field("items"), Segment::Each, field("unit price"), Segment::Index(0), field("x")]),
                Cmp::Ge,
                Operand::Literal(Literal::Num(10.0)),
            )
        );
    }

    #[test]
    fn negated_operators_and_lists() {
        assert_eq!(
            parse("headers.x-source NOT IN ('a', 'b')").unwrap(),
            Expr::Not(Box::new(Expr::In(path(Root::Headers, &[field("x-source")]), vec![s("a"), s("b")])))
        );
        assert_eq!(parse("value IS NOT NULL").unwrap(), Expr::Not(Box::new(Expr::IsNull(path(Root::Value, &[])))));
        assert!(matches!(parse("offset BETWEEN 1 AND 5 AND partition = 0").unwrap(), Expr::And(..)));
        assert!(matches!(parse("lower(value.name) NOT LIKE 'a%'").unwrap(), Expr::Not(_)));
    }

    #[test]
    fn a_bare_field_tests_truthiness() {
        assert_eq!(
            parse("value.active AND NOT value.deleted").unwrap(),
            Expr::And(
                Box::new(Expr::Truthy(path(Root::Value, &[field("active")]))),
                Box::new(Expr::Not(Box::new(Expr::Truthy(path(Root::Value, &[field("deleted")]))))),
            )
        );
    }

    #[test]
    fn errors_point_at_the_problem() {
        let e = parse("value.a = 1 AND").unwrap_err();
        assert_eq!((e.message.as_str(), e.start), ("Expected a field or value", 15));
        let e = parse("status = 'x'").unwrap_err();
        assert!(e.message.starts_with("Unknown field 'status'"));
        assert_eq!((e.start, e.end), (0, 6));
        assert_eq!(parse("value.a 'x'").unwrap_err().start, 8);
        assert_eq!(parse("(value.a = 1").unwrap_err().message, "Expected ')'");
        assert_eq!(parse("offset.x = 1").unwrap_err().message, "'offset' is a number and has no fields");
        assert!(parse("size(value) = 1").unwrap_err().message.starts_with("Unknown function"));
        assert!(parse("").is_err());
    }

    #[test]
    fn hostile_nesting_is_a_parse_error_not_a_stack_overflow() {
        let too_deep = |query: String| {
            let e = parse(&query).unwrap_err();
            assert!(e.message.starts_with("Too "), "{}", e.message);
        };
        too_deep("(".repeat(10_000) + "value.a");
        too_deep("NOT ".repeat(10_000) + "value.a");
        too_deep("lower(".repeat(10_000) + "value.a");
        too_deep(vec!["value.a"; 100_000].join(" AND "));
        too_deep(vec!["value.a"; 100_000].join(" OR "));
    }

    #[test]
    fn ordinary_nesting_and_chains_still_parse() {
        let nested = "(".repeat(MAX_DEPTH) + "value.a" + &")".repeat(MAX_DEPTH);
        assert!(parse(&nested).is_ok());
        assert!(parse(&vec!["value.a"; MAX_CONNECTIVES + 1].join(" AND ")).is_ok());
    }
}
