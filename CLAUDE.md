# Rules for working in this repo

## Git: branches (owner's rule, no exceptions)

- **NEVER commit directly to `release/*` (or `main`/`master`).** Not even when it is the branch that is checked out.
- All work is committed on **`develop`**. The owner promotes `develop` to the release branch.
- Before EVERY commit run `git branch --show-current`. If it is a release branch, switch to `develop` first.
- Do not merge into or push a release branch unless the owner asks for that promotion.
- A local pre-commit hook (`.git/hooks/pre-commit`) blocks commits on `release/*`, `main` and `master`; it is not versioned, so do not rely on it alone.
