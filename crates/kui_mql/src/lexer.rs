//! Splits a query into tokens. Positions are UTF-16 offsets, the unit the
//! webview's text inputs use, so errors can be underlined exactly.

use super::QueryError;

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    /// A bare word: a field name, keyword or function name (keywords are matched case-insensitively).
    Ident(String),
    /// A `"double quoted"` name, never a keyword.
    QuotedIdent(String),
    Str(String),
    Num(f64),
    Dot,
    Comma,
    LParen,
    RParen,
    LBracket,
    RBracket,
    Star,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Eof,
}

#[derive(Debug, Clone)]
pub struct Token {
    pub tok: Tok,
    pub start: usize,
    pub end: usize,
}

impl Token {
    /// Whether this is the bare word `keyword` (case-insensitive).
    pub fn is_keyword(&self, keyword: &str) -> bool {
        matches!(&self.tok, Tok::Ident(word) if word.eq_ignore_ascii_case(keyword))
    }
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, QueryError> {
    let chars: Vec<char> = input.chars().collect();
    // UTF-16 offset of each char index, plus one for the end.
    let mut pos = Vec::with_capacity(chars.len() + 1);
    let mut at = 0;
    for c in &chars {
        pos.push(at);
        at += c.len_utf16();
    }
    pos.push(at);

    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let start = i;
        let simple = match c {
            c if c.is_whitespace() => {
                i += 1;
                continue;
            }
            '.' if !chars.get(i + 1).is_some_and(char::is_ascii_digit) => Some(Tok::Dot),
            ',' => Some(Tok::Comma),
            '(' => Some(Tok::LParen),
            ')' => Some(Tok::RParen),
            '[' => Some(Tok::LBracket),
            ']' => Some(Tok::RBracket),
            '*' => Some(Tok::Star),
            '=' => Some(if chars.get(i + 1) == Some(&'=') {
                i += 1;
                Tok::Eq
            } else {
                Tok::Eq
            }),
            '!' if chars.get(i + 1) == Some(&'=') => {
                i += 1;
                Some(Tok::Ne)
            }
            '<' => Some(match chars.get(i + 1) {
                Some('=') => {
                    i += 1;
                    Tok::Le
                }
                Some('>') => {
                    i += 1;
                    Tok::Ne
                }
                _ => Tok::Lt,
            }),
            '>' => Some(if chars.get(i + 1) == Some(&'=') {
                i += 1;
                Tok::Ge
            } else {
                Tok::Gt
            }),
            _ => None,
        };
        if let Some(tok) = simple {
            i += 1;
            tokens.push(Token { tok, start: pos[start], end: pos[i] });
            continue;
        }

        let tok = match c {
            '\'' | '"' => {
                // SQL style: a doubled quote inside the quotes stands for one quote.
                let mut text = String::new();
                i += 1;
                loop {
                    match chars.get(i) {
                        None => {
                            let what = if c == '\'' { "text" } else { "name" };
                            return Err(QueryError::new(format!("Unclosed quoted {what}"), pos[start], pos[i]));
                        }
                        Some(&q) if q == c && chars.get(i + 1) == Some(&c) => {
                            text.push(c);
                            i += 2;
                        }
                        Some(&q) if q == c => {
                            i += 1;
                            break;
                        }
                        Some(&other) => {
                            text.push(other);
                            i += 1;
                        }
                    }
                }
                if c == '\'' { Tok::Str(text) } else { Tok::QuotedIdent(text) }
            }
            c if c.is_ascii_digit() || c == '.' || (c == '-' && next_starts_number(&chars, i + 1)) => {
                i += 1;
                while chars.get(i).is_some_and(|c| c.is_ascii_digit() || *c == '.' || *c == '_') {
                    i += 1;
                }
                // Exponent: 1e6, 2.5E-3
                if chars.get(i).is_some_and(|c| *c == 'e' || *c == 'E')
                    && (chars.get(i + 1).is_some_and(char::is_ascii_digit)
                        || (matches!(chars.get(i + 1), Some('+' | '-'))
                            && chars.get(i + 2).is_some_and(char::is_ascii_digit)))
                {
                    i += 2;
                    while chars.get(i).is_some_and(char::is_ascii_digit) {
                        i += 1;
                    }
                }
                let text: String = chars[start..i].iter().filter(|c| **c != '_').collect();
                match text.parse::<f64>() {
                    Ok(n) if !chars.get(i).is_some_and(|c| is_ident_char(*c)) => Tok::Num(n),
                    _ => {
                        while chars.get(i).is_some_and(|c| is_ident_char(*c)) {
                            i += 1;
                        }
                        return Err(QueryError::new("Not a valid number", pos[start], pos[i]));
                    }
                }
            }
            c if is_ident_start(c) => {
                i += 1;
                while chars.get(i).is_some_and(|c| is_ident_char(*c)) {
                    i += 1;
                }
                Tok::Ident(chars[start..i].iter().collect())
            }
            other => {
                return Err(QueryError::new(format!("Unexpected character '{other}'"), pos[start], pos[start + 1]));
            }
        };
        tokens.push(Token { tok, start: pos[start], end: pos[i] });
    }
    tokens.push(Token { tok: Tok::Eof, start: at, end: at });
    Ok(tokens)
}

fn next_starts_number(chars: &[char], i: usize) -> bool {
    chars
        .get(i)
        .is_some_and(|c| c.is_ascii_digit() || (*c == '.' && chars.get(i + 1).is_some_and(char::is_ascii_digit)))
}

fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_' || c == '$' || c == '@'
}

/// Field names may contain `-` (common in header names such as `x-trace-id`);
/// the language has no arithmetic, so it is never a minus sign there.
fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '$' | '@' | '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toks(input: &str) -> Vec<Tok> {
        tokenize(input).unwrap().into_iter().map(|t| t.tok).collect()
    }

    #[test]
    fn splits_operators_names_and_literals() {
        assert_eq!(
            toks("value.a-b >= -1.5 AND x <> 'it''s'"),
            vec![
                Tok::Ident("value".into()),
                Tok::Dot,
                Tok::Ident("a-b".into()),
                Tok::Ge,
                Tok::Num(-1.5),
                Tok::Ident("AND".into()),
                Tok::Ident("x".into()),
                Tok::Ne,
                Tok::Str("it's".into()),
                Tok::Eof,
            ]
        );
    }

    #[test]
    fn quoted_names_and_brackets() {
        assert_eq!(
            toks(r#"value."first name"[0][*]"#),
            vec![
                Tok::Ident("value".into()),
                Tok::Dot,
                Tok::QuotedIdent("first name".into()),
                Tok::LBracket,
                Tok::Num(0.0),
                Tok::RBracket,
                Tok::LBracket,
                Tok::Star,
                Tok::RBracket,
                Tok::Eof,
            ]
        );
    }

    #[test]
    fn positions_are_utf16_offsets() {
        let tokens = tokenize("'é😀' = x").unwrap();
        // ' é 😀(2 units) ' → 5 units
        assert_eq!((tokens[0].start, tokens[0].end), (0, 5));
        assert_eq!((tokens[2].start, tokens[2].end), (8, 9));
    }

    #[test]
    fn reports_unclosed_quotes_and_bad_numbers() {
        let e = tokenize("value = 'abc").unwrap_err();
        assert_eq!((e.message.as_str(), e.start, e.end), ("Unclosed quoted text", 8, 12));
        assert_eq!(tokenize("offset > 12abc").unwrap_err().message, "Not a valid number");
    }
}
