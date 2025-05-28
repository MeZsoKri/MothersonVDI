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
        frame: false,              // make window borderless
        transparent: true,         // allow transparent background
        alwaysOnTop: true,         // keep on top of other windows
        skipTaskbar: true,         // don't show in taskbar
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
    rebootWindow.on('closed', () => {
        rebootWindow = null;
    });
}

/**
 * Cancel any pending reboot and close indicator window
 */
function cancelReboot() {
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

/**
 * Spawn a system reboot. Supports Linux (systemctl reboot) and Windows (shutdown -r).
 */
function rebootSystem() {
    console.log('Rebooting system now...');
    if (rebootWindow) rebootWindow.close();
    if (process.platform === 'win32') {
        spawn('shutdown', ['-r', '-t', '0'], { detached: true, stdio: 'ignore' }).unref();
    } else {
        spawn('systemctl', ['reboot'], { detached: true, stdio: 'ignore' }).unref();
    }
}

/**
 * Schedule a reboot after the configured delay and show cancel window.
 */
function scheduleReboot() {
    if (rebootDelay > 0) {
        // Clear any existing timers
        cancelReboot();
        
        let remaining = rebootDelay;
        createRebootWindow();

        // send initial remaining seconds
        rebootWindow.webContents.once('did-finish-load', () => {
            rebootWindow.webContents.send('reboot-countdown', Math.ceil(remaining / 1000));
        });

        // Set up countdown interval
        rebootInterval = setInterval(() => {
            remaining -= 1000;
            if (remaining > 0) {
                rebootWindow.webContents.send('reboot-countdown', Math.ceil(remaining / 1000));
            } else {
                clearInterval(rebootInterval);
            }
        }, 1000);

        // Set timeout to actually reboot
        rebootTimeout = setTimeout(() => {
            rebootSystem();
        }, rebootDelay);
        console.log(`Scheduled reboot in ${rebootDelay}ms`);
    }
}

function startRDPConnection(connectionData) {
    if (rdpProcess) return;  // Prevent multiple simultaneous connections

    // Update reboot delay from config (in seconds) and convert to ms
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

    rdpProcess.stdout.on('data', data => {
        console.log(`RDP stdout: ${data}`);
    });

    rdpProcess.stderr.on('data', data => {
        console.error(`RDP stderr: ${data}`);
        mainWindow.webContents.send('rdp-error', data.toString());
    });

    rdpProcess.on('close', code => {
        console.log(`RDP process exited with code ${code}`);
        rdpProcess = null;
        if (code !== 0) {
            mainWindow.webContents.send('rdp-error', 'RDP connection closed unexpectedly');
            scheduleReboot();
        }
    });
}

app.whenReady().then(() => {
    createWindow();

    // Load saved connection data, including optional rebootDelay
    const filePath = path.join(__dirname, 'connection_data.json');
    if (fs.existsSync(filePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (data.username && data.password && data.ip) {
                startRDPConnection(data);
            }
        } catch (error) {
            console.error('Error reading saved connection data:', error);
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

// Handle window controls
ipcMain.on('close-app', () => {
    if (rdpProcess) rdpProcess.kill();
    app.quit();
});

ipcMain.on('minimize-app', () => {
    mainWindow.minimize();
});

// Handle RDP start request, which may include rebootDelay (in seconds)
ipcMain.on('start-rdp', (event, connectionData) => {
    startRDPConnection(connectionData);
});

// Handle cancel reboot from rebootWindow
ipcMain.on('cancel-reboot', () => {
    cancelReboot();
});

// Handle loading connection data (including rebootDelay in seconds)
ipcMain.handle('load-connection', () => {
    const filePath = path.join(__dirname, 'connection_data.json');
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        return {};
    } catch (error) {
        console.error('Error loading connection data:', error);
        return {};
    }
});

// Handle saving connection data, including rebootDelay in seconds
ipcMain.handle('save-connection', (event, data) => {
    const filePath = path.join(__dirname, 'connection_data.json');
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return { success: true, message: 'Connection data saved successfully' };
    } catch (error) {
        console.error('Error saving connection data:', error);
        return { success: false, message: 'Error saving connection data' };
    }
});