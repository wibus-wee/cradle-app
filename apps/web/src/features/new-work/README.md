# New Work feature

`NewWorkPage` is the outcome-oriented local coding entry point. It reuses the
existing composer/runtime selection controls, requires a local Workspace, calls
`POST /works` once, and starts the first Agent response only after Work creation
succeeds.

Source-dirty and creation failures stay in context. When the source checkout is
dirty, the page offers **Start from origin/main**, which retries creation with
`baseStrategy: remote-default` so local WIP is left untouched. Starting Work
authorizes local isolated execution only and never grants automatic GitHub
delivery.
