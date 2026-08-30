# Submit server recovery with Enter

- **Date:** 2026-08-29
- **Problem:** The server recovery address looked and behaved like an input form except that Enter did nothing.
- **Motivation:** Connection recovery is already an interruption; native keyboard submission removes avoidable friction.
- **Product behavior:** Enter connects to a valid hosted endpoint, or retries the fixed local endpoint on desktop. Secondary test/reset controls remain explicit.
- **Implementation:** The fixture-driven recovery View now uses native form submission with the existing busy and empty-value guards.
- **Systems affected:** Server connection recovery View.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** Submission intentionally follows the primary action rather than the non-mutating “Test connection” action.
- **Follow-up ideas:** None.
- **Out of scope:** Connection policy, timeout behavior, and endpoint persistence.
