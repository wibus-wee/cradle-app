{
  "targets": [
    {
      "target_name": "caption_buttons",
      "sources": ["src/caption_buttons.cc"],
      "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 0,
          "AdditionalOptions": ["/Zc:__cplusplus"]
        }
      },
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": ["user32.lib", "comctl32.lib"]
          }
        ]
      ]
    }
  ]
}
