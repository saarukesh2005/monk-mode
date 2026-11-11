use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Refused(String),
    #[error("File error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Data format error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Crypto(String),
}

impl AppError {
    pub fn invalid(msg: impl Into<String>) -> Self {
        Self::Invalid(msg.into())
    }
    pub fn refused(msg: impl Into<String>) -> Self {
        Self::Refused(msg.into())
    }
}

/// Commands return errors to the UI as plain user-facing strings.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
