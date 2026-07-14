import { Tray, Menu, BrowserWindow, app, nativeImage, NativeImage, MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let tray: Tray | null = null;
let currentStatus: TrayStatus = 'online';

export type TrayStatus = 'online' | 'offline' | 'busy';

export interface TrayManagerOptions {
  mainWindow: BrowserWindow;
  live2dWindow: BrowserWindow;
}

const TOOLTIP_MAP: Record<TrayStatus, string> = {
  online: '纳西妲 Agent · 在线',
  offline: '纳西妲 Agent · 离线',
  busy: '纳西妲 Agent · 思考中…',
};

function getTrayIconPath(status: TrayStatus = 'online'): string {
  const iconNames: Record<TrayStatus, string> = {
    online: 'nahida-tray.png',
    offline: 'nahida-tray-offline.png',
    busy: 'nahida-tray-active.png',
  };

  const rootDir = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '../../..');

  return path.join(rootDir, 'assets/tray', iconNames[status]);
}

function loadTrayIcon(status: TrayStatus): NativeImage | null {
  const iconPath = getTrayIconPath(status);
  if (!fs.existsSync(iconPath)) {
    console.warn(`[Tray] icon not found: ${iconPath}`);
    return null;
  }
  return nativeImage.createFromPath(iconPath);
}

function createMenu(mainWindow: BrowserWindow, live2dWindow: BrowserWindow): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '显示聊天窗口',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: '显示 Live2D',
      click: () => {
        if (live2dWindow.isVisible()) {
          live2dWindow.hide();
        } else {
          live2dWindow.show();
        }
      },
    },
    {
      type: 'separator',
    },
    {
      label: '退出',
      click: () => {
        app.quit();
      },
    },
  ];

  return Menu.buildFromTemplate(template);
}

export function createTray(options: TrayManagerOptions): void {
  const { mainWindow, live2dWindow } = options;

  try {
    const icon = loadTrayIcon('online');

    if (!icon || icon.isEmpty()) {
      console.warn('[Tray] icon file not found or empty, skipping tray creation');
      return;
    }

    tray = new Tray(icon);

    const contextMenu = createMenu(mainWindow, live2dWindow);
    tray.setContextMenu(contextMenu);
    tray.setToolTip(TOOLTIP_MAP['online']);

    tray.on('click', () => {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    tray.on('right-click', () => {
      tray?.popUpContextMenu();
    });

    console.log('[Tray] tray created successfully');
  } catch (error) {
    console.error('[Tray] failed to create tray:', error);
  }
}

export function updateTrayStatus(status: TrayStatus): void {
  if (!tray) return;
  if (status === currentStatus) return;

  try {
    const icon = loadTrayIcon(status);
    if (!icon || icon.isEmpty()) {
      console.warn(`[Tray] icon for status "${status}" not found, skipping update`);
      return;
    }
    tray.setImage(icon);
    tray.setToolTip(TOOLTIP_MAP[status]);
    currentStatus = status;
    console.log(`[Tray] status updated: ${status}`);
  } catch (error) {
    console.error('[Tray] failed to update status:', error);
  }
}

export function updateTrayTooltip(tooltip: string): void {
  if (!tray) return;
  tray.setToolTip(tooltip);
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
    console.log('[Tray] tray destroyed');
  }
}

export function getTray(): Tray | null {
  return tray;
}

export function getTrayStatus(): TrayStatus {
  return currentStatus;
}