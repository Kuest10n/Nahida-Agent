import { Tray, Menu, BrowserWindow, app, MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let tray: Tray | null = null;

export type TrayStatus = 'online' | 'offline' | 'busy';

export interface TrayManagerOptions {
  mainWindow: BrowserWindow;
  live2dWindow: BrowserWindow;
}

function getTrayIconPath(status: TrayStatus = 'online'): string {
  const iconNames: Record<TrayStatus, string> = {
    online: 'nahida-tray.png',
    offline: 'nahida-tray-offline.png',
    busy: 'nahida-tray-active.png',
  };
  
  const rootDir = app.isPackaged 
    ? process.resourcesPath 
    : path.join(__dirname, '../../..');
  
  const iconPath = path.join(rootDir, 'assets/tray', iconNames[status]);
  
  if (fs.existsSync(iconPath)) {
    return iconPath;
  }
  
  return '';
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
    const iconPath = getTrayIconPath();
    
    if (!iconPath) {
      console.warn('[Tray] icon file not found, skipping tray creation');
      return;
    }
    
    tray = new Tray(iconPath);
    
    const contextMenu = createMenu(mainWindow, live2dWindow);
    tray.setContextMenu(contextMenu);
    
    tray.setToolTip('纳西妲 Agent');
    
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
  
  try {
    const iconPath = getTrayIconPath(status);
    tray.setImage(iconPath);
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