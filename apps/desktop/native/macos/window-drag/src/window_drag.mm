#import <Cocoa/Cocoa.h>

#include <napi.h>

namespace {

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

Napi::Value Install(const Napi::CallbackInfo& info) {
  @autoreleasepool {
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

    // performDrag(with:) expects a mouse-down in the target window's coordinate
    // space. Synthesize it at the live cursor rather than reusing Chromium's
    // original event: by tear-off time that event belongs to the source window
    // and may already be part of an HTML drag session.
    const NSPoint screen_location = [NSEvent mouseLocation];
    const NSPoint window_location = [window convertPointFromScreen:screen_location];
    NSEvent* target_event = [NSEvent
      mouseEventWithType:NSEventTypeLeftMouseDown
      location:window_location
      modifierFlags:[NSEvent modifierFlags]
      timestamp:[NSProcessInfo processInfo].systemUptime
      windowNumber:window.windowNumber
      context:nil
      eventNumber:0
      clickCount:1
      pressure:1.0];
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
