import * as engine from '../background/engine';
import { respond } from '../background/router';
import type { Request } from '../shared/types';

export default defineBackground(() => {
  // Every time the worker starts, not only on install or browser start.
  engine.ensurePolling().catch(() => {});
  engine.updateBadge().catch(() => {});
  // The button opens the popup or the side panel, whichever was used last.
  engine.applySurface().catch(() => {});

  chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
    respond(req).then(sendResponse);
    return true; // answer asynchronously
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'poll') engine.syncAll();
    if (alarm.name === 'snooze') engine.processSnoozes();
  });

  chrome.notifications.onClicked.addListener((id) => engine.onNotificationClicked(id));
  chrome.notifications.onButtonClicked.addListener((id, index) => engine.onNotificationButton(id, index));

  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'open-side-panel' && tab?.windowId !== undefined) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
  });

  const start = async () => {
    await engine.schedulePolling();
    await engine.updateBadge();
    engine.syncAll();
  };
  chrome.runtime.onInstalled.addListener(start);
  chrome.runtime.onStartup.addListener(start);
});
