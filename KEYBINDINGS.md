# Keybindings

Cradle keybindings are JSON rules with a key, command, and optional `when` expression:

```json
[
  { "key": "mod+shift+p", "command": "commandPalette.toggle" },
  { "key": "arrowup", "command": "composer.history.previous", "when": "composerFocus && !composerMenuOpen" }
]
```

`when` supports context identifiers, `!`, `&&`, `||`, and parentheses. Unknown identifiers are false. Command owners publish the context values they support; UI commands must not inspect unrelated domain state directly.

The parser and evaluator live in `apps/web/src/keybindings.ts`. Persisted loading and command registration should remain separate: the server owns the Cradle keybindings file, while each feature owns execution of its commands.
