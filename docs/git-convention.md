# Git Convention

## Change log

If the repo generates its change log and release notes from commit messages, that generator reads the commit header, so the convention below is mandatory; the contributor guide states whether it does.

## Commit Message Format

A commit message consists of a **header**, **body** and **footer**. The header has a **type**, **scope** and **subject**:

```
<type>(<scope>): [issue ID] <subject>
<BLANK LINE>
<body>
<BLANK LINE>
<footer>
```

The **header** is mandatory; the **scope** and the **issue ID** are optional (brackets mark optional parts — the ID is written bare, e.g. `fix: ABC-123 handle empty cart`).

### Type

Must be one of the following:

- ✨ feat: A new feature
- 🐛 fix: A bug fix
- 📚 docs: Documentation only changes
- 💎 style: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- 📦 refactor: A code change that neither fixes a bug nor adds a feature
- 🚀 perf: A code change that improves performance
- 🚨 test: Adding missing or correcting existing tests
- 🛠 build: Changes that affect the build system or external dependencies
- ⚙️ ci: Changes to our CI configuration files and scripts
- ♻️ chore: Changes to the build process or auxiliary tools and libraries such as documentation generation
- 🗑 revert: Reverts a previous commit

Every commit should be a complete feature, improvement, or bug fix, i.e. testable and independable.

Where the change log is generated from commits, `feat`, `fix` and `perf` commits appear in it, and any commit with a [BREAKING CHANGE](#footer) always does.

### Work-in-progress

Temporary commits should begin with `WIP:`. They are to be meld into one of above types after finishing. DO NOT leave `WIP` commit and merge them to stable branches.

### Revert

If the commit reverts a previous commit, it should begin with `revert: `, followed by the header of the reverted commit. In the body it should say: `This reverts commit <hash>.`, where the hash is the SHA of the commit being reverted.

### Scope

The scope could be anything specifying place of the commit change. For example `User`, `Role`, etc...

### Subject

The subject contains succinct description of the change:

- use the imperative, present tense: "change" not "changed" nor "changes"
- may start with an issue ID like `ABC-123` (upper- or lowercase); the ID is exempt from the case rule
- sentence case: the subject text (after any issue ID) starts with a lowercase letter, e.g. `fix: ABC-123 navigate to detail page from push notification`; if the repo runs commitlint with `subject-case`, it rejects `fix: ABC-123 Navigate ...` and `fix: Navigate ...`
- no dot (.) at the end

### Body

Just as in the **subject**, use the imperative, present tense: "change" not "changed" nor "changes". The body should include the motivation for the change and contrast this with previous behavior.

### Footer

The footer should contain any information about **Breaking Changes** and is also the place to reference the issues this commit **Closes**.

**Breaking Changes** should start with the word `BREAKING CHANGE:` with a space or two newlines. The rest of the commit message is then used for this.

## Reference

Based on https://github.com/angular/angular.js/blob/master/CONTRIBUTING.md#commit
