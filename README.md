# HR Dashboard — website version

The website (this folder) is hosted on **GitHub Pages**. Google Apps Script stays behind it as the server:
it checks who is signed in and keeps all data in your Google Sheets, as before.

```
index.html      the dashboard (sign in with Google)
apply.html      public careers page — applicants don't sign in
config.js       ← the only file you edit on GitHub (2 values)
apps-script/    the server code to paste into Apps Script (Code.gs, Index.html, Apply.html) — also your backup
```

## One-time setup (about 15 minutes)

### 1. Create the Google sign-in ID (Google Cloud)
1. Open **console.cloud.google.com** with your company Google account and create a project, e.g. *HR Dashboard*.
2. **APIs & Services → OAuth consent screen**: choose **Internal** (everyone uses @emplanner.team accounts)
   — or **External** if someone on the HR team signs in with a Gmail address. App name: *HR Dashboard*. Save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://YOUR-GITHUB-USERNAME.github.io`
   - Create, then copy the **Client ID** (ends with `.apps.googleusercontent.com`).

### 2. Update Apps Script
1. Paste `apps-script/Code.gs` (and `Index.html`, `Apply.html`) into your Apps Script project as usual.
2. At the top of Code.gs, put the Client ID in `CONFIG.WEB_CLIENT_ID: '…'`. Save.
3. **Deploy → Manage deployments** → edit the deployment that runs **Execute as: Me · Who has access: Anyone**
   (the one you made for the job application form) → Version: **New version** → Deploy.
   No such deployment yet? **Deploy → New deployment → Web app**, Execute as **Me**, access **Anyone**.
4. Copy its **Web app URL** (ends with `/exec`).

### 3. Put the website on GitHub
1. Create a repository (e.g. `hr-dashboard`) and upload everything in this folder.
   Free GitHub Pages needs a **public** repository — the code is visible, but no data or passwords are in it.
2. Edit **config.js** on GitHub: paste the Web app URL into `API_URL` and the Client ID into `CLIENT_ID`. Commit.
3. **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save.
4. After a minute your dashboard is at `https://YOUR-GITHUB-USERNAME.github.io/hr-dashboard/`.
   The careers page is `…/hr-dashboard/apply.html` — Pipeline → Job posts uses it automatically.

## Updating later
- Changed screens → replace `index.html` / `apply.html` on GitHub (keep your `config.js`).
- Changed server → paste the new Code.gs into Apps Script (keep your `WEB_CLIENT_ID`), then Manage deployments → New version.

## Good to know
- Sign in with the same Google account your HR admin added in **Settings → HR team**. Others are refused.
- The dashboard remembers the last data in the browser so it opens instantly, then refreshes.
  **Sign out** (under your name in the sidebar) clears it — do that on shared computers.
- Calendar invites (1:1 calls, drafter check-ins) are now sent from the account that owns the
  Apps Script deployment; the HR person who schedules is added as a guest, so it's on their calendar too.
- The old Apps Script link keeps working, so you can switch over gradually.
