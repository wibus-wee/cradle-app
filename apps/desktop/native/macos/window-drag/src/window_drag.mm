#import <Cocoa/Cocoa.h>

#include <napi.h>

namespace {

id local_event_monitor = nil;
NSEvent* last_left_mouse_down = nil;

NSView* ReadView(const Napi::Value& value) {
  if (!value.IsBuffer()) {
    return nil;
  }
  const auto buffer = value.As<Napi::Buffer<unsigned char>>();
  if (buffer.Length() < sizeof(void*)) {
    return nil;
  }
  void* pointer = nullptr;
  memcpy(&pointer, buffer.Data(), sizeof(pointer));
  return (__bridge NSView*)pointer;
}

void EnsureMouseDownMonitor() {
  if (local_event_monitor != nil) {
    return;
  }
  local_event_monitor = [NSEvent
    addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown
    handler:^NSEvent* _Nullable(NSEvent* _Nonnull event) {
      last_left_mouse_down = event;
      return event;
    }];
}

Napi::Value Install(const Napi::CallbackInfo& info) {
  @autoreleasepool {
    EnsureMouseDownMonitor();
    return Napi::Boolean::New(info.Env(), true);
  }
}

Napi::Value Begin(const Napi::CallbackInfo& info) {
  @autoreleasepool {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
      return Napi::Boolean::New(env, false);
    }
    NSView* view = ReadView(info[0]);
    NSWindow* window = view.window;
    if (window == nil || ([NSEvent pressedMouseButtons] & 1u) == 0u) {
      return Napi::Boolean::New(env, false);
    }

    EnsureMouseDownMonitor();
    NSEvent* source = last_left_mouse_down;
    if (source == nil) {
      return Napi::Boolean::New(env, false);
    }

    // performDrag(with:) expects a mouse-down in the target window's coordinate
    // space. Preserve the physical button-down gesture while rebasing its
    // location to the newly claimed tear-off window.
    const NSPoint screen_location = [NSEvent mouseLocation];
    const NSPoint window_location = [window convertPointFromScreen:screen_location];
    NSEvent* target_event = [NSEvent
      mouseEventWithType:NSEventTypeLeftMouseDown
      location:window_location
      modifierFlags:source.modifierFlags
      timestamp:source.timestamp
      windowNumber:window.windowNumber
      context:nil
      eventNumber:source.eventNumber
      clickCount:source.clickCount
      pressure:source.pressure];
    if (target_event == nil) {
      return Napi::Boolean::New(env, false);
    }

    [window makeKeyAndOrderFront:nil];
    [window performWindowDragWithEvent:target_event];
    return Napi::Boolean::New(env, true);
  }
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("install", Napi::Function::New(env, Install));
  exports.Set("begin", Napi::Function::New(env, Begin));
  return exports;
}

NODE_API_MODULE(window_drag, Init)
