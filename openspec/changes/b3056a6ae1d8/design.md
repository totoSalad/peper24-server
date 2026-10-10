# Design: Grammar correction deduplication

Keep the change inside `GrammarService.prepare()`, after the existing `normalize()` call and before appending a detail to its error-type group. Compare the four normalized fields using a collision-safe representation or direct equality; do not change normalization. Preserve the first value encountered. Leave repository SQL, schema, conversation orchestration, and AI contracts intact. Update `docs/grammar.md` to state the exact duplicate rule.

Verification uses focused GrammarService unit tests and the existing conversation integration suite. The target repository's configured build, lint, unit, and isolated integration gates remain required.
