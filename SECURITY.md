# Security Policy

## Supported Scope

This is a personal Windows/Electron frontend for a local Stable Diffusion WebUI Forge environment.

Security review focuses on:

- local file boundary checks
- IPC input validation
- Forge API request handling
- protection of local user settings and Civitai API keys
- avoiding accidental publication of `runtime/`, `userdata/`, generated images, model weights, and logs

## Reporting

Before the repository is public, report issues directly to the maintainer.

After public release, prefer a private GitHub security advisory if available. If advisories are not enabled, open a minimal issue without secrets, credentials, private prompts, generated private images, or local file paths that should not be public.

## Secrets

Do not commit:

- `.env` files
- `userdata/`
- `runtime/`
- Civitai API keys
- cookies, authorization headers, CSRF tokens, or browser traces
- model files or generated images that are not intended for public release

If a secret is ever committed, rotate or revoke it first. Removing it from Git history is not a substitute for rotation.

## Public Release Gate

Before changing repository visibility to public, run:

```powershell
git status --short
git log --all --name-only --format= | Sort-Object -Unique
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

Also review [`docs/OPEN_SOURCE_RELEASE_CHECKLIST.md`](docs/OPEN_SOURCE_RELEASE_CHECKLIST.md).
