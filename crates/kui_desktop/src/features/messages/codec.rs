use super::headers::RawHeader;
use super::model::{MessageHeader, Payload};

/// Bytes of displayed text one page may hold. Hex triples binary payloads, so
/// without a cap a page of large binary records would exhaust memory.
pub const PAGE_BYTE_BUDGET: usize = 32 * 1024 * 1024;

/// What a payload may still show once the budget is spent, so every row stays recognisable.
const MIN_PREVIEW: usize = 1024;

/// Displayed text still available to a page.
pub struct Budget {
    left: usize,
}

impl Budget {
    pub fn new(bytes: usize) -> Self {
        Self { left: bytes }
    }

    pub fn unlimited() -> Self {
        Self::new(usize::MAX)
    }

    fn spend(&mut self, bytes: usize) {
        self.left = self.left.saturating_sub(bytes);
    }
}

/// What a message is read for: the UI's pages, the UI's live tail, or a file.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Mode {
    /// Payloads and headers are cut to the page budget.
    Page,
    /// Headers are cut to the batch budget; payloads stay whole until a message is kept.
    Tail,
    /// Nothing is cut: a file must hold what is on the topic.
    Export,
}

pub const MAX_HEADERS: usize = 128;
/// Header text one message may show, before the page budget.
pub const HEADERS_TOTAL_CAP: usize = 256 * 1024;
const HEADER_VALUE_CAP: usize = 64 * 1024;
const HEADER_NAME_CAP: usize = 256;
const HEADER_MIN_PREVIEW: usize = 128;

/// Header text for the UI. Each message shows at most `MAX_HEADERS` headers and `HEADERS_TOTAL_CAP`
/// bytes of them, and what it shows also draws on (and is cut by) the page `budget`. Headers
/// carry no `truncated` flag, so cuts are said in the text itself. `Mode::Export` keeps all.
pub fn headers_text(raw: Vec<RawHeader<'_>>, total: usize, mode: Mode, budget: &mut Budget) -> Vec<MessageHeader> {
    if mode == Mode::Export {
        return raw
            .into_iter()
            .map(|h| MessageHeader { key: h.name, value: h.value.map(|v| decode_cut(v, usize::MAX).text) })
            .collect();
    }

    let mut left = HEADERS_TOTAL_CAP;
    let mut shown = Vec::with_capacity(raw.len() + 1);
    for h in raw.into_iter().take(MAX_HEADERS) {
        let mut key = h.name;
        if key.len() > HEADER_NAME_CAP {
            let mut end = HEADER_NAME_CAP;
            while !key.is_char_boundary(end) {
                end -= 1;
            }
            key.truncate(end);
            key.push('…');
        }
        let value = h.value.map(|v| {
            let allowed = HEADER_VALUE_CAP.min(left).min(budget.left).max(HEADER_MIN_PREVIEW);
            let p = decode_cut(v, allowed);
            budget.spend(p.text.len());
            left = left.saturating_sub(p.text.len());
            if p.truncated { format!("{} … [truncated, {} bytes in total]", p.text, p.size) } else { p.text }
        });
        budget.spend(key.len());
        left = left.saturating_sub(key.len());
        shown.push(MessageHeader { key, value });
    }
    if total > shown.len() {
        shown
            .push(MessageHeader { key: "…".into(), value: Some(format!("{} headers omitted", total - shown.len())) });
    }
    shown
}

/// Cuts an already decoded payload to what `budget` allows, like `decode_within`. Lets a
/// message be filtered on its full text first and shrunk only if it is kept.
pub fn shrink(payload: &mut Payload, budget: &mut Budget) {
    let allowed = budget.left.max(MIN_PREVIEW);
    if payload.text.len() > allowed {
        let mut end = if payload.encoding == "hex" { (allowed.saturating_add(1) / 3) * 3 - 1 } else { allowed };
        while !payload.text.is_char_boundary(end) {
            end -= 1;
        }
        payload.text.truncate(end);
        payload.truncated = true;
    }
    budget.spend(payload.text.len());
}

/// Shows bytes as text when they are UTF-8, otherwise as space-separated hex.
#[cfg(test)]
pub fn decode(bytes: &[u8]) -> Payload {
    decode_within(bytes, &mut Budget::unlimited())
}

/// `decode`, cutting the text to what `budget` allows (never less than `MIN_PREVIEW`)
/// and flagging it. Only the shown prefix is ever rendered, so a huge binary
/// payload doesn't allocate its full hex form.
pub fn decode_within(bytes: &[u8], budget: &mut Budget) -> Payload {
    let payload = decode_cut(bytes, budget.left.max(MIN_PREVIEW));
    budget.spend(payload.text.len());
    payload
}

fn decode_cut(bytes: &[u8], allowed: usize) -> Payload {
    match std::str::from_utf8(bytes) {
        Ok(text) => {
            let mut end = text.len().min(allowed);
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            Payload { text: text[..end].to_string(), encoding: "utf8", size: bytes.len(), truncated: end < text.len() }
        }
        Err(_) => {
            // "xx " per byte, minus the trailing space.
            let shown = bytes.len().min(allowed.saturating_add(1) / 3);
            Payload {
                text: bytes[..shown].iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" "),
                encoding: "hex",
                size: bytes.len(),
                truncated: shown < bytes.len(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_is_kept_as_text() {
        assert_eq!(decode(b"{\"a\":1}").text, "{\"a\":1}");
        assert_eq!(decode("héllo".as_bytes()).encoding, "utf8");
    }

    #[test]
    fn binary_becomes_hex() {
        let p = decode(&[0x00, 0xff, 0x10]);
        assert_eq!(p.encoding, "hex");
        assert_eq!(p.text, "00 ff 10");
        assert_eq!(p.size, 3);
        assert!(!p.truncated);
    }

    #[test]
    fn spent_budget_truncates_but_keeps_size_and_a_preview() {
        let big = vec![0xffu8; 100_000];
        let mut budget = Budget::new(10);
        let p = decode_within(&big, &mut budget);
        assert!(p.truncated);
        assert_eq!(p.size, 100_000);
        assert!(p.text.len() <= MIN_PREVIEW);
        assert!(p.text.starts_with("ff ff"));
        // Already spent: the next payload still gets a preview, not nothing.
        let q = decode_within(&big, &mut budget);
        assert!(q.truncated && !q.text.is_empty());
    }

    #[test]
    fn shrinking_matches_decoding_within_the_same_budget() {
        for bytes in [vec![0xffu8; 5000], b"a".repeat(5000)] {
            let mut shrunk = decode(&bytes);
            shrink(&mut shrunk, &mut Budget::new(0));
            assert_eq!(shrunk, decode_within(&bytes, &mut Budget::new(0)));
            assert!(shrunk.truncated && shrunk.size == 5000);
        }
    }

    fn raw<'a>(name: &str, value: &'a [u8]) -> RawHeader<'a> {
        RawHeader { name: name.to_string(), value: Some(value) }
    }

    fn shown_bytes(headers: &[MessageHeader]) -> usize {
        headers.iter().map(|h| h.key.len() + h.value.as_ref().map_or(0, String::len)).sum()
    }

    #[test]
    fn a_huge_header_value_is_cut_and_says_so() {
        let huge = vec![b'x'; HEADER_VALUE_CAP + 10];
        let headers = headers_text(vec![raw("a", b"value"), raw("b", &huge)], 2, Mode::Page, &mut Budget::unlimited());
        assert_eq!(headers[0].value.as_deref(), Some("value"));
        let cut = headers[1].value.as_deref().unwrap();
        assert!(
            cut.len() < HEADER_VALUE_CAP + 200 && cut.contains("truncated") && cut.contains(&huge.len().to_string())
        );
    }

    #[test]
    fn too_many_headers_are_cut_with_a_marker_header() {
        let many: Vec<_> = (0..1000).map(|i| raw(&format!("h{i}"), b"v")).collect();
        let kept = many.into_iter().take(MAX_HEADERS).collect();
        let headers = headers_text(kept, 1000, Mode::Page, &mut Budget::unlimited());
        assert_eq!(headers.len(), MAX_HEADERS + 1);
        let last = headers.last().unwrap();
        assert_eq!(last.key, "…");
        assert_eq!(last.value.as_deref(), Some(format!("{} headers omitted", 1000 - MAX_HEADERS).as_str()));
    }

    #[test]
    fn one_messages_headers_share_a_total_cap() {
        let value = vec![b'x'; HEADER_VALUE_CAP];
        let many: Vec<_> = (0..MAX_HEADERS).map(|i| raw(&format!("h{i}"), &value)).collect();
        let headers = headers_text(many, MAX_HEADERS, Mode::Page, &mut Budget::unlimited());
        let slack = MAX_HEADERS * (HEADER_MIN_PREVIEW + HEADER_NAME_CAP + 64);
        assert!(shown_bytes(&headers) <= HEADERS_TOTAL_CAP + slack, "{}", shown_bytes(&headers));
        assert!(headers.last().unwrap().value.as_deref().unwrap().contains("truncated"));
    }

    #[test]
    fn header_bytes_count_against_the_page_budget_and_are_cut_by_it() {
        let value = vec![b'x'; 10_000];
        let mut budget = Budget::new(100);
        let headers = headers_text(vec![raw("a", &value), raw("b", &value)], 2, Mode::Page, &mut budget);
        for h in &headers {
            let text = h.value.as_deref().unwrap();
            assert!(text.len() < HEADER_MIN_PREVIEW + 100 && text.contains("truncated"), "{}", text.len());
        }
        assert_eq!(budget.left, 0);
    }

    #[test]
    fn headers_text_applies_the_count_limit_itself() {
        let many: Vec<_> = (0..1000).map(|i| raw(&format!("h{i}"), b"v")).collect();
        let headers = headers_text(many, 1000, Mode::Page, &mut Budget::unlimited());
        assert_eq!(headers.len(), MAX_HEADERS + 1);
        assert_eq!(headers[MAX_HEADERS - 1].key, format!("h{}", MAX_HEADERS - 1));
        assert_eq!(
            headers[MAX_HEADERS].value.as_deref(),
            Some(format!("{} headers omitted", 1000 - MAX_HEADERS).as_str())
        );
    }

    #[test]
    fn a_huge_header_name_is_cut_on_a_char_boundary() {
        let name = "é".repeat(HEADER_NAME_CAP * 4);
        let headers = headers_text(vec![raw(&name, b"v")], 1, Mode::Page, &mut Budget::unlimited());
        assert!(headers[0].key.len() <= HEADER_NAME_CAP + '…'.len_utf8(), "{}", headers[0].key.len());
        assert!(headers[0].key.ends_with('…'));
    }

    #[test]
    fn header_names_count_against_the_page_budget_too() {
        let name = "n".repeat(HEADER_NAME_CAP);
        let value = vec![b'x'; 500];
        let mut budget = Budget::new(1000);
        let headers = headers_text(vec![raw(&name, &value), raw(&name, &value)], 2, Mode::Page, &mut budget);
        assert_eq!(headers[0].value.as_deref().map(str::len), Some(500));
        assert!(headers[1].value.as_deref().unwrap().contains("truncated"), "names were not charged");
    }

    #[test]
    fn export_headers_are_whole_with_no_marker() {
        let value = vec![b'x'; HEADER_VALUE_CAP * 3];
        let many: Vec<_> = (0..MAX_HEADERS * 2).map(|i| raw(&format!("h{i}"), &value)).collect();
        let n = many.len();
        let headers = headers_text(many, n, Mode::Export, &mut Budget::unlimited());
        assert_eq!(headers.len(), n);
        assert!(headers.iter().all(|h| h.value.as_deref().unwrap().len() == value.len()));
    }

    #[test]
    fn budget_is_shared_across_payloads() {
        let text = "a".repeat(600);
        let mut budget = Budget::new(MIN_PREVIEW + 100);
        let first = decode_within(text.as_bytes(), &mut budget);
        assert!(!first.truncated);
        let big = "b".repeat(5000);
        let second = decode_within(big.as_bytes(), &mut budget);
        assert!(second.truncated);
        assert_eq!(second.text.len(), MIN_PREVIEW);
    }

    #[test]
    fn utf8_is_cut_on_a_char_boundary() {
        let text = "é".repeat(MIN_PREVIEW);
        let p = decode_within(text.as_bytes(), &mut Budget::new(0));
        assert!(p.truncated);
        assert_eq!(p.text.len(), MIN_PREVIEW);
    }
}
