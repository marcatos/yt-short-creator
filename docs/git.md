# Git: commit and push to main

This personal public repo (`marcatos/yt-short-creator`) **ships on `main`**. Finished work must exist on GitHub, not only on the local machine.

## Agent policy

### Always commit

Commit as you go. Each logically independent change gets its own Conventional Commit (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`, …). Do not hold a finished feature only in the working tree.

### When a work stream is finished

A stream is finished when the requested feature/fix is done, the user ends the thread, or you would otherwise stop coding.

Then **all of that stream must be on `main` and pushed**:

```bash
git status
git push origin HEAD
git status -sb
```

`git status -sb` must show `main` tracking `origin/main` with **no ahead/behind**. If you are ahead, push. If you used a side branch, integrate into `main` first, then push `main`.

Do not skip commit or push because a global instruction says "only when the user asks". **In this repo, finishing the stream includes commit + push.**

### Do not

- Force-push `main`
- Commit secrets (`.env`, `.env.local`, credentials, tokens)
- Mix unrelated WIP from another agent/session into your commit
- Leave this stream's files untracked or unstaged "for later"

Remote: `git@github.com-personal:marcatos/yt-short-creator.git` (account `marcatos`).
