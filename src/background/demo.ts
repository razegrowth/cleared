import { VIEW_QUERY, type Provider } from './provider';
import { getKey } from '../shared/store';
import { escapeHtml, firstName, parseAddressList, textToHtml } from '../shared/mime';
import type { Account, MessageDetail, Person, ThreadSummary } from '../shared/types';

/**
 * Two sample mailboxes that behave like Gmail: actions stick, replies land in
 * the thread, search works. Everything lives in chrome.storage.local, so it
 * survives the worker restarting. Nothing here talks to the network.
 */

interface DemoThread {
  id: string;
  labels: string[];
  messages: MessageDetail[];
}

const MIN = 60_000;
const HOUR = 60 * MIN;

const p = (name: string, email: string): Person => ({ name, email });

export const DEMO_ACCOUNTS: Omit<Account, 'status' | 'notify'>[] = [
  { id: 'alex@northwind.example', email: 'alex@northwind.example', name: 'Alex Rivera', color: '#3b82f6', demo: true },
  { id: 'alex.rivera@mailbox.example', email: 'alex.rivera@mailbox.example', name: 'Alex Rivera', color: '#f97316', demo: true },
];

function message(
  threadId: string,
  n: number,
  from: Person,
  to: Person[],
  ago: number,
  subject: string,
  body: { text?: string; html?: string },
  opts: { unread?: boolean; attachments?: { filename: string; mimeType: string; size: number }[] } = {},
): MessageDetail {
  const id = `${threadId}-m${n}`;
  const text = body.text ?? '';
  return {
    id,
    threadId,
    from,
    to,
    cc: [],
    replyTo: [],
    date: Date.now() - ago,
    subject,
    snippet: (body.text ?? body.html?.replace(/<[^>]+>/g, ' ') ?? '').replace(/\s+/g, ' ').trim().slice(0, 140),
    text: body.text,
    html: body.html,
    attachments: (opts.attachments ?? []).map((a, i) => ({ ...a, id: `${id}-a${i}`, messageId: id, inline: false })),
    unread: opts.unread ?? false,
    messageIdHeader: `<${id}@demo.glance>`,
  };
}

function seed(account: string): DemoThread[] {
  const me = DEMO_ACCOUNTS.find((a) => a.id === account)!;
  const meP = p(me.name, me.email);
  const t = (id: string, labels: string[], messages: MessageDetail[]): DemoThread => ({
    id: `${account.split('@')[0]}-${id}`,
    labels: ['INBOX', ...labels],
    messages: messages.map((m) => ({ ...m, threadId: `${account.split('@')[0]}-${id}` })),
  });

  if (account === DEMO_ACCOUNTS[0].id) {
    const priya = p('Priya Raman', 'priya@northwind.example');
    const jordan = p('Jordan Lee', 'jordan@halcyon.example');
    const sam = p('Sam Okafor', 'sam@northwind.example');
    return [
      t('roadmap', ['UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL'], [
        message('', 1, meP, [priya], 26 * HOUR, 'Q4 roadmap review: notes and next steps', {
          text: 'Hi Priya,\n\nCan you send over the notes from today? I want to get the sequencing locked before the planning offsite.\n\nThanks,\nAlex',
        }),
        message('', 2, priya, [meP], 14 * MIN, 'Re: Q4 roadmap review: notes and next steps', {
          html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2328">
<p>Hi Alex,</p>
<p>Here's where we landed. Short version: we're moving <b>billing v2</b> up and pushing the mobile redesign to January.</p>
<ol>
<li><b>Billing v2</b>: kickoff Monday, Sam owns it</li>
<li><b>Search reindex</b>: stays in October, needs one more backend engineer</li>
<li><b>Mobile redesign</b>: design continues, build starts Jan 6</li>
</ol>
<p>Two open questions for you:</p>
<ul><li>Are we OK telling Halcyon the export API slips two weeks?</li><li>Can you join the Thursday sync to sign off?</li></ul>
<p>Full notes are in <a href="https://example.com/q4-roadmap">the doc</a>. Shout if anything looks off.</p>
<p>Priya</p></div>`,
        }, { unread: true }),
      ]),
      t('contract', ['UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL'], [
        message('', 1, jordan, [meP], 52 * MIN, 'Contract draft for Halcyon: need your eyes by Friday', {
          text: 'Alex,\n\nAttached is the redlined MSA. Legal flagged section 7.2 (liability cap) and the data-retention clause. Everything else is boilerplate.\n\nCould you review by Friday so we can countersign before month end?\n\nBest,\nJordan',
        }, { unread: true, attachments: [{ filename: 'Halcyon-MSA-v3-redline.pdf', mimeType: 'application/pdf', size: 482_113 }] }),
      ]),
      t('lunch', ['UNREAD', 'CATEGORY_PERSONAL'], [
        message('', 1, sam, [meP], 2 * HOUR, 'Lunch Thursday?', {
          text: 'Want to grab lunch Thursday? There\'s a new ramen place on 3rd I\'ve been meaning to try: https://example.com/ramen-on-3rd\n\n12:30 work?\n\nSam',
        }, { unread: true }),
      ]),
      t('deploy', ['UNREAD', 'CATEGORY_UPDATES'], [
        message('', 1, p('Build Bot', 'builds@northwind.example'), [meP], 3 * HOUR, 'Deploy succeeded: web@a3f9c1 to production', {
          html: `<table style="font-family:Menlo,monospace;font-size:13px;color:#24292f;border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#57606a">Service</td><td>web</td></tr><tr><td style="padding:4px 12px 4px 0;color:#57606a">Commit</td><td>a3f9c1 · "Fix pagination on invoices list"</td></tr><tr><td style="padding:4px 12px 4px 0;color:#57606a">Duration</td><td>2m 41s</td></tr><tr><td style="padding:4px 12px 4px 0;color:#57606a">Status</td><td style="color:#1a7f37">● Healthy</td></tr></table>`,
        }, { unread: true }),
      ]),
      t('invoice', ['UNREAD', 'CATEGORY_PERSONAL'], [
        message('', 1, p('Brightline Studio', 'billing@brightline.example'), [meP], 27 * HOUR, 'Invoice #1042 from Brightline Studio', {
          text: 'Hi Alex,\n\nPlease find attached invoice #1042 for October design work ($4,800.00), due in 30 days.\n\nThank you!\nBrightline Studio',
        }, { unread: true, attachments: [{ filename: 'Invoice-1042.pdf', mimeType: 'application/pdf', size: 88_420 }] }),
      ]),
      t('standup', ['CATEGORY_PERSONAL'], [
        message('', 1, priya, [meP], 3 * 24 * HOUR, 'Standup moving to 9:45', { text: 'Starting next week standup moves to 9:45 so the London folks can join.' }),
      ]),
    ];
  }

  const mom = p('Mom', 'linda.rivera@mailbox.example');
  const dana = p('Dana Whitfield', 'dana.w@mailbox.example');
  return [
    t('climb', ['UNREAD', 'CATEGORY_PERSONAL'], [
      message('', 1, dana, [meP], 35 * MIN, 'Climbing this weekend?', {
        text: 'Gym or outdoors? Forecast says Saturday is clear. I can drive if we go to the crag. Bring your new shoes!',
      }, { unread: true }),
    ]),
    t('photos', ['UNREAD', 'CATEGORY_PERSONAL'], [
      message('', 1, mom, [meP], 5 * HOUR, 'Photos from the weekend', {
        text: 'Hi sweetie, here are the pictures from Sunday. The one of Dad with the cake is my favorite. Call me this week?\n\nLove, Mom',
      }, { unread: true, attachments: [
        { filename: 'IMG_2041.jpg', mimeType: 'image/jpeg', size: 2_310_221 },
        { filename: 'IMG_2044.jpg', mimeType: 'image/jpeg', size: 1_984_007 },
      ] }),
    ]),
    t('flight', ['UNREAD', 'IMPORTANT', 'CATEGORY_UPDATES'], [
      message('', 1, p('Aerolinea Travel', 'itinerary@aerolinea.example'), [meP], 9 * HOUR, 'Your flight to Lisbon is confirmed', {
        html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;color:#111">
<div style="background:#0b3d91;color:#fff;padding:18px 20px;border-radius:10px 10px 0 0;font-size:18px;font-weight:600">Booking confirmed · ABX4Q7</div>
<div style="border:1px solid #e5e7eb;border-top:none;padding:18px 20px;border-radius:0 0 10px 10px">
<p style="margin:0 0 6px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.04em">Outbound</p>
<p style="margin:0 0 14px;font-size:16px"><b>SFO → LIS</b> · Fri, Nov 28 · 6:40 PM</p>
<p style="margin:0 0 6px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.04em">Return</p>
<p style="margin:0;font-size:16px"><b>LIS → SFO</b> · Sun, Dec 7 · 11:15 AM</p>
<p style="margin:14px 0 0;font-size:13px;color:#6b7280">Questions? <a href="mailto:help@aerolinea.example?subject=Booking%20ABX4Q7">Email us</a></p>
</div></div>`,
      }, { unread: true }),
    ]),
    t('newsletter', ['UNREAD', 'CATEGORY_PROMOTIONS'], [
      message('', 1, p('The Sunday Edit', 'hello@sundayedit.example'), [meP], 30 * HOUR, 'Seven things worth reading this week', {
        text: 'This week: why cities are planting tiny forests, the quiet comeback of the paper map, and a very good bread recipe.',
      }, { unread: true }),
    ]),
    t('package', ['CATEGORY_UPDATES'], [
      message('', 1, p('Parcel Updates', 'track@parcel.example'), [meP], 2 * 24 * HOUR, 'Your package has shipped', { text: 'Your order is on its way and should arrive Thursday.' }),
    ]),
  ];
}

const key = (accountId: string) => `demo:${accountId}`;

async function load(accountId: string): Promise<DemoThread[]> {
  const stored = await getKey<DemoThread[]>(key(accountId));
  if (stored) return stored;
  const fresh = seed(accountId);
  await save(accountId, fresh);
  return fresh;
}

async function save(accountId: string, threads: DemoThread[]) {
  await chrome.storage.local.set({ [key(accountId)]: threads });
}

export async function resetDemo(accountId: string) {
  await chrome.storage.local.remove(key(accountId));
}

function summary(account: Account, t: DemoThread): ThreadSummary {
  const last = t.messages[t.messages.length - 1];
  const own = account.email;
  const latestOther = [...t.messages].reverse().find((m) => m.from.email !== own) ?? last;
  const participants: string[] = [];
  for (const m of t.messages) {
    const label = m.from.email === own ? 'me' : firstName(m.from);
    if (!participants.includes(label)) participants.push(label);
  }
  return {
    id: t.id,
    accountId: account.id,
    historyId: String(t.messages.length) + t.labels.join(),
    subject: t.messages[0].subject,
    snippet: last.snippet,
    from: latestOther.from,
    participants,
    date: last.date,
    messageCount: t.messages.length,
    unread: t.labels.includes('UNREAD'),
    starred: t.labels.includes('STARRED'),
    important: t.labels.includes('IMPORTANT'),
    hasAttachment: t.messages.some((m) => m.attachments.length > 0),
    labelIds: t.labels,
  };
}

function matches(t: DemoThread, query: string): boolean {
  let rest = query.toLowerCase();
  const need = (label: string) => t.labels.includes(label);
  const checks: [RegExp, () => boolean][] = [
    [/\bin:inbox\b/, () => need('INBOX')],
    [/\bis:unread\b/, () => need('UNREAD')],
    [/\bis:starred\b/, () => need('STARRED')],
    [/\bcategory:primary\b/, () => need('CATEGORY_PERSONAL')],
    [/\bhas:attachment\b/, () => t.messages.some((m) => m.attachments.length)],
  ];
  for (const [re, check] of checks) {
    if (re.test(rest)) {
      if (!check()) return false;
      rest = rest.replace(re, '');
    }
  }
  if (!/\bin:(trash|spam)\b/.test(query) && (need('TRASH') || need('SPAM'))) return false;
  const words = rest.split(/\s+/).filter(Boolean);
  const hay = t.messages
    .map((m) => `${m.subject} ${m.from.name} ${m.from.email} ${m.text ?? ''} ${m.html?.replace(/<[^>]+>/g, ' ') ?? ''}`)
    .join(' ')
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

const DEMO_PDF_NOTE = 'This is a sample attachment from Glance’s demo mailbox.';

export const demo: Provider = {
  async sync(account, view) {
    const threads = await load(account.id);
    return threads
      .filter((t) => matches(t, VIEW_QUERY[view]))
      .map((t) => summary(account, t))
      .sort((a, b) => b.date - a.date);
  },

  async modify(account, threadIds, action) {
    const threads = await load(account.id);
    for (const t of threads) {
      if (!threadIds.includes(t.id)) continue;
      const add = (l: string) => !t.labels.includes(l) && t.labels.push(l);
      const remove = (l: string) => (t.labels = t.labels.filter((x) => x !== l));
      switch (action) {
        case 'read': remove('UNREAD'); t.messages.forEach((m) => (m.unread = false)); break;
        case 'unread': add('UNREAD'); t.messages[t.messages.length - 1].unread = true; break;
        case 'archive': remove('INBOX'); break;
        case 'inbox': add('INBOX'); break;
        case 'star': add('STARRED'); break;
        case 'unstar': remove('STARRED'); break;
        case 'trash': add('TRASH'); remove('INBOX'); break;
        case 'untrash': remove('TRASH'); add('INBOX'); break;
        case 'spam': add('SPAM'); remove('INBOX'); break;
        case 'unspam': remove('SPAM'); add('INBOX'); break;
      }
    }
    await save(account.id, threads);
  },

  async getThread(account, threadId) {
    const t = (await load(account.id)).find((x) => x.id === threadId);
    if (!t) throw new Error('That conversation is gone.');
    return { id: t.id, accountId: account.id, subject: t.messages[0].subject, messages: t.messages, starred: t.labels.includes('STARRED') };
  },

  async getAttachment() {
    return btoa(DEMO_PDF_NOTE);
  },

  async send(account, draft) {
    const threads = await load(account.id);
    const me = { name: account.name, email: account.email };
    const to = parseAddressList(draft.to);
    const existing = draft.threadId ? threads.find((t) => t.id === draft.threadId) : undefined;
    const thread = existing ?? { id: `sent-${Date.now()}`, labels: ['SENT'], messages: [] };
    thread.messages.push({
      id: `${thread.id}-m${thread.messages.length + 1}`,
      threadId: thread.id,
      from: me,
      to,
      cc: parseAddressList(draft.cc),
      replyTo: [],
      date: Date.now(),
      subject: draft.subject,
      snippet: draft.body.slice(0, 140),
      text: draft.body,
      html: `<div>${textToHtml(draft.body)}</div>${draft.quote ? `<blockquote>${escapeHtml(draft.quote.attribution)}</blockquote>` : ''}`,
      attachments: [],
      unread: false,
    });
    if (!existing) threads.push(thread);
    await save(account.id, threads);
  },

  async search(account, query) {
    const threads = await load(account.id);
    return threads.filter((t) => matches(t, query)).map((t) => summary(account, t)).sort((a, b) => b.date - a.date);
  },
};
