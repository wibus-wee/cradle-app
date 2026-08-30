# Make the mobile Work base truthful

- **Date:** 2026-08-31
- **Problem:** The mobile Work composer offered “Current HEAD” and “Remote default branch,” but the selected strategy never reached the Work creation request. Both selector entry points silently created from the current checkout.
- **Motivation:** A branch choice must be dependable because it determines the code an isolated task starts from. A truthful fixed state is safer than an inert control.
- **Product behavior:** The composer now labels the base as “Current checkout” without presenting it as selectable. The Work type footer is informational rather than an unrelated menu trigger.
- **Implementation:** Removed the unsubmitted base-strategy state and native menus. Work creation continues to omit `baseBranch`, which is the server-owned contract for starting from the current checkout.
- **Systems affected:** Shared mobile Work composer and mobile product documentation.
- **Validation:** Mobile TypeScript typecheck and scoped ESLint.
- **Tradeoffs:** Mobile does not yet choose an exact base branch. Adding that requires the same server-backed branch list and explicit-ref behavior used by desktop.
- **Follow-up ideas:** Add a fixture-driven mobile branch picker that submits an exact `baseBranch` when repository workflows justify it.
