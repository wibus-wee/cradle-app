//! Meeting detection heuristics for Chronicle.

use crate::screen::{AccessibilityCapture, BrowserWindowObservation};
use crate::time::Timestamp;

/// Known meeting application bundle identifiers.
const MEETING_BUNDLES: &[&str] = &[
    "us.zoom.xos",
    "us.zoom.videomeeting",
    "com.microsoft.teams",
    "com.microsoft.teams2",
    "com.webex.meetingmanager",
    "com.cisco.webexmeetings",
    "com.whereby.Whereby",
    "com.around.Around",
    "com.loom.desktop",
];

/// URL patterns that indicate a meeting.
const MEETING_URL_PATTERNS: &[&str] = &[
    "meet.google.com",
    "zoom.us/wc/",
    "zoom.us/j/",
    "teams.microsoft.com/l/meetup",
    "whereby.com/",
    "webex.com/meet",
    "around.co/",
];

/// Keywords in accessibility text that suggest an active meeting.
const MEETING_KEYWORDS: &[&str] = &[
    "Mute",
    "Unmute",
    "Camera",
    "Screen Share",
    "End Meeting",
    "Leave",
    "Participants",
    "Start Video",
    "Stop Video",
    "Share Screen",
];

/// Result of meeting detection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeetingDetection {
    pub is_meeting: bool,
    pub meeting_app: Option<String>,
    pub meeting_title: Option<String>,
    pub confidence: MeetingConfidence,
    pub detected_at: Timestamp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeetingConfidence {
    /// Known meeting app in foreground.
    High,
    /// Meeting URL detected.
    Medium,
    /// Heuristic guess (multiple meeting-related UI elements).
    Low,
    /// Not a meeting.
    None,
}

/// Detect if the current screen state indicates a meeting.
pub fn detect_meeting(
    windows: &[BrowserWindowObservation],
    accessibility: &AccessibilityCapture,
    now: Timestamp,
) -> MeetingDetection {
    // Check for known meeting app windows.
    for window in windows {
        if is_meeting_bundle(&window.app_bundle_identifier) {
            return MeetingDetection {
                is_meeting: true,
                meeting_app: Some(window.app_bundle_identifier.clone()),
                meeting_title: Some(window.name.clone()),
                confidence: MeetingConfidence::High,
                detected_at: now,
            };
        }
    }

    // Check for meeting URLs.
    for window in windows {
        if let Some(url) = &window.url
            && MEETING_URL_PATTERNS.iter().any(|p| url.contains(p))
        {
            return MeetingDetection {
                is_meeting: true,
                meeting_app: Some(window.app_bundle_identifier.clone()),
                meeting_title: Some(window.name.clone()),
                confidence: MeetingConfidence::Medium,
                detected_at: now,
            };
        }
    }

    // Check accessibility text for meeting keywords.
    let keyword_count = MEETING_KEYWORDS
        .iter()
        .filter(|kw| {
            accessibility.text.contains(*kw)
                || accessibility
                    .elements
                    .iter()
                    .any(|el| el.label.contains(*kw))
        })
        .count();

    if keyword_count >= 3 {
        return MeetingDetection {
            is_meeting: true,
            meeting_app: None,
            meeting_title: None,
            confidence: MeetingConfidence::Low,
            detected_at: now,
        };
    }

    MeetingDetection {
        is_meeting: false,
        meeting_app: None,
        meeting_title: None,
        confidence: MeetingConfidence::None,
        detected_at: now,
    }
}

/// Check if a specific window is a meeting window.
pub fn is_meeting_window(window: &BrowserWindowObservation) -> bool {
    if is_meeting_bundle(&window.app_bundle_identifier) {
        return true;
    }
    if let Some(url) = &window.url {
        return MEETING_URL_PATTERNS.iter().any(|p| url.contains(p));
    }
    false
}

/// Check if a bundle identifier is a known meeting app.
pub fn is_meeting_bundle(bundle_id: &str) -> bool {
    MEETING_BUNDLES.contains(&bundle_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::screen::{AccessibilityCaptureStatus, AccessibilityElementObservation};

    fn empty_accessibility() -> AccessibilityCapture {
        AccessibilityCapture {
            status: AccessibilityCaptureStatus::Ready,
            provider: "test".to_string(),
            text: String::new(),
            elements: vec![],
        }
    }

    fn make_window(bundle: &str, name: &str) -> BrowserWindowObservation {
        BrowserWindowObservation {
            id: 1,
            name: name.to_string(),
            app_bundle_identifier: bundle.to_string(),
            url: None,
            is_private: false,
        }
    }

    fn now() -> Timestamp {
        Timestamp::from_seconds(1_700_000_000)
    }

    #[test]
    fn detects_zoom_meeting() {
        let windows = vec![make_window("us.zoom.xos", "Zoom Meeting")];
        let result = detect_meeting(&windows, &empty_accessibility(), now());
        assert!(result.is_meeting);
        assert_eq!(result.confidence, MeetingConfidence::High);
        assert_eq!(result.meeting_app.as_deref(), Some("us.zoom.xos"));
    }

    #[test]
    fn detects_google_meet_url() {
        let mut window = make_window("com.google.Chrome", "Meeting - Google Meet");
        window.url = Some("https://meet.google.com/abc-defg-hij".to_string());
        let windows = vec![window];
        let result = detect_meeting(&windows, &empty_accessibility(), now());
        assert!(result.is_meeting);
        assert_eq!(result.confidence, MeetingConfidence::Medium);
    }

    #[test]
    fn detects_microsoft_teams() {
        let windows = vec![make_window("com.microsoft.teams2", "Teams Call")];
        let result = detect_meeting(&windows, &empty_accessibility(), now());
        assert!(result.is_meeting);
        assert_eq!(result.confidence, MeetingConfidence::High);
        assert_eq!(result.meeting_app.as_deref(), Some("com.microsoft.teams2"));
    }

    #[test]
    fn returns_no_meeting_for_normal_app() {
        let windows = vec![make_window("com.apple.Safari", "Apple")];
        let result = detect_meeting(&windows, &empty_accessibility(), now());
        assert!(!result.is_meeting);
        assert_eq!(result.confidence, MeetingConfidence::None);
    }

    #[test]
    fn accessibility_keywords_boost_confidence() {
        let windows = vec![make_window("com.apple.Safari", "Some Page")];
        let elements = vec![
            AccessibilityElementObservation {
                role: "button".to_string(),
                label: "Mute".to_string(),
                value: None,
                app_bundle_identifier: "com.apple.Safari".to_string(),
                window_id: Some(1),
                depth: 0,
                path: "/0".to_string(),
            },
            AccessibilityElementObservation {
                role: "button".to_string(),
                label: "Camera".to_string(),
                value: None,
                app_bundle_identifier: "com.apple.Safari".to_string(),
                window_id: Some(1),
                depth: 0,
                path: "/1".to_string(),
            },
            AccessibilityElementObservation {
                role: "button".to_string(),
                label: "Screen Share".to_string(),
                value: None,
                app_bundle_identifier: "com.apple.Safari".to_string(),
                window_id: Some(1),
                depth: 0,
                path: "/2".to_string(),
            },
        ];
        let accessibility = AccessibilityCapture {
            status: AccessibilityCaptureStatus::Ready,
            provider: "test".to_string(),
            text: "Mute Camera Screen Share".to_string(),
            elements,
        };
        let result = detect_meeting(&windows, &accessibility, now());
        assert!(result.is_meeting);
        assert_eq!(result.confidence, MeetingConfidence::Low);
    }
}
