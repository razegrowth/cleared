import * as engine from './engine';
import type { Request, Response } from '../shared/types';

export async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'refresh':
      return req.accountId ? engine.syncAccount(req.accountId) : engine.syncAll();
    case 'addAccount':
      return engine.addAccount();
    case 'addDemo':
      return engine.addDemo();
    case 'removeAccount':
      return engine.removeAccount(req.accountId);
    case 'reauth':
      return engine.reauth(req.accountId);
    case 'updateAccount':
      return engine.updateAccount(req.accountId, req.patch);
    case 'act':
      return engine.act(req.action, req.items);
    case 'snooze':
      return engine.snooze(req.items, req.until);
    case 'undo':
      return engine.undo(req.undoId);
    case 'getThread':
      return engine.getThread(req.accountId, req.threadId);
    case 'getAttachment':
      return engine.getAttachment(req.accountId, req.messageId, req.attachmentId);
    case 'send':
      return engine.send(req.draft);
    case 'cancelSend':
      return engine.cancelSend(req.sendId);
    case 'search':
      return engine.search(req.query);
    case 'updateSettings':
      return engine.updateSettings(req.patch);
    case 'testNotification':
      return engine.testNotification();
    case 'openPanel':
      if (req.windowId !== undefined) await chrome.sidePanel.open({ windowId: req.windowId });
      return;
    default:
      // A page newer than the worker: the browser reloaded the pages but kept the old worker.
      throw new Error('Glance’s background is out of date. Quit and reopen your browser to finish updating.');
  }
}

/** Wraps a request so errors cross the message boundary as text, never as a hang. */
export async function respond(req: Request): Promise<Response> {
  try {
    return { ok: true, data: (await handle(req)) ?? null };
  } catch (e) {
    console.warn('[glance]', req.type, e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
