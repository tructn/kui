use crate::model::Body;

/// Request and response bodies are cut to this for display.
pub const BODY_LIMIT: usize = 16 * 1024;

pub fn body(bytes: &[u8]) -> Body {
    let truncated = bytes.len() > BODY_LIMIT;
    let shown = &bytes[..bytes.len().min(BODY_LIMIT)];
    Body { text: String::from_utf8_lossy(shown).into_owned(), truncated }
}

pub fn preview(bytes: &[u8], max_chars: usize) -> String {
    // A char is at most 4 bytes, so this is enough input for `max_chars`.
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(max_chars * 4)]);
    match text.char_indices().nth(max_chars) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text.into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bodies_and_keys_are_cut_for_display() {
        let big = body(&vec![b'x'; BODY_LIMIT + 1]);
        assert!(big.truncated);
        assert_eq!(big.text.len(), BODY_LIMIT);
        assert!(!body(b"{}").truncated);
        assert_eq!(preview("é".repeat(200).as_bytes(), 3), "ééé…");
        assert_eq!(preview(b"short", 10), "short");
    }
}
