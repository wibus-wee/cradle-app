{
  "targets": [
    {
      "target_name": "window_drag",
      "sources": ["src/window_drag.mm"],
      "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "MACOSX_DEPLOYMENT_TARGET": "11.0"
            },
            "link_settings": {
              "libraries": ["-framework Cocoa"]
            }
          }
        ]
      ]
    }
  ]
}
