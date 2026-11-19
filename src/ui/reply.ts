import { displayAddress, textToHtml } from '../shared/mime';
import { longDate } from '../shared/format';
import type { Account, Draft, Person, ThreadDetail } from '../shared/types';

const list = (people: Person[]) => people.map(displayAddress).join(', ');

/**
 * Who a reply goes to, the way Gmail decides: the newest message someone
 * else sent (honouring Reply-To), or, if you sent the last one, the people
 * you sent it to. Reply all adds everyone else on that message as Cc.
 */
export function replyDraft(account: Account, thread: ThreadDetail, all: boolean): Draft {
  const me = account.email.toLowerCase();
  const msgs = thread.messages;
  const last = msgs[msgs.length - 1];
  const target = [...msgs].reverse().find((m) => m.from.email.toLowerCase() !== me) ?? last;
  const fromMe = target.from.email.toLowerCase() === me;

  const to: Person[] = fromMe ? target.to : target.replyTo.length ? target.replyTo : [target.from];
  const seen = new Set([me, ...to.map((p) => p.email.toLowerCase())]);
  const cc: Person[] = [];
  if (all) {
    for (const p of [...target.to, ...target.cc]) {
      const e = p.email.toLowerCase();
      if (!seen.has(e)) {
        seen.add(e);
        cc.push(p);
      }
    }
  }

  const subject = /^re:/i.test(target.subject) ? target.subject : `Re: ${target.subject}`;
  return {
    accountId: account.id,
    threadId: thread.id,
    to: list(to),
    cc: list(cc),
    bcc: '',
    subject,
    body: '',
    inReplyTo: target.messageIdHeader,
    references: target.references,
    quote: {
      attribution: `On ${longDate(target.date)}, ${target.from.name} <${target.from.email}> wrote:`,
      html: target.html ?? textToHtml(target.text ?? target.snippet),
    },
  };
}

export function blankDraft(accountId: string): Draft {
  return { accountId, to: '', cc: '', bcc: '', subject: '', body: '' };
}
