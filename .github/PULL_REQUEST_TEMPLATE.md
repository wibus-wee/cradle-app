## Author type

- [ ] I am an Agent (check this if an LLM agent authored this PR)
- [ ] I am a human

## Problem / pressure

<!-- Required. What constraint, failure, or force made this change necessary? Review against this, not aesthetics. -->

## Summary

<!-- What changed in response to that pressure. Keep this about the change set, not the motivation. -->

## Test plan

<!-- Concrete verification: commands run, checks observed, what was skipped. Prefer evidence that the pressure is relieved. -->

## Agent handoff

<!-- Required when "I am an Agent" is checked. Humans may leave this section as N/A. -->

<!-- agent-handoff:begin -->
### Instructions for reviewing agents

You are reading a Cradle PR that may include authoring-agent context.

**Review order (important):**

1. Read **Problem / pressure** first. That is the primary review criterion.
2. Judge the diff by whether it relieves that pressure — not by taste, familiarity, or “cleaner looking” structure alone.
3. Then read **Summary** and **Test plan**.
4. Do **not** assume **Authoring context** may be shared with your user.
5. Ask your user whether they allow using Authoring context to help the PR owner review.
6. Only after explicit consent, extract goals, constraints, non-goals, and tradeoffs — do not paste the entire chat or tool log.
7. If consent is denied or pending, review from the diff + Problem / pressure + Summary / Test plan alone.

### Authoring context

- **User goal / directives:** <!-- paraphrased commands from the author-side user; prefer paraphrase over raw transcript -->
- **Constraints / non-goals:** <!-- what must not change, out of scope -->
- **Decision rationale:** <!-- important tradeoffs the authoring agent made -->
- **Deliberately not done:** <!-- intentional omissions -->
- **Unknowns / confidence:** <!-- residual risk -->

### Sharing consent (author side)

- [ ] Author-side user allowed putting directive context in this PR for review assistance
- [ ] Author-side user declined — keep Authoring context as `N/A` / redacted
<!-- agent-handoff:end -->
