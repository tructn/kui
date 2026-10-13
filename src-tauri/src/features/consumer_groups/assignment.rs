use std::collections::BTreeMap;

/// Decodes the bytes of a Kafka "ConsumerProtocol" member assignment:
///
/// ```text
/// version: i16
/// topics:  i32 count, then for each: name (i16 length + UTF-8), partitions (i32 count + i32 each)
/// user_data: bytes (ignored)
/// ```
///
/// Returns an empty map if the bytes are not in that format (e.g. a non-consumer group).
pub fn decode(bytes: &[u8]) -> BTreeMap<String, Vec<i32>> {
    try_decode(bytes).unwrap_or_default()
}

fn try_decode(bytes: &[u8]) -> Option<BTreeMap<String, Vec<i32>>> {
    let mut r = Reader { bytes, pos: 0 };
    let mut topics = BTreeMap::new();

    r.i16()?; // version
    for _ in 0..r.i32()?.max(0) {
        let name_len = r.i16()?.max(0) as usize;
        let name = std::str::from_utf8(r.take(name_len)?).ok()?.to_string();
        let count = r.i32()?.max(0);
        let partitions = (0..count).map(|_| r.i32()).collect::<Option<Vec<_>>>()?;
        topics.insert(name, partitions);
    }
    Some(topics)
}

/// Minimal big-endian reader; every method returns `None` on truncated input.
struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let slice = self.bytes.get(self.pos..self.pos.checked_add(n)?)?;
        self.pos += n;
        Some(slice)
    }
    fn i16(&mut self) -> Option<i16> {
        Some(i16::from_be_bytes(self.take(2)?.try_into().ok()?))
    }
    fn i32(&mut self) -> Option<i32> {
        Some(i32::from_be_bytes(self.take(4)?.try_into().ok()?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_a_single_topic_assignment() {
        let mut b = vec![0, 1]; // version 1
        b.extend(1i32.to_be_bytes()); // 1 topic
        b.extend(6i16.to_be_bytes());
        b.extend(b"orders");
        b.extend(2i32.to_be_bytes()); // 2 partitions
        b.extend(0i32.to_be_bytes());
        b.extend(3i32.to_be_bytes());
        b.extend((-1i32).to_be_bytes()); // null user data

        assert_eq!(decode(&b), BTreeMap::from([("orders".to_string(), vec![0, 3])]));
    }

    #[test]
    fn garbage_yields_empty_map() {
        assert!(decode(&[0, 1, 0, 0, 0, 9]).is_empty());
        assert!(decode(&[]).is_empty());
    }
}
