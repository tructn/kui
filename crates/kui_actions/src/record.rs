/// A consumed message, owned so it can wait in a partition queue.
#[derive(Debug, Clone, PartialEq)]
pub struct Record {
    pub topic: String,
    pub partition: i32,
    pub offset: i64,
    pub timestamp: Option<i64>,
    pub timestamp_type: TimestampType,
    pub key: Option<Vec<u8>>,
    pub value: Option<Vec<u8>>,
    pub headers: Vec<(String, Option<Vec<u8>>)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimestampType {
    CreateTime,
    LogAppendTime,
    NotAvailable,
}

#[cfg(test)]
impl Record {
    pub(crate) fn sample(partition: i32, offset: i64) -> Self {
        Record {
            topic: "t".into(),
            partition,
            offset,
            timestamp: None,
            timestamp_type: TimestampType::NotAvailable,
            key: Some(b"k".to_vec()),
            value: None,
            headers: Vec::new(),
        }
    }
}
