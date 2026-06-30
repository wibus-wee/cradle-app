//! macOS native capture source for Cradle Chronicle.

#[cfg(target_os = "macos")]
mod native {
    use std::collections::HashSet;
    use std::collections::VecDeque;
    use std::ffi::{c_uchar, c_void};
    use std::ptr;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc::{self, Receiver, Sender, SyncSender, TryRecvError, TrySendError};
    use std::thread;
    use std::time::Duration;

    use core_foundation::array::{CFArray, CFArrayGetTypeID};
    use core_foundation::base::{CFGetTypeID, CFRelease, CFTypeID, CFTypeRef, TCFType};
    use core_foundation::string::{CFString, CFStringGetTypeID, CFStringRef};
    use core_graphics::display::CGDisplay;
    use core_graphics::image::CGImage;
    use core_graphics::window::{
        kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
        kCGWindowName, kCGWindowNumber, kCGWindowOwnerName, kCGWindowOwnerPID,
    };
    use foreign_types::ForeignType;

    // Link frameworks needed for FFI calls
    #[link(name = "AppKit", kind = "framework")]
    unsafe extern "C" {}
    #[link(name = "Vision", kind = "framework")]
    unsafe extern "C" {}

    use crate::error::{ChronicleError, ChronicleResult};
    use crate::screen::privacy_filter::PrivacyFilter;
    use crate::screen::{
        AccessibilityCapture, AccessibilityCaptureStatus, AccessibilityElementObservation,
        BrowserWindowObservation, CaptureSource, CapturedFrame,
    };
    use crate::time::Timestamp;

    pub struct MacosCaptureSource {
        frames: VecDeque<CapturedFrame>,
    }

    impl MacosCaptureSource {
        pub fn capture_all(frame_index: u64) -> ChronicleResult<Self> {
            let display_ids = active_display_ids()?;
            Self::capture_displays(&display_ids, frame_index)
        }

        pub fn capture_all_with_privacy_filter(
            frame_index: u64,
            privacy_filter: &PrivacyFilter,
        ) -> ChronicleResult<Self> {
            let display_ids = active_display_ids()?;
            Self::capture_displays_with_privacy_filter(&display_ids, frame_index, privacy_filter)
        }

        pub fn capture(display_id: u32, frame_index: u64) -> ChronicleResult<Self> {
            Self::capture_displays(&[display_id], frame_index)
        }

        pub fn capture_with_privacy_filter(
            display_id: u32,
            frame_index: u64,
            privacy_filter: &PrivacyFilter,
        ) -> ChronicleResult<Self> {
            Self::capture_displays_with_privacy_filter(&[display_id], frame_index, privacy_filter)
        }

        fn capture_displays(display_ids: &[u32], frame_index: u64) -> ChronicleResult<Self> {
            Self::capture_displays_with_privacy_filter(
                display_ids,
                frame_index,
                &PrivacyFilter::default(),
            )
        }

        fn capture_displays_with_privacy_filter(
            display_ids: &[u32],
            frame_index: u64,
            privacy_filter: &PrivacyFilter,
        ) -> ChronicleResult<Self> {
            let windows = read_window_inventory()?;
            if privacy_filter.should_exclude_windows(&windows) {
                return Ok(Self {
                    frames: VecDeque::new(),
                });
            }
            if display_ids.is_empty() {
                return Err(ChronicleError::Process(
                    "macOS active display list is empty".to_string(),
                ));
            }

            let accessibility = read_accessibility_capture(&windows);
            Self::capture_displays_with_accessibility(
                display_ids,
                frame_index,
                accessibility,
                privacy_filter,
            )
        }

        pub fn capture_all_with_accessibility(
            frame_index: u64,
            accessibility: AccessibilityCapture,
        ) -> ChronicleResult<Self> {
            Self::capture_all_with_accessibility_and_privacy_filter(
                frame_index,
                accessibility,
                &PrivacyFilter::default(),
            )
        }

        pub fn capture_all_with_accessibility_and_privacy_filter(
            frame_index: u64,
            accessibility: AccessibilityCapture,
            privacy_filter: &PrivacyFilter,
        ) -> ChronicleResult<Self> {
            let display_ids = active_display_ids()?;
            Self::capture_displays_with_accessibility(
                &display_ids,
                frame_index,
                accessibility,
                privacy_filter,
            )
        }

        pub fn capture_with_accessibility(
            display_id: u32,
            frame_index: u64,
            accessibility: AccessibilityCapture,
        ) -> ChronicleResult<Self> {
            Self::capture_with_accessibility_and_privacy_filter(
                display_id,
                frame_index,
                accessibility,
                &PrivacyFilter::default(),
            )
        }

        pub fn capture_with_accessibility_and_privacy_filter(
            display_id: u32,
            frame_index: u64,
            accessibility: AccessibilityCapture,
            privacy_filter: &PrivacyFilter,
        ) -> ChronicleResult<Self> {
            Self::capture_displays_with_accessibility(
                &[display_id],
                frame_index,
                accessibility,
                privacy_filter,
            )
        }

        fn capture_displays_with_accessibility(
            display_ids: &[u32],
            frame_index: u64,
            accessibility: AccessibilityCapture,
            privacy_filter: &PrivacyFilter,
        ) -> ChronicleResult<Self> {
            let windows = read_window_inventory()?;
            if privacy_filter.should_exclude_windows(&windows) {
                return Ok(Self {
                    frames: VecDeque::new(),
                });
            }
            if display_ids.is_empty() {
                return Err(ChronicleError::Process(
                    "macOS active display list is empty".to_string(),
                ));
            }

            let captured_at = Timestamp::now()?;
            let mut frames = VecDeque::with_capacity(display_ids.len());
            for display_id in display_ids {
                let cg_image = capture_display(*display_id)?;
                let bytes = encode_cgimage_to_png(&cg_image)?;
                if bytes.is_empty() {
                    return Err(ChronicleError::Process(format!(
                        "macOS display capture produced empty image data for display {display_id}"
                    )));
                }
                let observed_text = run_vision_ocr(&cg_image)?;

                frames.push_back(CapturedFrame {
                    display_id: *display_id,
                    frame_index,
                    captured_at,
                    bytes,
                    frame_extension: "png".to_string(),
                    observed_text,
                    accessibility: accessibility.clone(),
                    windows: windows.clone(),
                });
            }

            Ok(Self { frames })
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct AxObserverNotification {
        pub pid: i32,
        pub app_bundle_identifier: String,
        pub notification: String,
        pub dropped_before: u64,
    }

    enum AxObserverCommand {
        Stop,
    }

    pub struct AxObserverRuntime {
        command_tx: Sender<AxObserverCommand>,
        event_rx: Receiver<AxObserverNotification>,
        dropped_count: Arc<AtomicU64>,
        target_pid: i32,
        target_bundle_identifier: String,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl AxObserverRuntime {
        pub fn start_for_frontmost_app() -> ChronicleResult<Self> {
            if !accessibility_trusted() {
                return Err(ChronicleError::Process(
                    "Accessibility permission is required for AXObserver".to_string(),
                ));
            }
            let app = frontmost_application().ok_or_else(|| {
                ChronicleError::Process("frontmost macOS application is unavailable".to_string())
            })?;
            Self::start(app)
        }

        pub fn drain(&self, limit: usize) -> Vec<AxObserverNotification> {
            let mut events = Vec::new();
            let mut seen = HashSet::new();
            let scan_limit = AX_OBSERVER_DRAIN_SCAN_LIMIT.max(limit);
            for _ in 0..scan_limit {
                match self.event_rx.try_recv() {
                    Ok(event) => {
                        let key = format!(
                            "{}:{}:{}",
                            event.pid, event.app_bundle_identifier, event.notification
                        );
                        if events.len() < limit && seen.insert(key) {
                            events.push(event);
                        }
                    }
                    Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
                }
            }
            events
        }

        fn start(app: FrontmostApplication) -> ChronicleResult<Self> {
            let (command_tx, command_rx) = mpsc::channel();
            let (event_tx, event_rx) = mpsc::sync_channel(AX_OBSERVER_EVENT_QUEUE_LIMIT);
            let (ready_tx, ready_rx) = mpsc::channel();
            let dropped_count = Arc::new(AtomicU64::new(0));
            let worker_dropped_count = Arc::clone(&dropped_count);
            let target_pid = app.pid;
            let target_bundle_identifier = app.bundle_identifier.clone();
            let worker = thread::spawn(move || {
                run_ax_observer_worker(app, command_rx, event_tx, worker_dropped_count, ready_tx);
            });

            match ready_rx.recv_timeout(Duration::from_secs(2)) {
                Ok(Ok(())) => Ok(Self {
                    command_tx,
                    event_rx,
                    dropped_count,
                    target_pid,
                    target_bundle_identifier,
                    worker: Some(worker),
                }),
                Ok(Err(error)) => {
                    let _ = worker.join();
                    Err(error)
                }
                Err(_) => {
                    let _ = command_tx.send(AxObserverCommand::Stop);
                    Err(ChronicleError::Process(format!(
                        "AXObserver startup timed out for pid {target_pid}"
                    )))
                }
            }
        }

        pub fn target_pid(&self) -> i32 {
            self.target_pid
        }

        pub fn target_bundle_identifier(&self) -> &str {
            &self.target_bundle_identifier
        }

        pub fn frontmost_target_changed(&self) -> bool {
            frontmost_application().is_none_or(|app| {
                app.pid != self.target_pid || app.bundle_identifier != self.target_bundle_identifier
            })
        }

        pub fn dropped_count(&self) -> u64 {
            self.dropped_count.load(Ordering::Relaxed)
        }
    }

    impl Drop for AxObserverRuntime {
        fn drop(&mut self) {
            let _ = self.command_tx.send(AxObserverCommand::Stop);
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }
    }

    pub fn read_ax_observer_accessibility_capture(
        event: &AxObserverNotification,
    ) -> AccessibilityCapture {
        match read_window_inventory() {
            Ok(windows) if PrivacyFilter::default().should_exclude_windows(&windows) => {
                return AccessibilityCapture::from_elements(
                    "macos-ax-observer",
                    AccessibilityCaptureStatus::Unavailable,
                    vec![AccessibilityElementObservation {
                        role: "AXObserverPrivacyFilter".to_string(),
                        label: "redacted-private-window".to_string(),
                        value: Some(event.notification.clone()),
                        app_bundle_identifier: event.app_bundle_identifier.clone(),
                        window_id: None,
                        depth: 0,
                        path: "macos-ax-observer:privacy-filter".to_string(),
                    }],
                );
            }
            Ok(_) => {}
            Err(_) => {
                return AccessibilityCapture::unavailable("macos-ax-observer");
            }
        }

        let mut capture = match read_application_ax_tree(
            FrontmostApplication {
                pid: event.pid,
                bundle_identifier: event.app_bundle_identifier.clone(),
            },
            "macos-ax-observer",
            Some(&event.notification),
        ) {
            Ok(elements) if !elements.is_empty() => AccessibilityCapture::from_elements(
                "macos-ax-observer",
                AccessibilityCaptureStatus::Ready,
                elements,
            ),
            _ => AccessibilityCapture::unavailable("macos-ax-observer"),
        };
        if event.dropped_before > 0 {
            capture.elements.push(AccessibilityElementObservation {
                role: "AXObserverBackpressure".to_string(),
                label: "dropped-events-before-this-capture".to_string(),
                value: Some(event.dropped_before.to_string()),
                app_bundle_identifier: event.app_bundle_identifier.clone(),
                window_id: None,
                depth: 0,
                path: "macos-ax-observer:backpressure".to_string(),
            });
        }
        capture
    }

    fn run_ax_observer_worker(
        app: FrontmostApplication,
        command_rx: Receiver<AxObserverCommand>,
        event_tx: SyncSender<AxObserverNotification>,
        dropped_count: Arc<AtomicU64>,
        ready_tx: Sender<ChronicleResult<()>>,
    ) {
        #[link(name = "ApplicationServices", kind = "framework")]
        unsafe extern "C" {
            fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
            fn AXObserverCreate(
                application: i32,
                callback: extern "C" fn(AXObserverRef, AXUIElementRef, CFStringRef, *mut c_void),
                out_observer: *mut AXObserverRef,
            ) -> i32;
            fn AXObserverAddNotification(
                observer: AXObserverRef,
                element: AXUIElementRef,
                notification: CFStringRef,
                refcon: *mut c_void,
            ) -> i32;
            fn AXObserverGetRunLoopSource(observer: AXObserverRef) -> CFTypeRef;
            fn CFRunLoopAddSource(rl: CFTypeRef, source: CFTypeRef, mode: CFStringRef);
            fn CFRunLoopGetCurrent() -> CFTypeRef;
            fn CFRunLoopRunInMode(
                mode: CFStringRef,
                seconds: f64,
                return_after_source: bool,
            ) -> i32;
            static kCFRunLoopDefaultMode: CFStringRef;
        }

        let app_element = unsafe { AXUIElementCreateApplication(app.pid) };
        if app_element.is_null() {
            let _ = ready_tx.send(Err(ChronicleError::Process(format!(
                "AXUIElementCreateApplication returned null for pid {}",
                app.pid
            ))));
            return;
        }

        let mut observer: AXObserverRef = ptr::null();
        let create_result =
            unsafe { AXObserverCreate(app.pid, ax_observer_callback, &mut observer) };
        if create_result != AX_SUCCESS || observer.is_null() {
            unsafe { CFRelease(app_element as CFTypeRef) };
            let _ = ready_tx.send(Err(ChronicleError::Process(format!(
                "AXObserverCreate failed for pid {} with code {}",
                app.pid, create_result
            ))));
            return;
        }

        let refcon = Box::into_raw(Box::new(AxObserverCallbackState {
            pid: app.pid,
            app_bundle_identifier: app.bundle_identifier.clone(),
            event_tx,
            dropped_count,
        })) as *mut c_void;

        let mut subscribed = Vec::new();
        let mut failed = Vec::new();
        for notification in AX_OBSERVER_NOTIFICATIONS {
            let notification_string = CFString::new(notification);
            let result = unsafe {
                AXObserverAddNotification(
                    observer,
                    app_element,
                    notification_string.as_concrete_TypeRef(),
                    refcon,
                )
            };
            if result == AX_SUCCESS {
                subscribed.push(*notification);
            } else {
                failed.push(format!("{notification}:{result}"));
            }
        }
        if subscribed.is_empty() {
            unsafe {
                drop(Box::from_raw(refcon as *mut AxObserverCallbackState));
                CFRelease(observer as CFTypeRef);
                CFRelease(app_element as CFTypeRef);
            }
            let _ = ready_tx.send(Err(ChronicleError::Process(format!(
                "AXObserverAddNotification failed for pid {}: {}",
                app.pid,
                failed.join(", ")
            ))));
            return;
        }

        unsafe {
            let source = AXObserverGetRunLoopSource(observer);
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopDefaultMode);
        }
        let _ = ready_tx.send(Ok(()));

        loop {
            match command_rx.try_recv() {
                Ok(AxObserverCommand::Stop) | Err(TryRecvError::Disconnected) => break,
                Err(TryRecvError::Empty) => {}
            }
            unsafe {
                let _ = CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.25, true);
            }
        }

        unsafe {
            drop(Box::from_raw(refcon as *mut AxObserverCallbackState));
            CFRelease(observer as CFTypeRef);
            CFRelease(app_element as CFTypeRef);
        }
    }

    type AXObserverRef = *const c_void;

    const AX_OBSERVER_EVENT_QUEUE_LIMIT: usize = 256;
    const AX_OBSERVER_DRAIN_SCAN_LIMIT: usize = 64;

    const AX_OBSERVER_NOTIFICATIONS: &[&str] = &[
        "AXFocusedUIElementChanged",
        "AXFocusedWindowChanged",
        "AXWindowCreated",
        "AXValueChanged",
        "AXSelectedTextChanged",
        "AXTitleChanged",
    ];

    struct AxObserverCallbackState {
        pid: i32,
        app_bundle_identifier: String,
        event_tx: SyncSender<AxObserverNotification>,
        dropped_count: Arc<AtomicU64>,
    }

    extern "C" fn ax_observer_callback(
        _observer: AXObserverRef,
        _element: AXUIElementRef,
        notification: CFStringRef,
        refcon: *mut c_void,
    ) {
        if refcon.is_null() || notification.is_null() {
            return;
        }
        let state = unsafe { &*(refcon as *const AxObserverCallbackState) };
        let notification = unsafe { CFString::wrap_under_get_rule(notification).to_string() };
        let event = AxObserverNotification {
            pid: state.pid,
            app_bundle_identifier: state.app_bundle_identifier.clone(),
            notification,
            dropped_before: state.dropped_count.load(Ordering::Relaxed),
        };
        match state.event_tx.try_send(event) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                state.dropped_count.fetch_add(1, Ordering::Relaxed);
            }
            Err(TrySendError::Disconnected(_)) => {}
        }
    }

    fn read_accessibility_capture(windows: &[BrowserWindowObservation]) -> AccessibilityCapture {
        if !accessibility_trusted() {
            return AccessibilityCapture::from_windows(
                windows,
                AccessibilityCaptureStatus::PermissionDenied,
            );
        }

        match read_frontmost_ax_tree() {
            Ok(elements) if !elements.is_empty() => AccessibilityCapture::from_elements(
                "macos-ax-tree-poll",
                AccessibilityCaptureStatus::Ready,
                elements,
            ),
            _ => AccessibilityCapture::from_windows(windows, AccessibilityCaptureStatus::Ready),
        }
    }

    fn accessibility_trusted() -> bool {
        #[link(name = "ApplicationServices", kind = "framework")]
        unsafe extern "C" {
            fn AXIsProcessTrusted() -> c_uchar;
        }

        unsafe { AXIsProcessTrusted() != 0 }
    }

    const AX_MAX_DEPTH: usize = 6;
    const AX_MAX_ELEMENTS: usize = 256;
    const AX_SUCCESS: i32 = 0;

    type AXUIElementRef = *const c_void;

    #[derive(Debug, Clone)]
    struct FrontmostApplication {
        pid: i32,
        bundle_identifier: String,
    }

    struct AxTreeCollectContext<'a> {
        bundle_identifier: &'a str,
        window_id: Option<u32>,
        visited: HashSet<usize>,
        elements: Vec<AccessibilityElementObservation>,
    }

    fn read_frontmost_ax_tree() -> ChronicleResult<Vec<AccessibilityElementObservation>> {
        let app = frontmost_application().ok_or_else(|| {
            ChronicleError::Process("frontmost macOS application is unavailable".to_string())
        })?;
        read_application_ax_tree(app, "macos-ax-tree-poll", None)
    }

    fn read_application_ax_tree(
        app: FrontmostApplication,
        provider: &str,
        notification: Option<&str>,
    ) -> ChronicleResult<Vec<AccessibilityElementObservation>> {
        #[link(name = "ApplicationServices", kind = "framework")]
        unsafe extern "C" {
            fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        }

        let app_element = unsafe { AXUIElementCreateApplication(app.pid) };
        if app_element.is_null() {
            return Err(ChronicleError::Process(format!(
                "AXUIElementCreateApplication returned null for pid {}",
                app.pid
            )));
        }

        let root = ax_attribute_element(app_element, "AXFocusedWindow")
            .or_else(|| ax_attribute_element(app_element, "AXMainWindow"))
            .or_else(|| ax_attribute_element(app_element, "AXFocusedUIElement"));

        let root_element = root.unwrap_or(app_element);
        let mut context = AxTreeCollectContext {
            bundle_identifier: &app.bundle_identifier,
            window_id: None,
            visited: HashSet::new(),
            elements: Vec::new(),
        };
        if let Some(notification) = notification {
            context.elements.push(AccessibilityElementObservation {
                role: "AXObserverNotification".to_string(),
                label: notification.to_string(),
                value: Some(format!("pid:{}", app.pid)),
                app_bundle_identifier: app.bundle_identifier.clone(),
                window_id: None,
                depth: 0,
                path: format!("{provider}:notification"),
            });
        }
        collect_ax_element(root_element, 0, "root".to_string(), &mut context);

        if root_element != app_element {
            unsafe { CFRelease(root_element as CFTypeRef) };
        }
        unsafe { CFRelease(app_element as CFTypeRef) };

        Ok(context.elements)
    }

    fn collect_ax_element(
        element: AXUIElementRef,
        depth: usize,
        path: String,
        context: &mut AxTreeCollectContext<'_>,
    ) {
        if element.is_null() || depth > AX_MAX_DEPTH || context.elements.len() >= AX_MAX_ELEMENTS {
            return;
        }
        let identity = element as usize;
        if !context.visited.insert(identity) {
            return;
        }

        let role =
            ax_attribute_string(element, "AXRole").unwrap_or_else(|| "AXElement".to_string());
        let label = ax_attribute_string(element, "AXTitle")
            .or_else(|| ax_attribute_string(element, "AXDescription"))
            .or_else(|| ax_attribute_string(element, "AXHelp"))
            .or_else(|| ax_attribute_string(element, "AXIdentifier"))
            .unwrap_or_default();
        let value = ax_attribute_string(element, "AXValue");

        if depth <= 1 || !label.is_empty() || value.as_deref().is_some_and(|item| !item.is_empty())
        {
            context.elements.push(AccessibilityElementObservation {
                role,
                label,
                value,
                app_bundle_identifier: context.bundle_identifier.to_string(),
                window_id: context.window_id,
                depth,
                path: path.clone(),
            });
        }

        if depth < AX_MAX_DEPTH {
            for attribute in ["AXChildren", "AXContents"] {
                collect_ax_child_array(element, attribute, depth, &path, context);
                if context.elements.len() >= AX_MAX_ELEMENTS {
                    return;
                }
            }
        }
    }

    fn collect_ax_child_array(
        element: AXUIElementRef,
        attribute: &str,
        depth: usize,
        path: &str,
        context: &mut AxTreeCollectContext<'_>,
    ) {
        let Some(value) = ax_copy_attribute(element, attribute) else {
            return;
        };

        unsafe {
            if CFGetTypeID(value) != CFArrayGetTypeID() {
                CFRelease(value);
                return;
            }

            let children: CFArray = CFArray::wrap_under_create_rule(value as *const _);
            let ax_type = ax_ui_element_type_id();
            for (index, child) in children.get_all_values().iter().enumerate() {
                let child_element = *child as AXUIElementRef;
                if child_element.is_null() || CFGetTypeID(child_element as CFTypeRef) != ax_type {
                    continue;
                }
                collect_ax_element(
                    child_element,
                    depth + 1,
                    format!("{path}/{attribute}:{index}"),
                    context,
                );
                if context.elements.len() >= AX_MAX_ELEMENTS {
                    break;
                }
            }
        }
    }

    fn ax_attribute_string(element: AXUIElementRef, attribute: &str) -> Option<String> {
        let value = ax_copy_attribute(element, attribute)?;
        unsafe {
            if CFGetTypeID(value) != CFStringGetTypeID() {
                CFRelease(value);
                return None;
            }
            let string = CFString::wrap_under_create_rule(value as CFStringRef);
            let text = string.to_string();
            if text.is_empty() { None } else { Some(text) }
        }
    }

    fn ax_attribute_element(element: AXUIElementRef, attribute: &str) -> Option<AXUIElementRef> {
        let value = ax_copy_attribute(element, attribute)?;
        unsafe {
            if CFGetTypeID(value) != ax_ui_element_type_id() {
                CFRelease(value);
                None
            } else {
                Some(value as AXUIElementRef)
            }
        }
    }

    fn ax_copy_attribute(element: AXUIElementRef, attribute: &str) -> Option<CFTypeRef> {
        #[link(name = "ApplicationServices", kind = "framework")]
        unsafe extern "C" {
            fn AXUIElementCopyAttributeValue(
                element: AXUIElementRef,
                attribute: CFStringRef,
                value: *mut CFTypeRef,
            ) -> i32;
        }

        let attribute = CFString::new(attribute);
        let mut value: CFTypeRef = ptr::null();
        let result = unsafe {
            AXUIElementCopyAttributeValue(element, attribute.as_concrete_TypeRef(), &mut value)
        };
        if result == AX_SUCCESS && !value.is_null() {
            Some(value)
        } else {
            if !value.is_null() {
                unsafe { CFRelease(value) };
            }
            None
        }
    }

    fn ax_ui_element_type_id() -> CFTypeID {
        #[link(name = "ApplicationServices", kind = "framework")]
        unsafe extern "C" {
            fn AXUIElementGetTypeID() -> CFTypeID;
        }

        unsafe { AXUIElementGetTypeID() }
    }

    fn frontmost_application() -> Option<FrontmostApplication> {
        use objc2::msg_send;
        use objc2::rc::autoreleasepool;
        use objc2::runtime::AnyObject;

        autoreleasepool(|_| unsafe {
            let cls = objc2::runtime::AnyClass::get(c"NSWorkspace")?;
            let workspace: *mut AnyObject = msg_send![cls, sharedWorkspace];
            if workspace.is_null() {
                return None;
            }
            let app: *mut AnyObject = msg_send![workspace, frontmostApplication];
            if app.is_null() {
                return None;
            }
            let pid: i32 = msg_send![app, processIdentifier];
            let bundle_id: *mut AnyObject = msg_send![app, bundleIdentifier];
            let localized_name: *mut AnyObject = msg_send![app, localizedName];
            let bundle_identifier = ns_string_to_string(bundle_id)
                .or_else(|| ns_string_to_string(localized_name))
                .unwrap_or_else(|| format!("pid:{pid}"));
            Some(FrontmostApplication {
                pid,
                bundle_identifier,
            })
        })
    }

    impl CaptureSource for MacosCaptureSource {
        fn next_frame(&mut self) -> ChronicleResult<Option<CapturedFrame>> {
            Ok(self.frames.pop_front())
        }
    }

    // --- Screen Capture via CGDisplay ---

    fn active_display_ids() -> ChronicleResult<Vec<u32>> {
        CGDisplay::active_displays().map_err(|error| {
            ChronicleError::Process(format!(
                "failed to enumerate active macOS displays: {error:?}"
            ))
        })
    }

    fn capture_display(display_id: u32) -> ChronicleResult<CGImage> {
        let display = if display_id == 0 {
            CGDisplay::main()
        } else {
            CGDisplay::new(display_id)
        };

        display.image().ok_or_else(|| {
            ChronicleError::Process(
                "CGDisplayCreateImage returned null. Grant Screen Recording permission."
                    .to_string(),
            )
        })
    }

    fn encode_cgimage_to_png(image: &CGImage) -> ChronicleResult<Vec<u8>> {
        // Use ImageIO to write CGImage to PNG data in-memory.
        #[link(name = "ImageIO", kind = "framework")]
        unsafe extern "C" {
            fn CGImageDestinationCreateWithData(
                data: CFTypeRef,
                type_: CFTypeRef,
                count: usize,
                options: CFTypeRef,
            ) -> *mut c_void;
            fn CGImageDestinationAddImage(
                dest: *mut c_void,
                image: *const c_void,
                properties: CFTypeRef,
            );
            fn CGImageDestinationFinalize(dest: *mut c_void) -> bool;
        }

        #[link(name = "CoreFoundation", kind = "framework")]
        unsafe extern "C" {
            fn CFDataCreateMutable(allocator: CFTypeRef, capacity: isize) -> CFTypeRef;
            fn CFDataGetBytePtr(data: CFTypeRef) -> *const u8;
            fn CFDataGetLength(data: CFTypeRef) -> isize;
        }

        unsafe {
            let mutable_data = CFDataCreateMutable(ptr::null(), 0);
            if mutable_data.is_null() {
                return Err(ChronicleError::Process(
                    "failed to create mutable data for PNG encoding".to_string(),
                ));
            }

            let png_uti = CFString::new("public.png");
            let dest = CGImageDestinationCreateWithData(
                mutable_data,
                png_uti.as_CFTypeRef(),
                1,
                ptr::null(),
            );
            if dest.is_null() {
                CFRelease(mutable_data);
                return Err(ChronicleError::Process(
                    "failed to create CGImageDestination for PNG".to_string(),
                ));
            }

            CGImageDestinationAddImage(dest, image.as_ptr() as *const c_void, ptr::null());

            let success = CGImageDestinationFinalize(dest);
            CFRelease(dest as CFTypeRef);

            if !success {
                CFRelease(mutable_data);
                return Err(ChronicleError::Process(
                    "CGImageDestinationFinalize failed".to_string(),
                ));
            }

            let ptr = CFDataGetBytePtr(mutable_data);
            let len = CFDataGetLength(mutable_data) as usize;
            let bytes = std::slice::from_raw_parts(ptr, len).to_vec();
            CFRelease(mutable_data);

            Ok(bytes)
        }
    }

    // --- Window Enumeration via CoreGraphics ---

    fn read_window_inventory() -> ChronicleResult<Vec<BrowserWindowObservation>> {
        use core_foundation::array::CFArray;
        use core_foundation::dictionary::CFDictionary;

        let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
        let window_list: CFArray<CFDictionary<CFString, CFTypeRef>> = unsafe {
            let raw = core_graphics::window::CGWindowListCopyWindowInfo(options, kCGNullWindowID);
            if raw.is_null() {
                return Ok(Vec::new());
            }
            CFArray::wrap_under_create_rule(raw as *mut _)
        };

        // Build PID -> bundle ID map via NSWorkspace
        let pid_to_bundle = build_pid_to_bundle_map();

        let key_number = unsafe { CFString::wrap_under_get_rule(kCGWindowNumber) };
        let key_pid = unsafe { CFString::wrap_under_get_rule(kCGWindowOwnerPID) };
        let key_name = unsafe { CFString::wrap_under_get_rule(kCGWindowName) };
        let key_owner = unsafe { CFString::wrap_under_get_rule(kCGWindowOwnerName) };

        let mut windows = Vec::new();
        for i in 0..window_list.len() {
            let dict = unsafe { window_list.get_unchecked(i) };

            let window_id = get_dict_number(&dict, &key_number).unwrap_or(0) as u32;
            let pid = get_dict_number(&dict, &key_pid).unwrap_or(0) as i32;
            let title = get_dict_string(&dict, &key_name).unwrap_or_default();
            let owner_name = get_dict_string(&dict, &key_owner).unwrap_or_default();

            let bundle_id = pid_to_bundle.get(&pid).cloned().unwrap_or(owner_name);

            windows.push(BrowserWindowObservation::new(window_id, title, bundle_id));
        }

        Ok(windows)
    }

    fn get_dict_number(
        dict: &core_foundation::dictionary::CFDictionary<CFString, CFTypeRef>,
        key: &CFString,
    ) -> Option<i64> {
        use core_foundation::number::CFNumber;
        unsafe {
            if dict.contains_key(key) {
                let value = dict.get(key);
                let number: CFNumber = CFNumber::wrap_under_get_rule(*value as *const _);
                number.to_i64()
            } else {
                None
            }
        }
    }

    fn get_dict_string(
        dict: &core_foundation::dictionary::CFDictionary<CFString, CFTypeRef>,
        key: &CFString,
    ) -> Option<String> {
        unsafe {
            if dict.contains_key(key) {
                let value = dict.get(key);
                let cf_str = CFString::wrap_under_get_rule(*value as *const _);
                Some(cf_str.to_string())
            } else {
                None
            }
        }
    }

    fn build_pid_to_bundle_map() -> std::collections::HashMap<i32, String> {
        use objc2::msg_send;
        use objc2::rc::autoreleasepool;
        use objc2::runtime::AnyObject;

        autoreleasepool(|_| {
            let mut map = std::collections::HashMap::new();

            unsafe {
                // [NSWorkspace sharedWorkspace]
                let cls = objc2::runtime::AnyClass::get(c"NSWorkspace").unwrap();
                let workspace: *mut AnyObject = msg_send![cls, sharedWorkspace];
                if workspace.is_null() {
                    return map;
                }
                // [workspace runningApplications]
                let apps: *mut AnyObject = msg_send![workspace, runningApplications];
                if apps.is_null() {
                    return map;
                }
                let count: usize = msg_send![apps, count];
                for i in 0..count {
                    let app: *mut AnyObject = msg_send![apps, objectAtIndex: i];
                    if app.is_null() {
                        continue;
                    }
                    let pid: i32 = msg_send![app, processIdentifier];
                    let bundle_id: *mut AnyObject = msg_send![app, bundleIdentifier];
                    if !bundle_id.is_null() {
                        let utf8: *const u8 = msg_send![bundle_id, UTF8String];
                        if !utf8.is_null() {
                            let cstr = std::ffi::CStr::from_ptr(utf8 as *const _);
                            if let Ok(s) = cstr.to_str() {
                                map.insert(pid, s.to_string());
                            }
                        }
                    }
                }
            }

            map
        })
    }

    fn ns_string_to_string(value: *mut objc2::runtime::AnyObject) -> Option<String> {
        if value.is_null() {
            return None;
        }
        unsafe {
            let utf8: *const u8 = objc2::msg_send![value, UTF8String];
            if utf8.is_null() {
                return None;
            }
            std::ffi::CStr::from_ptr(utf8 as *const _)
                .to_str()
                .ok()
                .map(ToOwned::to_owned)
        }
    }

    // --- Vision OCR via objc2 ---

    fn run_vision_ocr(cg_image: &CGImage) -> ChronicleResult<String> {
        use objc2::msg_send;
        use objc2::rc::autoreleasepool;
        use objc2::runtime::AnyObject;

        autoreleasepool(|_| {
            unsafe {
                // Create VNRecognizeTextRequest
                let request_cls = objc2::runtime::AnyClass::get(c"VNRecognizeTextRequest")
                    .ok_or_else(|| {
                        ChronicleError::Process(
                            "VNRecognizeTextRequest class not found (requires macOS 10.15+)"
                                .to_string(),
                        )
                    })?;
                let request: *mut AnyObject = msg_send![request_cls, alloc];
                let request: *mut AnyObject = msg_send![request, init];
                if request.is_null() {
                    return Err(ChronicleError::Process(
                        "failed to create VNRecognizeTextRequest".to_string(),
                    ));
                }

                // Set recognition level to accurate (1)
                let _: () = msg_send![request, setRecognitionLevel: 1i64];
                // Enable language correction for better accuracy
                let _: () = msg_send![request, setUsesLanguageCorrection: true];
                // Use revision 3 (macOS 13+) for best quality; falls back gracefully
                let _: () = msg_send![request, setRevision: 3usize];
                // Set recognition languages — prioritize English + Chinese + Japanese
                let nsstring_cls = objc2::runtime::AnyClass::get(c"NSString").unwrap();
                let array_cls = objc2::runtime::AnyClass::get(c"NSArray").unwrap();
                let lang_en: *mut AnyObject =
                    msg_send![nsstring_cls, stringWithUTF8String: c"en-US".as_ptr()];
                let lang_zh: *mut AnyObject =
                    msg_send![nsstring_cls, stringWithUTF8String: c"zh-Hans".as_ptr()];
                let lang_ja: *mut AnyObject =
                    msg_send![nsstring_cls, stringWithUTF8String: c"ja".as_ptr()];
                let langs_raw: [*mut AnyObject; 3] = [lang_en, lang_zh, lang_ja];
                let lang_array: *mut AnyObject =
                    msg_send![array_cls, arrayWithObjects: langs_raw.as_ptr(), count: 3usize];
                let _: () = msg_send![request, setRecognitionLanguages: lang_array];
                // Minimum text height filter (ignore very tiny text that's usually noise)
                let _: () = msg_send![request, setMinimumTextHeight: 0.01f32];

                // Create VNImageRequestHandler with CGImage
                let handler_cls = objc2::runtime::AnyClass::get(c"VNImageRequestHandler")
                    .ok_or_else(|| {
                        // Release request before returning error
                        let _: () = msg_send![request, release];
                        ChronicleError::Process(
                            "VNImageRequestHandler class not found (requires macOS 10.15+)"
                                .to_string(),
                        )
                    })?;
                let handler: *mut AnyObject = msg_send![handler_cls, alloc];
                // initWithCGImage:options: — use raw objc_msgSend because
                // core_graphics::CGImage doesn't implement objc2::RefEncode
                let cg_image_ptr: *const c_void = cg_image.as_ptr().cast();
                let empty_dict_cls = objc2::runtime::AnyClass::get(c"NSDictionary").unwrap();
                let empty_dict: *mut AnyObject = msg_send![empty_dict_cls, dictionary];
                let sel = objc2::sel!(initWithCGImage:options:);
                let init_fn: unsafe extern "C" fn(
                    *mut AnyObject,
                    objc2::runtime::Sel,
                    *const c_void,
                    *mut AnyObject,
                ) -> *mut AnyObject = std::mem::transmute(objc2::ffi::objc_msgSend as *const ());
                let handler: *mut AnyObject = init_fn(handler, sel, cg_image_ptr, empty_dict);
                if handler.is_null() {
                    let _: () = msg_send![request, release];
                    return Err(ChronicleError::Process(
                        "failed to create VNImageRequestHandler".to_string(),
                    ));
                }

                // Create NSArray with single request
                let array_cls = objc2::runtime::AnyClass::get(c"NSArray").unwrap();
                let requests: *mut AnyObject = msg_send![array_cls, arrayWithObject: request];

                // performRequests:error:
                let mut error: *mut AnyObject = ptr::null_mut();
                let success: bool =
                    msg_send![handler, performRequests: requests, error: &mut error];

                if !success {
                    let desc = if !error.is_null() {
                        let desc: *mut AnyObject = msg_send![error, localizedDescription];
                        if !desc.is_null() {
                            let utf8: *const u8 = msg_send![desc, UTF8String];
                            if !utf8.is_null() {
                                std::ffi::CStr::from_ptr(utf8 as *const _)
                                    .to_string_lossy()
                                    .to_string()
                            } else {
                                "unknown error".to_string()
                            }
                        } else {
                            "unknown error".to_string()
                        }
                    } else {
                        "unknown error".to_string()
                    };
                    let _: () = msg_send![request, release];
                    let _: () = msg_send![handler, release];
                    return Err(ChronicleError::Process(format!(
                        "Vision OCR failed: {desc}"
                    )));
                }

                // Extract results
                let results: *mut AnyObject = msg_send![request, results];
                let text = if results.is_null() {
                    String::new()
                } else {
                    let count: usize = msg_send![results, count];
                    let mut lines = Vec::with_capacity(count);
                    for i in 0..count {
                        let observation: *mut AnyObject = msg_send![results, objectAtIndex: i];
                        if observation.is_null() {
                            continue;
                        }
                        // Skip low-confidence observations (< 0.3)
                        let confidence: f32 = msg_send![observation, confidence];
                        if confidence < 0.3 {
                            continue;
                        }
                        // topCandidates:1
                        let candidates: *mut AnyObject =
                            msg_send![observation, topCandidates: 1usize];
                        if candidates.is_null() {
                            continue;
                        }
                        let cand_count: usize = msg_send![candidates, count];
                        if cand_count == 0 {
                            continue;
                        }
                        let candidate: *mut AnyObject =
                            msg_send![candidates, objectAtIndex: 0usize];
                        if candidate.is_null() {
                            continue;
                        }
                        let string: *mut AnyObject = msg_send![candidate, string];
                        if string.is_null() {
                            continue;
                        }
                        let utf8: *const u8 = msg_send![string, UTF8String];
                        if !utf8.is_null() {
                            let cstr = std::ffi::CStr::from_ptr(utf8 as *const _);
                            if let Ok(s) = cstr.to_str() {
                                lines.push(s.to_string());
                            }
                        }
                    }
                    lines.join("\n")
                };

                // Release owned objects
                let _: () = msg_send![request, release];
                let _: () = msg_send![handler, release];

                Ok(text)
            }
        })
    }
}

#[cfg(target_os = "macos")]
pub use native::{
    AxObserverNotification, AxObserverRuntime, MacosCaptureSource,
    read_ax_observer_accessibility_capture,
};

#[cfg(not(target_os = "macos"))]
mod stub {
    use crate::error::{ChronicleError, ChronicleResult};
    use crate::screen::{CaptureSource, CapturedFrame};

    pub struct MacosCaptureSource;

    impl MacosCaptureSource {
        pub fn capture_all(_frame_index: u64) -> ChronicleResult<Self> {
            Err(ChronicleError::Process(
                "macOS capture is only available on macOS".to_string(),
            ))
        }

        pub fn capture(_display_id: u32, _frame_index: u64) -> ChronicleResult<Self> {
            Err(ChronicleError::Process(
                "macOS capture is only available on macOS".to_string(),
            ))
        }
    }

    impl CaptureSource for MacosCaptureSource {
        fn next_frame(&mut self) -> ChronicleResult<Option<CapturedFrame>> {
            Err(ChronicleError::Process(
                "macOS capture is only available on macOS".to_string(),
            ))
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub use stub::MacosCaptureSource;
