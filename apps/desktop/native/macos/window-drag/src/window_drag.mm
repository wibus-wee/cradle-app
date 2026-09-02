#import <Cocoa/Cocoa.h>

#include <napi.h>

static constexpr NSTimeInterval kDragPollInterval = 1.0 / 120.0;

@interface CradleWindowDragSession : NSObject

- (instancetype)initWithWindow:(NSWindow*)window;
- (void)start;
- (void)stop;

@end

static CradleWindowDragSession* active_session = nil;

@interface CradleWindowDragSession ()

@property(nonatomic, weak) NSWindow* window;
@property(nonatomic) NSPoint initialCursorLocation;
@property(nonatomic) NSPoint initialWindowOrigin;
@property(nonatomic, strong) NSTimer* timer;
@property(nonatomic, strong) id eventMonitor;
@property(nonatomic, strong) id closeObserver;

- (void)updateWindowPosition:(NSTimer*)timer;
- (void)moveWindowToCurrentCursor;

@end

@implementation CradleWindowDragSession

- (instancetype)initWithWindow:(NSWindow*)window {
  self = [super init];
  if (self != nil) {
    _window = window;
  }
  return self;
}

- (void)start {
  NSWindow* window = self.window;
  if (window == nil) {
    return;
  }

  self.initialCursorLocation = [NSEvent mouseLocation];
  self.initialWindowOrigin = window.frame.origin;

  __weak CradleWindowDragSession* weakSelf = self;
  self.closeObserver = [[NSNotificationCenter defaultCenter]
      addObserverForName:NSWindowWillCloseNotification
                  object:window
                   queue:[NSOperationQueue mainQueue]
              usingBlock:^(__unused NSNotification* notification) {
                [weakSelf stop];
              }];

  self.eventMonitor = [NSEvent
      addLocalMonitorForEventsMatchingMask:(NSEventMaskLeftMouseDragged | NSEventMaskLeftMouseUp)
                                   handler:^NSEvent*(NSEvent* event) {
                                     CradleWindowDragSession* session = weakSelf;
                                     if (event.type == NSEventTypeLeftMouseDragged) {
                                       [session moveWindowToCurrentCursor];
                                     } else if (event.type == NSEventTypeLeftMouseUp) {
                                       [session moveWindowToCurrentCursor];
                                       dispatch_async(dispatch_get_main_queue(), ^{
                                         [session stop];
                                       });
                                     }
                                     return event;
                                   }];

  // Chromium still owns the originating HTML drag. Poll outside that event
  // stream in common modes as a fallback when it coalesces drag events.
  self.timer = [NSTimer timerWithTimeInterval:kDragPollInterval
                                       target:self
                                     selector:@selector(updateWindowPosition:)
                                     userInfo:nil
                                      repeats:YES];
  [[NSRunLoop mainRunLoop] addTimer:self.timer forMode:NSRunLoopCommonModes];
}

- (void)updateWindowPosition:(__unused NSTimer*)timer {
  NSWindow* window = self.window;
  if (window == nil || ([NSEvent pressedMouseButtons] & 1u) == 0u) {
    [self stop];
    return;
  }

  [self moveWindowToCurrentCursor];
}

- (void)moveWindowToCurrentCursor {
  NSWindow* window = self.window;
  if (window == nil) {
    return;
  }
  const NSPoint cursor = [NSEvent mouseLocation];
  const NSPoint origin = NSMakePoint(
      self.initialWindowOrigin.x + cursor.x - self.initialCursorLocation.x,
      self.initialWindowOrigin.y + cursor.y - self.initialCursorLocation.y);
  [window setFrameOrigin:origin];
}

- (void)stop {
  [self.timer invalidate];
  self.timer = nil;

  if (self.eventMonitor != nil) {
    [NSEvent removeMonitor:self.eventMonitor];
    self.eventMonitor = nil;
  }

  if (self.closeObserver != nil) {
    [[NSNotificationCenter defaultCenter] removeObserver:self.closeObserver];
    self.closeObserver = nil;
  }

  if (active_session == self) {
    active_session = nil;
  }
}

@end

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

Napi::Value Begin(const Napi::CallbackInfo& info) {
  @autoreleasepool {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
      return Napi::Boolean::New(env, false);
    }
    if (![NSThread isMainThread]) {
      return Napi::Boolean::New(env, false);
    }

    NSView* view = ReadView(info[0]);
    NSWindow* window = view.window;
    if (window == nil || ([NSEvent pressedMouseButtons] & 1u) == 0u) {
      return Napi::Boolean::New(env, false);
    }

    [active_session stop];
    [window makeKeyAndOrderFront:nil];
    active_session = [[CradleWindowDragSession alloc] initWithWindow:window];
    [active_session start];
    return Napi::Boolean::New(env, true);
  }
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("begin", Napi::Function::New(env, Begin));
  return exports;
}

NODE_API_MODULE(window_drag, Init)
