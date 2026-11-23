# Cleared

Every Gmail inbox you use, cleared at keyboard speed. A Chrome extension (it also
runs in Quo) that shows the unread mail from all your Google accounts in one
list, in a popup or the side panel, and lets you read, reply and clear it
without opening Gmail.

- **All accounts, one list.** Personal and Workspace side by side, each with its
  own colour. Filter to one with a click, or with `1`–`9`.
- **Triage at speed.** Archive, delete, mark read or unread, star, snooze and
  report spam, from the keyboard, with undo on everything (`z`).
- **Read and reply in place.** Full HTML mail, rendered safely: no scripts, and
  remote images held back until you ask, so tracking pixels don't fire on open.
  Replies thread properly, drafts save as you type, and sends can be undone.
- **Notifications that respect you.** Per account, VIP-only if you like, quiet
  hours, and Mark read / Archive straight from the notification.
- **Side panel.** Opened wide, it becomes a split view: list on the left,
  conversation on the right.
- **`.`** (or **⌘K**, where the browser doesn't keep it for itself) opens a command palette with every action and its shortcut, plus
  search across all inboxes using Gmail's own operators.

## How it works

Cleared uses the official **Gmail API** with OAuth, one refresh token per
account. Checker Plus scrapes Gmail's private feeds and internal endpoints,
which break whenever Google changes them; Cleared doesn't.

- `src/background/`: the service worker. `auth.ts` handles OAuth (PKCE, refresh,
  silent re-auth), `gmail.ts` is the API client (backoff on rate limits, only
  re-fetching threads whose `historyId` changed), and `engine.ts` holds sync,
  optimistic actions with undo, snooze, delayed send, notifications and the
  badge. `demo.ts` is the sample mailbox, behind the same interface as Gmail.
- `src/ui/`: React for the popup, side panel and settings. The UI renders from
  `chrome.storage.local` and sends every change to the worker as a message,
  so closing the popup never loses an action.
- Gmail's API has no snooze, so Cleared keeps its own: the thread is archived,
  then brought back to the inbox, unread, when it's due. That happens while the
  browser runs; anything due while it was closed returns at the next start.

## Setup

See **[SETUP.md](SETUP.md)** for the Google Cloud project, OAuth client, and how
to load and share the extension. To look around before setting that up, choose
**Try it with sample mail** on the welcome screen.

## Development

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev` opens a Chrome with Cleared loaded and reloading as you edit.

```bash
pnpm preview
```

`pnpm preview` runs the UI and the background code in one ordinary page, with
`chrome.*` faked in memory and the sample mailbox loaded. Open
<http://localhost:5199/?layout=popup>, `?layout=panel`, or `?layout=settings`.
Add `&theme=dark`, or `&empty` for the first-run screen.

```bash
pnpm test
```

```bash
pnpm typecheck
```

### Keyboard

| Key | | Key | |
|---|---|---|---|
| `j` / `k` | next / previous | `e` | archive |
| `↵` / `o` | open | `#` | delete |
| `esc` / `u` | back | `r` | read / unread |
| `↵` / `a` | reply / reply all (in an email) | `s` | star |
| `c` | new message | `h` | snooze |
| `/` | search | `x` | select |
| `z` | undo | `!` | spam |
| `g` | open in Gmail | `a` / `1`–`9` | all inboxes / one inbox |
| `.` / `⌘K` | command palette | `⌘↵` | send |
