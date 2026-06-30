//! UTC timestamp helpers for artifact and evidence names.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::error::ChronicleResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Timestamp {
    seconds_since_epoch: u64,
}

impl Timestamp {
    pub fn now() -> ChronicleResult<Self> {
        Self::from_system_time(SystemTime::now())
    }

    pub fn from_seconds(seconds_since_epoch: u64) -> Self {
        Self {
            seconds_since_epoch,
        }
    }

    pub fn from_system_time(value: SystemTime) -> ChronicleResult<Self> {
        let duration = value.duration_since(UNIX_EPOCH)?;
        Ok(Self::from_seconds(duration.as_secs()))
    }

    pub fn seconds_since_epoch(self) -> u64 {
        self.seconds_since_epoch
    }

    pub fn filesystem(self) -> String {
        let parts = self.parts();
        format!(
            "{:04}-{:02}-{:02}T{:02}-{:02}-{:02}Z",
            parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second
        )
    }

    pub fn compact(self) -> String {
        let parts = self.parts();
        format!(
            "{:04}{:02}{:02}{:02}{:02}{:02}",
            parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second
        )
    }

    fn parts(self) -> TimestampParts {
        let days = (self.seconds_since_epoch / 86_400) as i64;
        let seconds_of_day = self.seconds_since_epoch % 86_400;
        let (year, month, day) = civil_from_days(days);
        TimestampParts {
            year,
            month,
            day,
            hour: seconds_of_day / 3_600,
            minute: (seconds_of_day % 3_600) / 60,
            second: seconds_of_day % 60,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TimestampParts {
    year: i64,
    month: u64,
    day: u64,
    hour: u64,
    minute: u64,
    second: u64,
}

fn civil_from_days(days_since_epoch: i64) -> (i64, u64, u64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    (year, month as u64, day as u64)
}

pub fn timestamp_after_seconds(seconds_since_epoch: u64, offset: u64) -> Timestamp {
    Timestamp::from_seconds(seconds_since_epoch + offset)
}

pub fn system_time_after_epoch(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(seconds)
}

#[cfg(test)]
mod tests {
    use super::{Timestamp, system_time_after_epoch};

    #[test]
    fn formats_unix_epoch() {
        let timestamp = Timestamp::from_seconds(0);
        assert_eq!(timestamp.filesystem(), "1970-01-01T00-00-00Z");
        assert_eq!(timestamp.compact(), "19700101000000");
    }

    #[test]
    fn formats_recent_utc_timestamp() {
        let timestamp = Timestamp::from_system_time(system_time_after_epoch(1_779_125_791))
            .expect("timestamp should format");
        assert_eq!(timestamp.filesystem(), "2026-05-18T17-36-31Z");
        assert_eq!(timestamp.compact(), "20260518173631");
    }
}
