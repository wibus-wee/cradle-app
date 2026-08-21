#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>

#include <napi.h>
#include <map>

namespace {

constexpr int kButtonCount = 3;

enum ButtonIndex {
  kMinimize = 0,
  kMaximize = 1,
  kClose = 2,
};

const char* ButtonName(ButtonIndex index) {
  switch (index) {
    case kMinimize: return "minimize";
    case kMaximize: return "maximize";
    case kClose: return "close";
  }
  return "";
}

struct CaptionRect {
  LONG x = 0;
  LONG y = 0;
  LONG width = 0;
  LONG height = 0;

  bool Contains(POINT point) const {
    return width > 0 && height > 0
      && point.x >= x && point.x < x + width
      && point.y >= y && point.y < y + height;
  }
};

struct HoverEventData {
  const char* button;
  const char* phase;
};

void CallHoverJs(Napi::Env env, Napi::Function callback, const char*, HoverEventData* data) {
  if (env != nullptr && callback != nullptr) {
    Napi::Object event = Napi::Object::New(env);
    event.Set("button", Napi::String::New(env, data->button));
    event.Set("phase", Napi::String::New(env, data->phase));
    callback.Call({event});
  }
  delete data;
}

struct WindowState {
  HWND hwnd = nullptr;
  WNDPROC previousProc = nullptr;
  CaptionRect rects[kButtonCount];
  bool hovered[kButtonCount] = {};
  Napi::ThreadSafeFunction hoverTsfn;
};

std::map<HWND, WindowState*>& States() {
  static std::map<HWND, WindowState*> states;
  return states;
}

WindowState* StateFor(HWND hwnd) {
  auto& states = States();
  auto it = states.find(hwnd);
  return it == states.end() ? nullptr : it->second;
}

int ButtonForPoint(WindowState* state, POINT clientPoint) {
  for (int i = 0; i < kButtonCount; ++i) {
    if (state->rects[i].Contains(clientPoint)) {
      return i;
    }
  }
  return -1;
}

void EmitHover(WindowState* state, ButtonIndex button, const char* phase) {
  if (!state->hoverTsfn) {
    return;
  }
  auto* data = new HoverEventData{ButtonName(button), phase};
  state->hoverTsfn.NonBlockingCall(data, CallHoverJs);
}

void SetHovered(WindowState* state, int button, bool hovered) {
  for (int i = 0; i < kButtonCount; ++i) {
    if (state->hovered[i] && (hovered == false || i != button)) {
      state->hovered[i] = false;
      EmitHover(state, static_cast<ButtonIndex>(i), "leave");
    }
  }
  if (button >= 0 && hovered) {
    if (!state->hovered[button]) {
      state->hovered[button] = true;
      EmitHover(state, static_cast<ButtonIndex>(button), "enter");
    }
  }
}

void ExecuteButton(WindowState* state, ButtonIndex button) {
  switch (button) {
    case kMinimize:
      PostMessageW(state->hwnd, WM_SYSCOMMAND, SC_MINIMIZE, 0);
      break;
    case kMaximize:
      PostMessageW(
        state->hwnd,
        WM_SYSCOMMAND,
        IsZoomed(state->hwnd) ? SC_RESTORE : SC_MAXIMIZE,
        0);
      break;
    case kClose:
      PostMessageW(state->hwnd, WM_CLOSE, 0, 0);
      break;
  }
}

LRESULT CALLBACK CaptionButtonsWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  WindowState* state = StateFor(hwnd);
  if (state == nullptr) {
    return DefWindowProcW(hwnd, message, wParam, lParam);
  }

  switch (message) {
    case WM_NCHITTEST: {
      POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
      ScreenToClient(hwnd, &point);
      int button = ButtonForPoint(state, point);
      if (button >= 0) {
        return button == kMinimize ? HTMINBUTTON
          : button == kMaximize ? HTMAXBUTTON
          : HTCLOSE;
      }
      break;
    }

    case WM_NCMOUSEMOVE: {
      POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
      ScreenToClient(hwnd, &point);
      SetHovered(state, ButtonForPoint(state, point), true);
      TRACKMOUSEEVENT track{};
      track.cbSize = sizeof(track);
      track.dwFlags = TME_NONCLIENT | TME_LEAVE;
      track.hwndTrack = hwnd;
      TrackMouseEvent(&track);
      break;
    }

    case WM_NCMOUSELEAVE: {
      SetHovered(state, -1, false);
      break;
    }

    case WM_NCLBUTTONDOWN: {
      int button = wParam == HTMINBUTTON ? kMinimize
        : wParam == HTMAXBUTTON ? kMaximize
        : wParam == HTCLOSE ? kClose
        : -1;
      if (button >= 0) {
        EmitHover(state, static_cast<ButtonIndex>(button), "press");
      }
      break;
    }

    case WM_NCLBUTTONUP: {
      int button = wParam == HTMINBUTTON ? kMinimize
        : wParam == HTMAXBUTTON ? kMaximize
        : wParam == HTCLOSE ? kClose
        : -1;
      if (button >= 0) {
        EmitHover(state, static_cast<ButtonIndex>(button), "release");
        ExecuteButton(state, static_cast<ButtonIndex>(button));
        return 0;
      }
      break;
    }

    case WM_NCDESTROY: {
      auto& states = States();
      states.erase(hwnd);
      state->hoverTsfn.Release();
      RemoveWindowSubclass(hwnd, CaptionButtonsWndProc, 1);
      break;
    }

    default:
      break;
  }

  // comctl32 subclass chain preserves the previous proc; fall through to it.
  return DefSubclassProc(hwnd, message, wParam, lParam);
}

bool ReadHandleBuffer(const Napi::Value& value, HWND* outHwnd) {
  if (!value.IsBuffer()) {
    return false;
  }
  Napi::Buffer<char> buffer = value.As<Napi::Buffer<char>>();
  if (buffer.Length() < sizeof(HWND)) {
    return false;
  }
  HWND hwnd;
  memcpy(&hwnd, buffer.Data(), sizeof(HWND));
  if (hwnd == nullptr || !IsWindow(hwnd)) {
    return false;
  }
  *outHwnd = hwnd;
  return true;
}

bool ReadRect(const Napi::Object& object, CaptionRect* rect) {
  if (!object.Has("x") || !object.Has("y") || !object.Has("width") || !object.Has("height")) {
    return false;
  }
  rect->x = static_cast<LONG>(object.Get("x").ToNumber().DoubleValue());
  rect->y = static_cast<LONG>(object.Get("y").ToNumber().DoubleValue());
  rect->width = static_cast<LONG>(object.Get("width").ToNumber().DoubleValue());
  rect->height = static_cast<LONG>(object.Get("height").ToNumber().DoubleValue());
  return true;
}

Napi::Boolean Attach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "attach(handle: Buffer, onHover: Function)").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  HWND hwnd = nullptr;
  if (!ReadHandleBuffer(info[0], &hwnd)) {
    Napi::Error::New(env, "attach: invalid window handle").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }
  if (StateFor(hwnd) != nullptr) {
    return Napi::Boolean::New(env, true);
  }

  auto* state = new WindowState();
  state->hwnd = hwnd;
  state->hoverTsfn = Napi::ThreadSafeFunction::New(
    env,
    info[1].As<Napi::Function>(),
    "cradleCaptionButtonsHover",
    0,
    1);

  SetWindowSubclass(hwnd, CaptionButtonsWndProc, 1, reinterpret_cast<DWORD_PTR>(state));
  States()[hwnd] = state;
  return Napi::Boolean::New(env, true);
}

Napi::Boolean Detach(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HWND hwnd = nullptr;
  if (!ReadHandleBuffer(info[0], &hwnd)) {
    return Napi::Boolean::New(env, false);
  }
  auto& states = States();
  auto it = states.find(hwnd);
  if (it == states.end()) {
    return Napi::Boolean::New(env, false);
  }
  WindowState* state = it->second;
  states.erase(it);
  RemoveWindowSubclass(hwnd, CaptionButtonsWndProc, 1);
  state->hoverTsfn.Release();
  delete state;
  return Napi::Boolean::New(env, true);
}

Napi::Boolean SetButtons(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HWND hwnd = nullptr;
  if (!ReadHandleBuffer(info[0], &hwnd)) {
    return Napi::Boolean::New(env, false);
  }
  WindowState* state = StateFor(hwnd);
  if (state == nullptr || info.Length() < 2 || !info[1].IsObject()) {
    return Napi::Boolean::New(env, false);
  }

  Napi::Object buttons = info[1].As<Napi::Object>();
  const char* names[kButtonCount] = {"minimize", "maximize", "close"};
  for (int i = 0; i < kButtonCount; ++i) {
    Napi::Value value = buttons.Get(names[i]);
    if (value.IsObject() && !ReadRect(value.As<Napi::Object>(), &state->rects[i])) {
      Napi::TypeError::New(env, "setButtons: invalid rect").ThrowAsJavaScriptException();
      return Napi::Boolean::New(env, false);
    }
  }
  return Napi::Boolean::New(env, true);
}

Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
  exports.Set("attach", Napi::Function::New(env, Attach));
  exports.Set("detach", Napi::Function::New(env, Detach));
  exports.Set("setButtons", Napi::Function::New(env, SetButtons));
  return exports;
}

}  // namespace

NODE_API_MODULE(caption_buttons, InitModule)
