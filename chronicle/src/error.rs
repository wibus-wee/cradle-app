//! Error type shared by Cradle Chronicle modules.

use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::io;
use std::path::PathBuf;
use std::string::FromUtf8Error;
use std::time::SystemTimeError;

pub type ChronicleResult<T> = Result<T, ChronicleError>;

#[derive(Debug)]
pub enum ChronicleError {
    Io {
        path: Option<PathBuf>,
        source: io::Error,
    },
    InvalidArgument(String),
    Process(String),
    Time(SystemTimeError),
    Utf8(FromUtf8Error),
}

impl ChronicleError {
    pub fn io_at(path: impl Into<PathBuf>, source: io::Error) -> Self {
        Self::Io {
            path: Some(path.into()),
            source,
        }
    }
}

impl Display for ChronicleError {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { path, source } => {
                if let Some(path) = path {
                    write!(f, "I/O error at {}: {}", path.display(), source)
                } else {
                    write!(f, "I/O error: {}", source)
                }
            }
            Self::InvalidArgument(message) => write!(f, "invalid argument: {message}"),
            Self::Process(message) => write!(f, "process error: {message}"),
            Self::Time(source) => write!(f, "time error: {source}"),
            Self::Utf8(source) => write!(f, "utf8 error: {source}"),
        }
    }
}

impl Error for ChronicleError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            Self::Time(source) => Some(source),
            Self::Utf8(source) => Some(source),
            Self::InvalidArgument(_) | Self::Process(_) => None,
        }
    }
}

impl From<io::Error> for ChronicleError {
    fn from(source: io::Error) -> Self {
        Self::Io { path: None, source }
    }
}

impl From<SystemTimeError> for ChronicleError {
    fn from(source: SystemTimeError) -> Self {
        Self::Time(source)
    }
}

impl From<FromUtf8Error> for ChronicleError {
    fn from(source: FromUtf8Error) -> Self {
        Self::Utf8(source)
    }
}
