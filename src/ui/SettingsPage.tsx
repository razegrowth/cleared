import { CircleAlert, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar } from './Avatar';
import { MOD, TEXT_SCALES, useMail, useTheme } from './hooks';
import { Tips } from './Tips';
import { ToastProvider, useToasts } from './Toasts';
import { Logo } from './Logo';
import { request } from '../shared/store';
import type { Account, Settings } from '../shared/types';

export function SettingsPage() {
  const state = useMail();
  useTheme(state?.settings);
  if (!state) return null;
  return (
    <ToastProvider>
      <Page accounts={state.accounts} settings={state.settings} />
      <Tips />
    </ToastProvider>
  );
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="s-section">
      <h2>{title}</h2>
      {hint && <p className="s-hint">{hint}</p>}
      <div className="s-card">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="s-row">
      <div className="s-label">
        <div>{label}</div>
        {hint && <div className="s-sub">{hint}</div>}
      </div>
      <div className="s-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Page({ accounts, settings }: { accounts: Account[]; settings: Settings }) {
  const { push } = useToasts();
  const set = (patch: Partial<Settings>) =>
    request({ type: 'updateSettings', patch }).catch((e: Error) => push({ text: e.message, error: true }));
  const fail = (e: Error) => push({ text: e.message, error: true, ms: 8000 });

  const configured = !!import.meta.env.WXT_GOOGLE_CLIENT_ID;
  const [vips, setVips] = useState(settings.vips.join('\n'));
  useEffect(() => setVips(settings.vips.join('\n')), [settings.vips.join('\n')]);


  return (
    <main className="s-page">
      <header className="s-header">
        <Logo size={40} />
        <div>
          <h1>Cleared</h1>
          <p>Settings</p>
        </div>
      </header>

      <Section title="Accounts">
        {accounts.length === 0 && <div className="s-empty">No accounts yet.</div>}
        {accounts.map((a) => (
          <div className="s-account" key={a.id}>
            <Avatar person={a} picture={a.picture} size="md" tint={a.color} />
            <div className="s-account-main">
              <div className="s-account-name">
                {a.email}
                {a.demo && <span className="tag">Sample</span>}
              </div>
              <div className="s-sub">
                {a.status === 'needs-auth' ? (
                  <span className="warn">
                    <CircleAlert size={12} /> Signed out by Google
                  </span>
                ) : a.status === 'error' ? (
                  <span className="warn">
                    <CircleAlert size={12} /> {a.error}
                  </span>
                ) : (
                  a.name
                )}
              </div>
            </div>
            <div className="s-account-actions">
              {settings.view !== 'unread-primary' && (
                <label className="s-inline" title="List only this account's Primary tab, leaving out Promotions, Social, Updates and Forums">
                  <span>Primary only</span>
                  <Toggle
                    label={`Primary only for ${a.email}`}
                    checked={!!a.primaryOnly}
                    onChange={(v) => request({ type: 'updateAccount', accountId: a.id, patch: { primaryOnly: v } }).catch(fail)}
                  />
                </label>
              )}
              <label className="s-inline">
                <span>Notify</span>
                <Toggle
                  label={`Notifications for ${a.email}`}
                  checked={a.notify}
                  onChange={(v) => request({ type: 'updateAccount', accountId: a.id, patch: { notify: v } })}
                />
              </label>
              {a.status === 'needs-auth' && (
                <button className="btn primary" onClick={() => request({ type: 'reauth', accountId: a.id }).catch(fail)}>
                  <RefreshCw /> Reconnect
                </button>
              )}
              <button
                className="icon-btn"
                title="Remove account"
                onClick={() => {
                  if (confirm(`Remove ${a.email} from Cleared? Your mail in Gmail is not touched.`)) {
                    request({ type: 'removeAccount', accountId: a.id }).catch(fail);
                  }
                }}
              >
                <Trash2 />
              </button>
            </div>
          </div>
        ))}
        <div className="s-row s-actions">
          <button className="btn primary" disabled={!configured} onClick={() => request({ type: 'addAccount' }).catch(fail)}>
            <Plus /> Add Gmail account
          </button>
          {!accounts.some((a) => a.demo) && (
            <button className="btn" onClick={() => request({ type: 'addDemo' }).catch(fail)}>
              Add sample mail
            </button>
          )}
          {!configured && <span className="s-sub">This build has no Google OAuth client. See SETUP.md.</span>}
        </div>
      </Section>

      <Section title="Mailbox">
        <Row label="Show" hint="Primary leaves out Promotions, Social, Updates and Forums. To do that for some accounts only, use Primary only next to each one above.">
          <Segmented
            value={settings.view}
            onChange={(view) => set({ view })}
            options={[
              ['unread-inbox', 'Unread'],
              ['unread-primary', 'Unread in Primary'],
              ['inbox', 'Whole Inbox'],
            ]}
          />
        </Row>
        <Row label="Check for mail" hint="Cleared also checks whenever you open it.">
          <select value={settings.pollMinutes} onChange={(e) => set({ pollMinutes: Number(e.target.value) })}>
            {[
              [0.5, 'Every 30 seconds'],
              [1, 'Every minute'],
              [2, 'Every 2 minutes'],
              [5, 'Every 5 minutes'],
              [15, 'Every 15 minutes'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Inbox tabs" hint="A tab for each inbox above the list. Without them, 1–9 and A still switch inboxes.">
          <Toggle label="Inbox tabs" checked={settings.inboxTabs} onChange={(inboxTabs) => set({ inboxTabs })} />
        </Row>
        {settings.inboxTabs && (
          <Row label="Full addresses in inbox tabs" hint="Show alex@northwind.example instead of alex in the tabs above the list.">
            <Toggle label="Full addresses in inbox tabs" checked={settings.fullAddresses} onChange={(fullAddresses) => set({ fullAddresses })} />
          </Row>
        )}
        <Row label="Full emails in the list" hint="Show each conversation's whole latest message instead of two lines. Also V.">
          <Toggle label="Full emails in the list" checked={settings.fullPreviews} onChange={(fullPreviews) => set({ fullPreviews })} />
        </Row>
        <Row label="Mark as read when opened">
          <Toggle label="Mark as read when opened" checked={settings.markReadOnOpen} onChange={(markReadOnOpen) => set({ markReadOnOpen })} />
        </Row>
        <Row label="Remote images" hint="Blocking them stops senders from seeing when you open their mail.">
          <Segmented
            value={settings.remoteImages}
            onChange={(remoteImages) => set({ remoteImages })}
            options={[
              ['ask', 'Ask first'],
              ['always', 'Always load'],
            ]}
          />
        </Row>
        <Row label="Text size" hint="Mail in the list and the reader. ⌘+ and ⌘− change it too, and ⌘0 puts it back.">
          <select value={settings.textScale ?? 1} onChange={(e) => set({ textScale: Number(e.target.value) })}>
            {TEXT_SCALES.map((v) => (
              <option key={v} value={v}>
                {v === 1 ? '100% (default)' : `${Math.round(v * 100)}%`}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Undo send" hint="How long Cleared waits before a message really goes. Undo, or Z, in that time brings it back.">
          <select value={settings.undoSendSeconds} onChange={(e) => set({ undoSendSeconds: Number(e.target.value) })}>
            {[0, 5, 10, 20].map((s) => (
              <option key={s} value={s}>
                {s === 0 ? 'Off' : `${s} seconds`}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Notifications">
        <Row label="Notify me about new mail">
          <Toggle label="Notifications" checked={settings.notifications} onChange={(notifications) => set({ notifications })} />
        </Row>
        <Row
          label="Test"
          hint="If nothing shows up, allow notifications for your browser in System Settings › Notifications, and check Focus."
        >
          <button
            className="btn"
            onClick={() =>
              request<{ level: string } | null>({ type: 'testNotification' })
                .then((result) =>
                  push(
                    result?.level === 'denied'
                      ? { text: 'Your browser has notifications blocked for Cleared.', error: true, ms: 8000 }
                      : { text: 'Sent. Look at the top right of your screen.', ms: 4000 },
                  ),
                )
                .catch(fail)
            }
          >
            Send a test notification
          </button>
        </Row>
        <Row label="Only from VIPs" hint="Everyone else still shows up in Cleared, just quietly.">
          <Toggle label="Only VIPs" checked={settings.vipOnly} onChange={(vipOnly) => set({ vipOnly })} />
        </Row>
        <Row label="VIPs" hint="One per line: an address, or a whole domain like client.com.">
          <textarea
            className="s-textarea"
            rows={3}
            value={vips}
            onChange={(e) => setVips(e.target.value)}
            onBlur={() => set({ vips: vips.split(/[\n,]/).map((v) => v.trim()).filter(Boolean) })}
            placeholder={'ceo@company.com\nclient.com'}
          />
        </Row>
        <Row label="Quiet hours">
          <div className="s-inline">
            <Toggle
              label="Quiet hours"
              checked={settings.quietHours.enabled}
              onChange={(enabled) => set({ quietHours: { ...settings.quietHours, enabled } })}
            />
            <input
              type="time"
              value={settings.quietHours.start}
              disabled={!settings.quietHours.enabled}
              onChange={(e) => set({ quietHours: { ...settings.quietHours, start: e.target.value } })}
            />
            <span className="s-sub">to</span>
            <input
              type="time"
              value={settings.quietHours.end}
              disabled={!settings.quietHours.enabled}
              onChange={(e) => set({ quietHours: { ...settings.quietHours, end: e.target.value } })}
            />
          </div>
        </Row>
      </Section>

      <Section title="Appearance">
        <Row label="Open Cleared in" hint="What the toolbar button opens. In the side panel, pressing it again closes the panel.">
          <Segmented
            value={settings.surface}
            onChange={(surface) => set({ surface })}
            options={[
              ['popup', 'Popup'],
              ['panel', 'Side panel'],
            ]}
          />
        </Row>
        <Row label="Theme">
          <Segmented
            value={settings.theme}
            onChange={(theme) => set({ theme })}
            options={[
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
          />
        </Row>
      </Section>

      <Section title="Keyboard">
        <div className="s-keys">
          {[
            ['j / k', 'Next / previous'],
            ['↵ or o', 'Open'],
            ['esc or u', 'Back to list'],
            ['e', 'Archive'],
            ['#', 'Delete'],
            ['r', 'Mark read / unread'],
            ['s', 'Star'],
            ['h', 'Snooze'],
            ['!', 'Report spam'],
            ['x', 'Select'],
            ['v', 'Full emails in the list'],
            ['↵ / a', 'Reply / reply all (in an email)'],
            ['c', 'New message'],
            ['/', 'Search'],
            ['z', 'Undo'],
            ['g', 'Open in Gmail'],
            ['a', 'All inboxes'],
            ['1–9', 'One inbox'],
            ['⇧R', 'Check for mail'],
            [`. or ${MOD}K`, 'Command palette'],
            [`${MOD}↵`, 'Send'],
            ['⌥⇧G', 'Open Cleared from anywhere'],
          ].map(([k, l]) => (
            <div key={k} className="s-key">
              <kbd>{k}</kbd>
              <span>{l}</span>
            </div>
          ))}
        </div>
      </Section>

    </main>
  );
}
