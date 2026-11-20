use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("Runtime error: {0}")]
    Runtime(String),
    #[error("Cancelled")]
    Cancelled,
}

impl From<AppError> for String {
    fn from(err: AppError) -> Self {
        err.to_string()
    }
}

pub type AppResult<T> = Result<T, AppError>;
