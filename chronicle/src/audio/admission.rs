//! Privacy-first admission policy for passive audio capture.

use crate::config::AudioCaptureMode;

const MEETING_SIGNAL_HOLD_WINDOWS: u8 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioAdmissionController {
    mode: AudioCaptureMode,
    meeting_signal_hold: u8,
}

impl AudioAdmissionController {
    pub fn new(mode: AudioCaptureMode) -> Self {
        Self {
            mode,
            meeting_signal_hold: 0,
        }
    }

    pub fn admit(&mut self, visual_meeting_signal: bool, speech_detected: bool) -> bool {
        if visual_meeting_signal {
            self.meeting_signal_hold = MEETING_SIGNAL_HOLD_WINDOWS;
        } else {
            self.meeting_signal_hold = self.meeting_signal_hold.saturating_sub(1);
        }

        if !speech_detected {
            return false;
        }

        match self.mode {
            AudioCaptureMode::Continuous => true,
            AudioCaptureMode::Meeting => visual_meeting_signal || self.meeting_signal_hold > 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AudioAdmissionController;
    use crate::config::AudioCaptureMode;

    #[test]
    fn meeting_mode_requires_visual_signal_and_speech() {
        let mut controller = AudioAdmissionController::new(AudioCaptureMode::Meeting);
        assert!(!controller.admit(false, true));
        assert!(!controller.admit(true, false));
        assert!(controller.admit(true, true));
    }

    #[test]
    fn meeting_mode_holds_brief_visual_signal_dropouts() {
        let mut controller = AudioAdmissionController::new(AudioCaptureMode::Meeting);
        assert!(controller.admit(true, true));
        assert!(controller.admit(false, true));
        assert!(!controller.admit(false, true));
    }

    #[test]
    fn continuous_mode_still_requires_detected_speech() {
        let mut controller = AudioAdmissionController::new(AudioCaptureMode::Continuous);
        assert!(!controller.admit(false, false));
        assert!(controller.admit(false, true));
    }
}
