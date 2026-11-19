# Setting up Glance

Glance reads Gmail through the official Gmail API, using a Google OAuth client
that you own. Mail goes straight from Google to your browser; there is no Glance
server in between. You do the Google Cloud part once, about ten minutes, and then
everyone on the team uses the same build.

## 1. Create the Google Cloud project

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a
   project named **Glance**.
2. Go to **APIs & Services › Library**, search for **Gmail API**, and choose **Enable**.

## 2. Configure the consent screen

In **Google Auth Platform** (formerly **OAuth consent screen**):

1. **Branding:** app name `Glance`, a support email, and a developer contact.
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
- Google expires testing-mode sign-ins every **7 days**. Glance handles that by
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
2. Application type: **Web application**. Name: `Glance`.
3. Under **Authorized redirect URIs**, add:

   ```
   https://aiiajjnmbdmphlgpjonnpffadapdiegl.chromiumapp.org/oauth2
   ```

   That's Glance's ID in Chrome and every other Chromium browser, on every
   machine. The `key` in `wxt.config.ts` pins it.

   **For Quo:** Quo ignores the manifest key and derives an unpacked
   extension's ID from the folder it was loaded from. For this machine's build
   folder (`~/Apps/Glance/build/glance`) that is:

   ```
   https://nplbohanankmacbmhofphnohdecfjkpb.chromiumapp.org/oauth2
   ```

   Add that as a second redirect URI. If you load Glance from somewhere else,
   **Settings › Google connection** in Glance shows the exact URI to add.
4. Create the client and copy the **Client ID** and **Client secret**.

Why a Web application client rather than a Chrome extension client: Chrome's
extension client only works with `chrome.identity.getAuthToken`, which knows
just the one Google account signed in to the browser profile. Glance needs any
number of accounts, so it uses `launchWebAuthFlow` with PKCE and a refresh token
per account, which needs a Web application client.

## 4. Give Glance the client

Either build it in, for the whole team:

```bash
cp .env.example .env
```

Then put the two values into `.env`:

```
WXT_GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
WXT_GOOGLE_CLIENT_SECRET=GOCSPX-...
```

Or paste them into **Settings › Google connection** in a build that doesn't have them.

The secret ends up inside the built extension, where anyone who has the
extension can read it. Google treats secrets in installed apps as not really
secret, and every sign-in still needs that user's consent, but keep the built
zip within the team.

## 5. Build and load

```bash
pnpm install
```

```bash
pnpm build
```

**Chrome:** open `chrome://extensions`, turn on **Developer mode**, choose
**Load unpacked**, and pick `build/glance`.

**Quo:** load the same `build/glance` folder from Quo's Extensions
settings, then make sure Quo's redirect URI from step 3 is on the client.

**Updating in Quo:** Quo runs its own copy of the folder. After `pnpm build`,
press **Reload** on Glance in Quo's Extensions settings; that copies the new
build in. Quitting and reopening Quo does not: it restarts the old copy.

Pin Glance to the toolbar, open it, and choose **Connect a Gmail account**.
Repeat for each account. **⌥⇧G** opens Glance from anywhere and **⌥⇧P** opens it in
the side panel. Both can be changed at `chrome://extensions/shortcuts`.

## Sharing with the team

```bash
pnpm zip
```

This writes `build/glance-<version>-chrome.zip`. Teammates unzip it and use
**Load unpacked** on the folder. Thanks to the pinned key they get the same
extension ID, so the redirect URI you already registered works for them. Make
sure each of their addresses is a test user (step 2).

To update, rebuild, send the new zip, and they press the reload button on
`chrome://extensions`. Accounts and settings are kept.
