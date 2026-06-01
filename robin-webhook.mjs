#!/usr/bin/env node
/**
 * Webhook server for @RobinCommanderBot
 * Handles button clicks, commands, and integrates with parking log
 */

import http from 'http';
import https from 'https';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOT_TOKEN = '8890689473:AAEqUmrhTvFlYrpF96zE6_VfDoGWJzGleIc';
const CHAT_ID = '7992826614';
const PORT = process.env.PORT || 3000;
const SNOOZE_FILE = '/Users/abdulrahim/.openclaw/workspace/snoozed-reminders.json';
const PARKING_LOG = '/Users/abdulrahim/.openclaw/workspace/parking-entries.jsonl';

// Store for snoozed reminders
function loadSnoozed() {
  try {
    if (existsSync(SNOOZE_FILE)) {
      return JSON.parse(readFileSync(SNOOZE_FILE, 'utf-8'));
    }
  } catch (e) {}
  return [];
}

function saveSnoozed(snoozed) {
  writeFileSync(SNOOZE_FILE, JSON.stringify(snoozed, null, 2));
}

// Log parking entry
async function logParking() {
  const now = new Date();
  const entry = {
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 5),
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
    location: 'TAMM Office',
    note: 'Logged via Commander Bot'
  };
  
  appendFileSync(PARKING_LOG, JSON.stringify(entry) + '\n');
  return entry;
}

// Get today's parking status
function getTodayParking() {
  try {
    if (!existsSync(PARKING_LOG)) return null;
    const data = readFileSync(PARKING_LOG, 'utf-8');
    const today = new Date().toISOString().slice(0, 10);
    const lines = data.trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = JSON.parse(lines[i]);
      if (entry.date === today) return entry;
    }
  } catch (e) {}
  return null;
}

// Send message back to user
function sendMessage(text, replyMarkup = null) {
  const postData = JSON.stringify({
    chat_id: CHAT_ID,
    text: text,
    parse_mode: 'HTML',
    reply_markup: replyMarkup
  });
  
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.ok);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Answer callback query (removes loading state from button)
function answerCallback(queryId, text) {
  const postData = JSON.stringify({
    callback_query_id: queryId,
    text: text
  });
  
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/answerCallbackQuery`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Handle bot commands
async function handleCommand(command, args) {
  switch (command) {
    case '/parking':
      const today = getTodayParking();
      if (today) {
        await sendMessage(`✅ <b>Parking logged today</b>\n\n📅 ${today.date}\n🕐 ${today.time}\n📍 ${today.location}`);
      } else {
        await sendMessage('❌ No parking logged today yet.', {
          inline_keyboard: [[{ text: '🅿️ Log Parking Now', callback_data: 'log_parking' }]]
        });
      }
      break;
      
    case '/status':
      const parking = getTodayParking();
      await sendMessage(
        `<b>📊 Daily Status</b>\n\n` +
        `🅿️ Parking: ${parking ? '✅ Logged at ' + parking.time : '❌ Not logged'}\n` +
        `📅 Date: ${new Date().toLocaleDateString('en-GB')}\n` +
        `🕐 Time: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      );
      break;
      
    case '/help':
      await sendMessage(
        `<b>🤖 Commander Bot Commands</b>\n\n` +
        `/parking - Check today's parking status\n` +
        `/status - Show daily summary\n` +
        `/help - Show this help message\n\n` +
        `<b>Button Actions:</b>\n` +
        `✅ Yes - Mark reminder as done\n` +
        `❌ No / ⏰ Snooze - Remind in 10 min\n` +
        `🅿️ Log Parking - Record parking entry`
      );
      break;
      
    default:
      await sendMessage('Unknown command. Use /help for available commands.');
  }
}

// Webhook handler
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        console.log('[' + new Date().toISOString() + '] Webhook:', JSON.stringify(data, null, 2).slice(0, 500));
        
        // Handle bot commands
        if (data.message && data.message.text && data.message.text.startsWith('/')) {
          const parts = data.message.text.split(' ');
          const command = parts[0].toLowerCase();
          const args = parts.slice(1);
          await handleCommand(command, args);
          res.writeHead(200);
          res.end('OK');
          return;
        }
        
        // Handle callback query (button click)
        if (data.callback_query) {
          const queryId = data.callback_query.id;
          const callbackData = data.callback_query.data;
          
          console.log(`Button clicked: ${callbackData}`);
          
          switch (callbackData) {
            case 'yes':
              await answerCallback(queryId, 'Marked as done!');
              await sendMessage('✅ <b>Reminder acknowledged!</b>\n\nHave a great day at work! 💪');
              break;
              
            case 'no':
            case 'snooze_10':
              await answerCallback(queryId, 'Snoozed for 10 minutes');
              
              // Add to snoozed list
              const snoozed = loadSnoozed();
              snoozed.push({
                id: Date.now(),
                time: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                original: 'Office reminder',
                createdAt: new Date().toISOString()
              });
              saveSnoozed(snoozed);
              
              await sendMessage('⏰ <b>Snoozed!</b>\n\nI\'ll remind you again in 10 minutes.');
              break;
              
            case 'log_parking':
              await answerCallback(queryId, 'Parking logged!');
              const entry = await logParking();
              await sendMessage(
                `✅ <b>Parking Logged!</b>\n\n` +
                `📅 ${entry.date}\n` +
                `🕐 ${entry.time}\n` +
                `📍 ${entry.location}`
              );
              break;
              
            default:
              await answerCallback(queryId, 'Unknown action');
          }
        }
        
        res.writeHead(200);
        res.end('OK');
      } catch (err) {
        console.error('Error handling webhook:', err);
        res.writeHead(500);
        res.end('Error');
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Commander Webhook Server running on port ${PORT}`);
  console.log(`📡 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log('\n📋 Available commands:');
  console.log('   /parking - Check parking status');
  console.log('   /status  - Show daily summary');
  console.log('   /help    - Show help');
  console.log('\n🔗 To expose publicly:');
  console.log('   ngrok http ${PORT}');
  console.log('   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<NGROK_URL>/webhook"');
});

// Check for snoozed reminders every minute
setInterval(() => {
  const snoozed = loadSnoozed();
  const now = new Date();
  const due = snoozed.filter(s => new Date(s.time) <= now);
  
  if (due.length > 0) {
    console.log(`[${new Date().toISOString()}] Sending ${due.length} snoozed reminders`);
    due.forEach(async (reminder) => {
      const parking = getTodayParking();
      const parkingStatus = parking ? '✅ Logged' : '❌ Not logged';
      
      await sendMessage(
        `⏰ <b>SNOOZED REMINDER</b>\n\n` +
        `Time to go to office!\n` +
        `🅿️ Parking: ${parkingStatus}\n\n` +
        `Don't forget parking if not done!`,
        {
          inline_keyboard: [
            [{ text: '✅ Yes - Done', callback_data: 'yes' }],
            [{ text: '❌ No - Snooze', callback_data: 'no' }],
            [{ text: '⏰ Remind 10m', callback_data: 'snooze_10' }],
            [{ text: '🅿️ Log Parking', callback_data: 'log_parking' }]
          ]
        }
      );
    });
    
    // Remove sent reminders
    const remaining = snoozed.filter(s => new Date(s.time) > now);
    saveSnoozed(remaining);
  }
}, 60000); // Check every minute

// Log startup
console.log(`\n✅ Commander Bot Webhook Server Started`);
console.log(`   Port: ${PORT}`);
console.log(`   PID: ${process.pid}`);
console.log(`   Log file: ${PARKING_LOG}`);
console.log(`   Snooze file: ${SNOOZE_FILE}\n`);
