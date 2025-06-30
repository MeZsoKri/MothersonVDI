const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let rdpProcess = null;
let rebootDelay = 0;        // delay in milliseconds before reboot after disconnection
let rebootTimeout = null;

function parseXml(xmlString) {
    const data = {};
    const tagRegex = (tagName) => new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`);

    try {
        let match;
        match = xmlString.match(tagRegex('username'));
        if (match) data.username = match[1];

        match = xmlString.match(tagRegex('password'));
        if (match) data.password = match[1];

        match = xmlString.match(tagRegex('ip'));
        if (match) data.ip = match[1];

        match = xmlString.match(tagRegex('rebootDelay'));
        if (match) data.rebootDelay = match[1];
    } catch (e) {
        console.error("Error parsing XML", e);
    }
    return data;
}

function buildXml(data) {
    return `<connection>
    <username>${data.username || ''}</username>
    <password>${data.password || ''}</password>
    <ip>${data.ip || ''}</ip>
    <rebootDelay>${data.rebootDelay || '0'}</rebootDelay>
</connection>`;
}

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

/**
 * Spawn a system reboot. Supports Linux (systemctl reboot) and Windows (shutdown -r).
 */
function rebootSystem() {
    console.log('Rebooting system now...');
    if (process.platform === 'win32') {
        spawn('shutdown', ['-r', '-t', '0'], { detached: true, stdio: 'ignore' }).unref();
    } else {
        spawn('systemctl', ['reboot'], { detached: true, stdio: 'ignore' }).unref();
    }
}

/**
 * Schedule a reboot after the configured delay.
 */
function scheduleReboot() {
    if (rebootDelay > 0) {
        if (rebootTimeout) clearTimeout(rebootTimeout);
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
        '/f',
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
    const filePath = path.join(__dirname, 'connection_data.xml');
    if (fs.existsSync(filePath)) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const data = parseXml(fileContent);
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

// Handle loading connection data (including rebootDelay)
ipcMain.handle('load-connection', () => {
    const filePath = path.join(__dirname, 'connection_data.xml');
    try {
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            return parseXml(fileContent);
        }
        return {};
    } catch (error) {
        console.error('Error loading connection data:', error);
        return {};
    }
});

// Handle saving connection data, including rebootDelay in seconds
ipcMain.handle('save-connection', (event, data) => {
    const filePath = path.join(__dirname, 'connection_data.xml');
    try {
        fs.writeFileSync(filePath, buildXml(data));
        return { success: true, message: 'Connection data saved successfully' };
    } catch (error) {
        console.error('Error saving connection data:', error);
        return { success: false, message: 'Error saving connection data' };
    }
});
