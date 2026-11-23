# Setting up Cleared

Cleared reads Gmail through the official Gmail API, using a Google OAuth client
that you own. Mail goes straight from Google to your browser; there is no Cleared
server in between. You do the Google Cloud part once, about ten minutes, and then
everyone on the team uses the same build.

## 1. Create the Google Cloud project

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a
   project named **Cleared**.
2. Go to **APIs & Services › Library**, search for **Gmail API**, and choose **Enable**.

## 2. Configure the consent screen

In **Google Auth Platform** (formerly **OAuth consent screen**):

1. **Branding:** app name `Cleared`, a support email, and a developer contact.
   If you set the project up when the app was called Glance, rename it here;
   that's the name people see on Google's sign-in screen.
2. **Audience:** choose **External**. External is required because the team
   connects personal @gmail.com accounts as well as Workspace ones. Leave the
   publishing status as **Testing**.
3. **Test users:** add **every address anyone will connect**, personal and
   Workspace, up to 100. An address that isn't listed gets "Access blocked".
4. **Data access:** add these scopes:
   - `.../auth/gmail.modify` (read, archive, label, trash and send mail; it
     cannot permanently delete)
   - `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`

### Testing mode, briefly

- At first sign-in, Google shows **"Google hasn't verified this app"**. Choose
  **Continue**. That's expected for an internal tool, and it's your own app.
- Google expires testing-mode sign-ins every **7 days**. Cleared handles that by
  renewing silently while the browser is still signed in to that Google account.
  If the browser isn't signed in to it, the account shows **Reconnect**: one click.
- Publishing the app publicly would mean Google's verification and a CASA
  security assessment for the `gmail.modify` scope. You don't need that for the team.

### Workspace accounts

If a Workspace admin has restricted third-party apps, Workspace accounts will be
blocked until the admin marks the client as trusted: **Admin console › Security ›
Access and data control › API controls › Manage third-party app access › Add app**,
then paste the client ID from step 3.

## 3. Create the OAuth client

1. Go to **Clients** (or **Credentials › Create credentials › OAuth client ID**).
2. Application type: **Web application**. Name: `Cleared`.
3. Leave the redirect URIs for now; step 5 tells you the one to add.
4. Create the client and copy the **Client ID** and **Client secret**.

Why a Web application client rather than a Chrome extension client: Chrome's
extension client only works with `chrome.identity.getAuthToken`, which knows
just the one Google account signed in to the browser profile. Cleared needs any
number of accounts, so it uses `launchWebAuthFlow` with PKCE and a refresh token
per account, which needs a Web application client.

## 4. Put the client in `.env`

```bash
cp .env.example .env
```

Then fill in the two values:

```
WXT_GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
WXT_GOOGLE_CLIENT_SECRET=...
```

`.env` is ignored by git. The values are built into the extension, where
anyone who has your build can read them. Google treats secrets in installed
apps as not really secret, and every sign-in still needs that user's consent,
but keep your build within your team.

## 5. Build, load, and add the redirect URI

```bash
pnpm install
```

```bash
pnpm build
```

**Chrome:** open `chrome://extensions`, turn on **Developer mode**, choose
**Load unpacked**, and pick `build/glance`.

The OAuth client needs the extension's redirect URI, which comes from its ID
(shown on its card in `chrome://extensions`):

```
https://<extension-id>.chromiumapp.org/oauth2
```

Add it under **Authorized redirect URIs** on the client from step 3. Google
can take a few minutes to start accepting it.

The browser gives an unpacked extension its ID from the folder it was loaded
from, so a teammate loading it elsewhere gets another ID. To give every copy
the same one, put a manifest key in `.env` as `WXT_EXTENSION_KEY` (the public
key, base64, as Chrome's `key` field takes it) and build again.

**Quo:** load the same `build/glance` folder from Quo's Extensions
settings. Quo always derives the ID from the folder, so add its redirect URI
too: the ID is on Cleared's row in Quo's Extensions settings.

**Updating in Quo:** Quo runs its own copy of the folder. After `pnpm build`,
press **Reload** on Cleared in Quo's Extensions settings; that copies the new
build in. Quitting and reopening Quo does not: it restarts the old copy.

Pin Cleared to the toolbar, open it, and choose **Connect a Gmail account**.
Repeat for each account. **⌥⇧G** opens Cleared from anywhere and **⌥⇧P** opens it in
the side panel. Both can be changed at `chrome://extensions/shortcuts`.

## Sharing with the team

```bash
pnpm zip
```

This writes `build/cleared-<version>-chrome.zip`. Teammates unzip it and use
**Load unpacked** on the folder. With a pinned key they get the same extension
ID, so the redirect URI you registered works for them; without one, add each
of theirs. Make sure each of their addresses is a test user (step 2).

To update, rebuild, send the new zip, and they press the reload button on
`chrome://extensions`. Accounts and settings are kept.
