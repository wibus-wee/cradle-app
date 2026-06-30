//! Privacy-sensitive window filtering for captured frames.

use crate::screen::{BrowserWindowObservation, CapturedFrame};

const CHROME_BUNDLES: &[&str] = &[
    "com.google.Chrome",
    "com.google.Chrome.beta",
    "com.google.Chrome.canary",
    "com.google.Chrome.dev",
];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PrivacyFilterRules {
    pub app_bundle_ids: Vec<String>,
    pub title_patterns: Vec<String>,
    pub url_patterns: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct PrivacyFilter {
    rules: PrivacyFilterRules,
}

impl PrivacyFilter {
    pub fn new(rules: PrivacyFilterRules) -> Self {
        Self { rules }
    }

    pub fn should_exclude_windows(&self, windows: &[BrowserWindowObservation]) -> bool {
        windows
            .iter()
            .any(|window| self.is_privacy_sensitive_window(window))
    }

    pub fn should_exclude_frame(&self, frame: &CapturedFrame) -> bool {
        self.should_exclude_windows(&frame.windows)
    }

    pub fn is_privacy_sensitive_window(&self, window: &BrowserWindowObservation) -> bool {
        let name = window.name.to_ascii_lowercase();
        let bundle = window.app_bundle_identifier.as_str();
        let url = window.url.as_deref().unwrap_or("").to_ascii_lowercase();

        let is_chrome = CHROME_BUNDLES.contains(&bundle);
        let is_safari =
            bundle == "com.apple.Safari" || bundle == "com.apple.SafariTechnologyPreview";

        window.is_private
            || (is_chrome && (name.contains("incognito") || name.contains("(incognito)")))
            || (is_safari && name.contains("private browsing"))
            || name.contains("private browsing")
            || name.contains("google meet")
            || url.contains("meet.google.com")
            || self.matches_configured_bundle(bundle)
            || self.matches_configured_pattern(&name, &self.rules.title_patterns)
            || self.matches_configured_pattern(&url, &self.rules.url_patterns)
    }

    fn matches_configured_bundle(&self, bundle: &str) -> bool {
        self.rules
            .app_bundle_ids
            .iter()
            .any(|configured| configured.eq_ignore_ascii_case(bundle))
    }

    fn matches_configured_pattern(&self, value: &str, patterns: &[String]) -> bool {
        patterns
            .iter()
            .map(|pattern| pattern.trim().to_ascii_lowercase())
            .filter(|pattern| !pattern.is_empty())
            .any(|pattern| value.contains(&pattern))
    }
}

#[cfg(test)]
mod tests {
    use crate::screen::{
        AccessibilityCapture, AccessibilityCaptureStatus, BrowserWindowObservation, CapturedFrame,
    };
    use crate::time::Timestamp;

    use super::{PrivacyFilter, PrivacyFilterRules};

    fn frame(window: BrowserWindowObservation) -> CapturedFrame {
        let windows = vec![window];
        CapturedFrame {
            display_id: 1,
            frame_index: 1,
            captured_at: Timestamp::from_seconds(1),
            bytes: b"frame".to_vec(),
            frame_extension: "jpg".to_string(),
            observed_text: "frame".to_string(),
            accessibility: AccessibilityCapture::from_windows(
                &windows,
                AccessibilityCaptureStatus::Ready,
            ),
            windows,
        }
    }

    #[test]
    fn excludes_chrome_incognito() {
        let filter = PrivacyFilter::default();
        let window = BrowserWindowObservation::new(1, "Search (Incognito)", "com.google.Chrome");

        assert!(filter.should_exclude_frame(&frame(window)));
    }

    #[test]
    fn excludes_google_meet_by_url() {
        let filter = PrivacyFilter::default();
        let window = BrowserWindowObservation::new(1, "Team Call", "com.google.Chrome")
            .with_url("https://meet.google.com/abc-defg-hij");

        assert!(filter.should_exclude_frame(&frame(window)));
    }

    #[test]
    fn allows_regular_cradle_window() {
        let filter = PrivacyFilter::default();
        let window = BrowserWindowObservation::new(1, "Cradle", "app.cradle.desktop");

        assert!(!filter.should_exclude_frame(&frame(window)));
    }

    #[test]
    fn excludes_configured_bundle_id() {
        let filter = PrivacyFilter::new(PrivacyFilterRules {
            app_bundle_ids: vec!["com.apple.Terminal".to_string()],
            title_patterns: vec![],
            url_patterns: vec![],
        });
        let window = BrowserWindowObservation::new(1, "Build Logs", "com.apple.Terminal");

        assert!(filter.should_exclude_frame(&frame(window)));
    }

    #[test]
    fn excludes_configured_title_pattern() {
        let filter = PrivacyFilter::new(PrivacyFilterRules {
            app_bundle_ids: vec![],
            title_patterns: vec!["bank dashboard".to_string()],
            url_patterns: vec![],
        });
        let window =
            BrowserWindowObservation::new(1, "Personal Bank Dashboard", "com.apple.Safari");

        assert!(filter.should_exclude_frame(&frame(window)));
    }

    #[test]
    fn excludes_configured_url_pattern() {
        let filter = PrivacyFilter::new(PrivacyFilterRules {
            app_bundle_ids: vec![],
            title_patterns: vec![],
            url_patterns: vec!["admin.example.com".to_string()],
        });
        let window = BrowserWindowObservation::new(1, "Admin", "com.google.Chrome")
            .with_url("https://admin.example.com/settings");

        assert!(filter.should_exclude_frame(&frame(window)));
    }
}
