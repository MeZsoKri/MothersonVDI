const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('.login-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const ipInput = document.getElementById('ip');
    const errorMessage = document.querySelector('.error-message');
    const closeButton = document.querySelector('.close-button');
    const minimizeButton = document.querySelector('.minimize-button');

    // Window control handlers
    closeButton.addEventListener('click', () => {
        ipcRenderer.send('close-app');
    });

    minimizeButton.addEventListener('click', () => {
        ipcRenderer.send('minimize-app');
    });

    // Try to load existing connection data and auto-connect if available
    loadConnectionData().then(data => {
        if (data && data.username && data.password && data.ip) {
            // If we have all the connection data, start RDP connection
            startRDPConnection(data);
        }
    });

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const connectionData = {
            username: usernameInput.value,
            password: passwordInput.value,
            ip: ipInput.value,
            rebootDelay: 60
        };

        // Save the connection data and start RDP
        saveConnectionData(connectionData).then(() => {
            startRDPConnection(connectionData);
        });
    });

    // Listen for RDP errors
    ipcRenderer.on('rdp-error', (event, error) => {
        errorMessage.style.color = '#ff4444';
        errorMessage.textContent = `RDP Error: ${error}`;
    });
});

async function loadConnectionData() {
    try {
        const data = await ipcRenderer.invoke('load-connection');
        if (Object.keys(data).length > 0) {
            document.getElementById('username').value = data.username || '';
            document.getElementById('password').value = data.password || '';
            document.getElementById('ip').value = data.ip || '';
            return data;
        }
        return null;
    } catch (error) {
        console.error('Error loading connection data:', error);
        return null;
    }
}

async function saveConnectionData(data) {
    try {
        const result = await ipcRenderer.invoke('save-connection', data);
        const errorMessage = document.querySelector('.error-message');
        
        if (result.success) {
            errorMessage.style.color = '#4ecdc4';
            errorMessage.textContent = result.message;
        } else {
            errorMessage.style.color = '#ff4444';
            errorMessage.textContent = result.message;
        }
        return result.success;
    } catch (error) {
        console.error('Error saving connection data:', error);
        const errorMessage = document.querySelector('.error-message');
        errorMessage.style.color = '#ff4444';
        errorMessage.textContent = 'Error saving connection data';
        return false;
    }
}

function startRDPConnection(connectionData) {
    if (!connectionData.username || !connectionData.password || !connectionData.ip) {
        const errorMessage = document.querySelector('.error-message');
        errorMessage.style.color = '#ff4444';
        errorMessage.textContent = 'Please fill in all connection details';
        return;
    }

    // Send connection request to main process
    ipcRenderer.send('start-rdp', connectionData);
    
    // Show connecting message
    const errorMessage = document.querySelector('.error-message');
    errorMessage.style.color = '#4ecdc4';
    errorMessage.textContent = 'Connecting to RDP...';
} 