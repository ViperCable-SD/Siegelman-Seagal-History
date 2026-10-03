# Siegelman / Seagal — A Family Archive

Public family-history exhibition: photographs, documents, recordings, places and stories for the descendants of Dora and Nathan Seagal, presented museum-style with accession numbers and wall labels. Small Node/Express app (`server.js`) with no database server: records and uploads live together in one data folder, so a backup is a copy of that folder. Deployed on Render (`render.yaml`). `README.md` describes the thirteen sections.

## How to work in this repository

- **Pull requests, never direct commits to `main`.** Create a branch, commit, push, and open a PR. Stephen merges on GitHub. `main` auto-deploys to Render, so anything merged is live within a couple of minutes.
- **Test before you push.** Run the build or start command listed below and confirm it works. If the change touches a page, open it (or render it) and look at it.
- **One change per PR**, with a title that says what changed in plain words and a body Stephen can read without opening the diff.
- **Keep instruction files out of the repo.** Do not commit READ-ME-FIRST, zips, or scratch files. The only documentation that belongs here is what a future maintainer needs.
- **Explain in plain language.** Stephen is not a developer. Say what changed and where to look, not how git works. Do not ask him to run terminal commands; do the work in the PR.
- **Secrets stay out of the code.** Passwords, API keys, and tokens live in Render's environment settings, never in a committed file.

## Build and run

```
npm ci
npm start        # http://localhost:3000
```

There is no build step; the server serves `public/` and reads/writes the data folder directly.

## Where things live

| Area | Path |
| --- | --- |
| Server, routes, upload handling (multer) | `server.js` |
| Pages, styles, client scripts | `public/` |
| Starter records | `seed.json` |
| Render configuration, including the persistent disk mounted at `/var/data` (`DATA_DIR`) | `render.yaml` |

## Watch out for

- **The data folder is the archive.** Never write code that rewrites, renames, or deletes files in it wholesale. Additive changes only, and say so in the PR.
- "Next Generations" (living minors) sits behind a passcode. Do not loosen that, and do not log or expose its contents.
- This is a public site about real people. Keep names, dates and photos exactly as recorded; do not invent, infer, or "tidy" biographical details.
