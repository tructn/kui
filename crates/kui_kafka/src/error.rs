use rdkafka::error::KafkaError;

/// What a Kafka call can fail with. The app wraps it in its own error type.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{}", crate::connection::describe(.0))]
    Kafka(#[from] KafkaError),
    #[error("{0}")]
    Msg(String),
}

impl Error {
    pub fn msg(m: impl Into<String>) -> Self {
        Error::Msg(m.into())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
