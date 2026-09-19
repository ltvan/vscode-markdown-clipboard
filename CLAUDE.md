## Workflow

Every non-trivial change: **requirement → spec → plan → implement (TDD) → review**.

1. **Requirement** — the epic in `docs/epics/`, else the spec's own goal/problem statement. Clarify ambiguities with the user first.
2. **Spec** — `docs/specs/YYMMDD-<topic>-design.md`; run `spec-reviewer` (tell it where the requirement lives) until `aligned`.
3. **Plan** — `docs/plans/YYMMDD-<topic>-plan.md`; run `plan-reviewer` until `ready`.
4. **Implement** — failing test → pass → refactor. Where unit tests can't apply (infra, shell), write by-hand e2e cases first and verify against them.
5. **Review** — `/simplify`, `/code-review`, `/security-review` where installed; weigh feedback as code owner.

Run docs audit subagent after a merge or when drift is suspected.

Quality gates: `pnpm format && pnpm lint && pnpm typecheck && pnpm test` (e2e opens a VS Code window and overwrites the clipboard; `pnpm test:unit` is the fast loop).

Commits: [docs/git-convention.md](docs/git-convention.md) — `<type>(<scope>): [issue ID] <subject>`.
