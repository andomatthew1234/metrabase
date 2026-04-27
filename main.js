const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 700,
    title: "Metrabase",
    icon: path.join(__dirname, 'icon.ico'),
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.setMenu(null); 
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => { mainWindow.show(); });
}

// History CSV Logger
function logStatus(url, status, mode) {
  const historyPath = path.join(__dirname, 'history.csv');
  const timestamp = new Date().toLocaleString();
  const logEntry = `"${timestamp}","${url}","${mode}","${status}"\n`;
  fs.appendFile(historyPath, logEntry, (err) => {
    if (err) console.error('History log error:', err);
  });
}

app.whenReady().then(createWindow);

let downloadQueue = [];
let isDownloading = false;

// Queue Processor
function processQueue() {
  if (isDownloading || downloadQueue.length === 0) return;
  isDownloading = true;
  const currentTask = downloadQueue[0];
  
  mainWindow.webContents.send('status', `Downloading: ${currentTask.url}`);
  logStatus(currentTask.url, 'Downloading Now', currentTask.mode);

  let playlistFlag = currentTask.isPlaylist ? '--yes-playlist' : '--no-playlist';
  let args = ['-m', 'yt_dlp', playlistFlag];
  
  if (currentTask.mode === 'audio') {
    args.push('-x', '--audio-format', 'mp3', '-o', `${currentTask.savePath}/%(title)s.%(ext)s`, currentTask.url);
  } else {
    args.push('-f', 'bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]', '-o', `${currentTask.savePath}/%(title)s.%(ext)s`, currentTask.url);
  }

  const ls = spawn('python', args);

  ls.on('close', (code) => {
    logStatus(currentTask.url, code === 0 ? 'Success' : 'Error', currentTask.mode);
    isDownloading = false;
    downloadQueue.shift();
    if (downloadQueue.length > 0) processQueue();
    else mainWindow.webContents.send('status', 'All downloads complete!');
    mainWindow.webContents.send('update-queue', downloadQueue);
  });
}

// IPC Handlers
ipcMain.on('add-to-queue', async (event, data) => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return;
  const savePath = result.filePaths[0].replace(/\\/g, '/');
  
  downloadQueue.push({ url: data.url, mode: data.mode, savePath: savePath, isPlaylist: data.isPlaylist });
  logStatus(data.url, 'In Queue', data.mode);
  event.reply('update-queue', downloadQueue);
  if (!isDownloading) processQueue();
});

ipcMain.on('get-queue', (event) => event.reply('update-queue', downloadQueue));

ipcMain.on('get-history', (event) => {
  const historyPath = path.join(__dirname, 'history.csv');
  if (!fs.existsSync(historyPath)) return event.reply('update-history', []);

  fs.readFile(historyPath, 'utf8', (err, data) => {
    if (err) return event.reply('update-history', []);
    
    const lines = data.trim().split('\n');
    const historyMap = {};

    lines.forEach(line => {
      const parts = line.split('","').map(p => p.replace(/"/g, ''));
      if (parts.length < 4) return;
      const [timestamp, url, mode, status] = parts;
      
      if (!historyMap[url]) {
        historyMap[url] = { url, mode, start: null, end: null, status: status };
      }
      
      // Update start time only when it actually hits the downloader
      if (status === 'Downloading Now') {
        historyMap[url].start = timestamp;
      }
      
      if (status === 'Success' || status === 'Error') {
        historyMap[url].end = timestamp;
        historyMap[url].status = status;
      }
    });
    event.reply('update-history', Object.values(historyMap).reverse());
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });