//! Cradle Server integration constants and environment helpers.

use std::env;

/// Default Cradle Server URL.
pub const DEFAULT_CRADLE_URL: &str = "http://127.0.0.1:21423";

/// Read the Cradle Server base URL from `CRADLE_URL` env var or use default.
pub fn cradle_base_url() -> String {
    env::var("CRADLE_URL").unwrap_or_else(|_| DEFAULT_CRADLE_URL.to_string())
}
