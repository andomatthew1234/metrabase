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
    show: false, // Don't show immediately to allow splash effect
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.setMenu(null); 
  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

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

function processQueue() {
  if (isDownloading || downloadQueue.length === 0) return;
  isDownloading = true;
  const currentTask = downloadQueue[0];
  
  mainWindow.webContents.send('status', `Downloading: ${currentTask.url}`);
  logStatus(currentTask.url, 'Downloading Now', currentTask.mode);

  let args = ['-m', 'yt_dlp', '--no-playlist'];
  if (currentTask.mode === 'audio') {
    args.push('-x', '--audio-format', 'mp3', '-o', `${currentTask.savePath}/%(title)s.%(ext)s`, currentTask.url);
  } else {
    args.push('-f', 'bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]', '-o', `${currentTask.savePath}/%(title)s.%(ext)s`, currentTask.url);
  }

  const ls = spawn('python', args);
  ls.stdout.on('data', (data) => console.log(`yt-dlp: ${data}`));

  ls.on('close', (code) => {
    logStatus(currentTask.url, code === 0 ? 'Success' : 'Error', currentTask.mode);
    isDownloading = false;
    downloadQueue.shift();
    if (downloadQueue.length > 0) processQueue();
    else mainWindow.webContents.send('status', 'All downloads complete!');
    mainWindow.webContents.send('update-queue', downloadQueue);
  });
}

ipcMain.on('add-to-queue', async (event, data) => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return;
  const savePath = result.filePaths[0].replace(/\\/g, '/');
  downloadQueue.push({ url: data.url, mode: data.mode, savePath: savePath });
  logStatus(data.url, 'In Queue', data.mode);
  event.reply('update-queue', downloadQueue);
  if (!isDownloading) processQueue();
  else event.reply('status', 'Added to queue!');
});

ipcMain.on('get-queue', (event) => event.reply('update-queue', downloadQueue));
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });