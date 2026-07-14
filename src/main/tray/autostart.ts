import { app } from 'electron';

export function setAutoStart(enabled: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: app.getPath('exe'),
      args: [],
    });
    console.log('[AutoStart] auto start', enabled ? 'enabled' : 'disabled');
  } catch (error) {
    console.error('[AutoStart] failed to set auto start:', error);
  }
}

export function isAutoStartEnabled(): boolean {
  try {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin || false;
  } catch (error) {
    console.error('[AutoStart] failed to check auto start:', error);
    return false;
  }
}