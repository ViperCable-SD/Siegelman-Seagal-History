# Siegelman / Seagal — A Family Archive

A public exhibition of one family: the descendants of Dora and Nathan Seagal. Photographs, documents, recordings, stories, places and dates, presented the way a museum presents a collection — every object carries a wall label with an accession number, a date, a medium, and a credit line.

Built as a small Node/Express app with no database server. Everything — uploads and records alike — lives in one folder, so backing up the archive means copying that folder.

---

## The thirteen sections

| Section | What it holds |
| --- | --- |
| Our Family Story | The front page. Shows the origin story once someone writes one. |
| Family Tree | Everyone, banded by generation, each name opening their page. |
| People | A page per person: dates, biography, their objects, their places. |
| Their Stories | Longer biographies and memories. |
| Photo Albums | Every photograph, arrangeable by album, decade, occasion, or person. |
| Documents & History | Immigration papers, service records, certificates, letters, clippings. |
| Places | A map of every address the family lived at. |
| Timeline | Births and deaths fill in automatically; anyone can add other events. |
| In Their Own Words | Audio and video, with transcripts. |
| Traditions & Recipes | What gets made every year, and who made it first. |
| In Memoriam | Anyone with a recorded date of death, plus written tributes. |
| Next Generations | Living children and grandchildren, behind a passcode. |
| Contribute | Five forms and a message board with threaded replies. |

---

## Run it on your own computer first

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. On the very first run the app reads `seed.json` and plants Dora, Nathan and their nine children, so the site is never empty. Anything you add locally goes into `./data`, which git ignores.

---

## Put it on Render

**1. Get the code onto GitHub.**

```bash
git init
git add .
git commit -m "A family archive"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/siegelman-seagal-history.git
git push -u origin main
```

**2. Create the service.** In Render choose **New → Blueprint** and point it at the repository. Render reads `render.yaml` and sets up the service, the environment variables, and a 10 GB disk at `/var/data`.

**3. Set your three secrets** in the service's Environment tab:

- `ADMIN_KEY` — Render generates this. Copy it somewhere safe.
- `COOKIE_SECRET` — Render generates this. Never needs to be seen.
- `FAMILY_PASSCODE` — you type this one. It is what relatives enter to see Next Generations. Pick something a cousin can read over the phone.

### The disk matters

Render's free tier has no persistent disk, and without one **every photograph and message disappears on each restart or redeploy.** The disk in `render.yaml` needs a paid instance (Starter, around $7/month, plus roughly $0.25/GB for the disk). For an archive meant to outlive the people in it, that is the version worth having.

---

## Being the keeper

Add `?key=YOUR_ADMIN_KEY` to the site address — for example `https://your-site.onrender.com/?key=abc123`. A **Remove** control then appears under every object, story, place, event and message. Removing a message removes its replies too. Removing a person untags them everywhere.

**Adding people to the tree.** New people come in through the API rather than a form, so the tree cannot be vandalised:

```bash
curl -X POST "https://your-site.onrender.com/api/people?key=YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ruth Seagal Kaplan","generation":3,"relation":"Daughter of Ruth","born":"1955"}'
```

`generation` is 1 for Dora and Nathan, 2 for their nine children, 3 for grandchildren, and so on. To correct an existing person, send a `PATCH` to `/api/people/THEIR_ID` with only the fields you want changed. IDs are visible at `/api/bootstrap`.

**Choosing someone's portrait.** By default a person's page uses the first photograph tagged with them. To pin a specific one, `PATCH` their record with `{"portraitId": "THE_MEDIA_ID"}`.

**Back it up.** Copy `/var/data` off Render regularly. Do this before there is anything in it you would grieve.

---

## What's here

```
server.js       the whole backend
seed.json       the starting family, read once on first run
public/
  index.html    the shell and navigation
  styles.css    palette, wall labels, layout
  app.js        router and all thirteen views
render.yaml     deployment settings
```

## When to outgrow this

The JSON store is comfortable into the low thousands of objects. Past that, or once several people upload at the same moment, move to Render Postgres and put files in object storage (Cloudflare R2 or Backblaze B2 are cheap). The API shapes would not change.

## Known gaps

- **No thumbnails.** Full-size scans are served as-is, so a page of large photographs will be slow on a phone. Worth solving early with `sharp`.
- **No spouses or marriage links.** The tree bands people by generation rather than drawing couples and descent lines below the first generation.
- **No search.**
- **No accounts.** Anyone can post under any name; moderation is after the fact, with your key.
- **Contributors cannot edit their own uploads.** A mistake means asking the keeper to remove and re-add it.
