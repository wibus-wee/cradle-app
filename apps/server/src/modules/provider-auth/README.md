# Provider Auth

Owns the generic lifecycle for encrypted provider credentials. Drivers retain
provider-specific login, token formats, expiry, refresh endpoints, and public
account projection. The lifecycle reads and updates `agent_credentials` through
the secrets owner, coalesces in-process refreshes by credential reference, and
does not cache plaintext credentials after a refresh completes.
