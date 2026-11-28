#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Kafka(#[from] kui_kafka::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Msg(String),
}

impl Error {
    pub fn msg(m: impl Into<String>) -> Self {
        Error::Msg(m.into())
    }
}

impl From<rdkafka::error::KafkaError> for Error {
    fn from(e: rdkafka::error::KafkaError) -> Self {
        Error::Kafka(e.into())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
