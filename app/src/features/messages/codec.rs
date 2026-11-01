use super::model::Payload;

/// Shows bytes as text when they are UTF-8, otherwise as space-separated hex.
pub fn decode(bytes: &[u8]) -> Payload {
    match std::str::from_utf8(bytes) {
        Ok(text) => Payload { text: text.to_string(), encoding: "utf8", size: bytes.len() },
        Err(_) => Payload {
            text: bytes.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" "),
            encoding: "hex",
            size: bytes.len(),
        },
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
    }
}
