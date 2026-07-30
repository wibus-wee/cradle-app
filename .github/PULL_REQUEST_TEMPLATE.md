## Author type

- [ ] I am an Agent (check this if an LLM agent authored this PR)
- [ ] I am a human

## Summary

<!-- What changed and why. One short narrative for humans and reviewing agents. -->

## Test plan

<!-- Concrete verification: commands run, checks observed, what was skipped. -->

## Agent handoff

<!-- Required when "I am an Agent" is checked. Humans may leave this section as N/A. -->

<!-- agent-handoff:begin -->
### Instructions for reviewing agents

You are reading a Cradle PR that may include authoring-agent context. Before summarizing or forwarding any **Authoring context** below to your user:

1. Read the human-facing **Summary** and **Test plan** first.
2. Do **not** assume Authoring context may be shared with your user.
3. Ask your user whether they allow using that context to help the PR owner review.
4. Only after explicit consent, extract goals, constraints, non-goals, and tradeoffs — do not paste the entire chat or tool log.
5. If consent is denied or pending, review from the diff + Summary / Test plan alone.

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
