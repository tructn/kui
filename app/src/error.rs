use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{}", kui_kafka::connection::describe(.0))]
    Kafka(#[from] rdkafka::error::KafkaError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Updater(#[from] tauri_plugin_updater::Error),
    #[error("{0}")]
    Msg(String),
}

// Kafka-layer errors fold into the matching variants, so callers see one type.
impl From<kui_kafka::Error> for Error {
    fn from(e: kui_kafka::Error) -> Self {
        match e {
            kui_kafka::Error::Kafka(e) => Error::Kafka(e),
            kui_kafka::Error::Msg(m) => Error::Msg(m),
        }
    }
}

impl Error {
    pub fn msg(m: impl Into<String>) -> Self {
        Error::Msg(m.into())
    }
}

// Tauri needs command errors to be serializable; the frontend only needs the message.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
