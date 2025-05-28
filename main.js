const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let rdpProcess = null;
let rebootDelay = 0;        // delay in milliseconds before reboot after disconnection
let rebootTimeout = null;
let rebootInterval = null;   // interval for countdown updates
let rebootWindow = null;     // window to show countdown and cancel

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 730,
    frame: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    resizable: false,
    autoHideMenuBar: true
  });
  mainWindow.loadFile('index.html');
}

function createRebootWindow() {
  if (rebootWindow) return;
  rebootWindow = new BrowserWindow({
    width: 300,
    height: 150,
    frame: false,       // borderless
    transparent: true,  // transparent
    alwaysOnTop: true,
    skipTaskbar: true,
    movable: false,
    resizable: false,
    parent: mainWindow,
    modal: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  rebootWindow.loadFile('reboot.html');
  rebootWindow.on('closed', () => rebootWindow = null);
}

function cancelReboot() {
  // clear timers and close window
  if (rebootTimeout) {
    clearTimeout(rebootTimeout);
    rebootTimeout = null;
  }
  if (rebootInterval) {
    clearInterval(rebootInterval);
    rebootInterval = null;
  }
  if (rebootWindow) {
    rebootWindow.close();
    rebootWindow = null;
  }
  console.log('Reboot canceled by user');
}

function rebootSystem() {
  console.log('Rebooting system now...');
  if (rebootWindow) rebootWindow.close();
  if (process.platform === 'win32') {
    spawn('shutdown', ['-r', '-t', '0'], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('systemctl', ['reboot'], { detached: true, stdio: 'ignore' }).unref();
  }
}

function scheduleReboot() {
  if (rebootDelay <= 0) return;
  cancelReboot();
  let remaining = rebootDelay;
  createRebootWindow();
  // send countdown updates
  rebootWindow.webContents.once('did-finish-load', () => {
    rebootWindow.webContents.send('reboot-countdown', Math.ceil(remaining / 1000));
  });
  rebootInterval = setInterval(() => {
    remaining -= 1000;
    if (remaining > 0) {
      rebootWindow.webContents.send('reboot-countdown', Math.ceil(remaining / 1000));
    } else {
      clearInterval(rebootInterval);
    }
  }, 1000);
  rebootTimeout = setTimeout(() => {
    rebootSystem();
  }, rebootDelay);
  console.log(`Scheduled reboot in ${rebootDelay}ms`);
}

function startRDPConnection(connectionData) {
  if (rdpProcess) return;
  if (typeof connectionData.rebootDelay === 'number') {
    rebootDelay = connectionData.rebootDelay * 1000;
  }
  const args = [
    `/v:${connectionData.ip}`,
    `/u:${connectionData.username}`,
    `/p:${connectionData.password}`,
    '/cert-ignore',
    '/dynamic-resolution',
    '+clipboard',
    '+fonts',
    '/sound:sys:pulse',
    '/network:auto',
    '/compression-level:2'
  ];
  rdpProcess = spawn('xfreerdp', args);
  rdpProcess.stdout.on('data', data => console.log(`RDP stdout: ${data}`));
  rdpProcess.stderr.on('data', data => {
    console.error(`RDP stderr: ${data}`);
    mainWindow.webContents.send('rdp-error', data.toString());
  });
  rdpProcess.on('close', (code, signal) => {
    console.log(`RDP process closed: code=${code}, signal=${signal}`);
    rdpProcess = null;
    // always schedule reboot if process stops
    mainWindow.webContents.send('rdp-error', 'RDP connection closed');
    scheduleReboot();
  });
}

app.whenReady().then(() => {
  createWindow();
  const filePath = path.join(__dirname, 'connection_data.json');
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data.ip && data.username && data.password) {
        startRDPConnection(data);
      }
    } catch (e) {
      console.error('Error reading connection data:', e);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (rdpProcess) rdpProcess.kill();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on('close-app', () => { if (rdpProcess) rdpProcess.kill(); app.quit(); });
ipcMain.on('minimize-app', () => mainWindow.minimize());
ipcMain.on('start-rdp', (e, conn) => startRDPConnection(conn));
ipcMain.on('cancel-reboot', () => cancelReboot());
ipcMain.handle('load-connection', () => {
  const f = path.join(__dirname, 'connection_data.json');
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; }
  catch (e) { console.error(e); return {}; }
});
ipcMain.handle('save-connection', (e, d) => {
  const f = path.join(__dirname, 'connection_data.json');
  try { fs.writeFileSync(f, JSON.stringify(d, null, 2)); return { success:true }; }
  catch (e) { console.error(e); return { success:false }; }
});
