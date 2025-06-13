const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock } = require('mineflayer-pathfinder').goals;

const config = require('./settings.json');
const express = require('express');
const path = require('path');

const app = express();

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Global variables to store bot state
let botInstance = null;
let botStatus = {
  online: false,
  status: 'Offline',
  username: config['bot-account']['username'],
  server: `${config.server.ip}:${config.server.port}`,
  position: 'Unknown'
};
let chatMessages = [];

// Serve the HTML interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API endpoints
app.get('/api/status', (req, res) => {
  res.json(botStatus);
});

app.get('/api/settings', (req, res) => {
  res.json(config);
});

app.get('/api/chat', (req, res) => {
  res.json({ messages: chatMessages.slice(-50) }); // Last 50 messages
});

app.post('/api/chat', (req, res) => {
  const { message } = req.body;
  if (botInstance && message) {
    botInstance.chat(message);
    chatMessages.push({
      timestamp: new Date().toISOString(),
      message: `[SENT] ${message}`
    });
  }
  res.json({ success: true });
});

app.post('/api/reconnect', (req, res) => {
  if (botInstance) {
    botInstance.end();
  }
  setTimeout(() => {
    createBot();
  }, 1000);
  res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
  if (botInstance) {
    botInstance.end();
    botStatus.online = false;
    botStatus.status = 'Stopped';
  }
  res.json({ success: true });
});

app.post('/api/start', (req, res) => {
  if (!botInstance || !botStatus.online) {
    createBot();
  }
  res.json({ success: true });
});

app.post('/api/toggle', (req, res) => {
  const { feature, enabled } = req.body;
  
  try {
    switch (feature) {
      case 'anti-afk':
        config.utils['anti-afk'].enabled = enabled;
        if (botInstance) {
          if (enabled) {
            botInstance.setControlState('jump', true);
            if (config.utils['anti-afk'].sneak) {
              botInstance.setControlState('sneak', true);
            }
          } else {
            botInstance.setControlState('jump', false);
            botInstance.setControlState('sneak', false);
          }
        }
        break;
      case 'auto-reconnect':
        config.utils['auto-reconnect'] = enabled;
        break;
      case 'chat-messages':
        config.utils['chat-messages'].enabled = enabled;
        break;
      case 'auto-auth':
        config.utils['auto-auth'].enabled = enabled;
        break;
    }
    
    res.json({ success: true, feature, enabled });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(8000, '0.0.0.0', () => {
  console.log('Server started on port 8000');
});

function createBot() {
   const bot = mineflayer.createBot({
      username: config['bot-account']['username'],
      password: config['bot-account']['password'],
      auth: config['bot-account']['type'],
      host: config.server.ip,
      port: config.server.port,
      version: config.server.version,
   });

   botInstance = bot;
   bot.loadPlugin(pathfinder);
   const mcData = require('minecraft-data')(bot.version);
   const defaultMove = new Movements(bot, mcData);
   bot.settings.colorsEnabled = false;

   let pendingPromise = Promise.resolve();

   function sendRegister(password) {
      return new Promise((resolve, reject) => {
         bot.chat(`/register ${password} ${password}`);
         console.log(`[Auth] Sent /register command.`);

         bot.once('chat', (username, message) => {
            console.log(`[ChatLog] <${username}> ${message}`); // Log all chat messages
            chatMessages.push({
              timestamp: new Date().toISOString(),
              message: `<${username}> ${message}`
            });

            // Check for various possible responses
            if (message.includes('successfully registered')) {
               console.log('[INFO] Registration confirmed.');
               resolve();
            } else if (message.includes('already registered')) {
               console.log('[INFO] Bot was already registered.');
               resolve(); // Resolve if already registered
            } else if (message.includes('Invalid command')) {
               reject(`Registration failed: Invalid command. Message: "${message}"`);
            } else {
               reject(`Registration failed: unexpected message "${message}".`);
            }
         });
      });
   }

   function sendLogin(password) {
      return new Promise((resolve, reject) => {
         bot.chat(`/login ${password}`);
         console.log(`[Auth] Sent /login command.`);

         bot.once('chat', (username, message) => {
            console.log(`[ChatLog] <${username}> ${message}`); // Log all chat messages
            chatMessages.push({
              timestamp: new Date().toISOString(),
              message: `<${username}> ${message}`
            });

            if (message.includes('successfully logged in')) {
               console.log('[INFO] Login successful.');
               resolve();
            } else if (message.includes('Invalid password')) {
               reject(`Login failed: Invalid password. Message: "${message}"`);
            } else if (message.includes('not registered')) {
               reject(`Login failed: Not registered. Message: "${message}"`);
            } else {
               reject(`Login failed: unexpected message "${message}".`);
            }
         });
      });
   }

   bot.once('spawn', () => {
      console.log('\x1b[33m[AfkBot] Bot joined the server', '\x1b[0m');
      botStatus.online = true;
      botStatus.status = 'Online';
      botStatus.position = `${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}`;
      
      chatMessages.push({
        timestamp: new Date().toISOString(),
        message: '[BOT] Connected to server'
      });

      if (config.utils['auto-auth'].enabled) {
         console.log('[INFO] Started auto-auth module');

         const password = config.utils['auto-auth'].password;

         pendingPromise = pendingPromise
            .then(() => sendRegister(password))
            .then(() => sendLogin(password))
            .catch(error => console.error('[ERROR]', error));
      }

      if (config.utils['chat-messages'].enabled) {
         console.log('[INFO] Started chat-messages module');
         const messages = config.utils['chat-messages']['messages'];

         if (config.utils['chat-messages'].repeat) {
            const delay = config.utils['chat-messages']['repeat-delay'];
            let i = 0;

            let msg_timer = setInterval(() => {
               bot.chat(`${messages[i]}`);

               if (i + 1 === messages.length) {
                  i = 0;
               } else {
                  i++;
               }
            }, delay * 1000);
         } else {
            messages.forEach((msg) => {
               bot.chat(msg);
            });
         }
      }

      const pos = config.position;

      if (config.position.enabled) {
         console.log(
            `\x1b[32m[Afk Bot] Starting to move to target location (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`
         );
         bot.pathfinder.setMovements(defaultMove);
         bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
      }

      if (config.utils['anti-afk'].enabled) {
         bot.setControlState('jump', true);
         if (config.utils['anti-afk'].sneak) {
            bot.setControlState('sneak', true);
         }
      }
   });

   bot.on('goal_reached', () => {
      console.log(
         `\x1b[32m[AfkBot] Bot arrived at the target location. ${bot.entity.position}\x1b[0m`
      );
      botStatus.position = `${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}`;
      chatMessages.push({
        timestamp: new Date().toISOString(),
        message: '[BOT] Arrived at target location'
      });
   });

   bot.on('death', () => {
      console.log(
         `\x1b[33m[AfkBot] Bot has died and was respawned at ${bot.entity.position}`,
         '\x1b[0m'
      );
      botStatus.position = `${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}`;
      chatMessages.push({
        timestamp: new Date().toISOString(),
        message: '[BOT] Died and respawned'
      });
   });

   bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      console.log(`[ChatLog] <${username}> ${message}`);
      chatMessages.push({
        timestamp: new Date().toISOString(),
        message: `<${username}> ${message}`
      });
   });

   if (config.utils['auto-reconnect']) {
      bot.on('end', () => {
         botStatus.online = false;
         botStatus.status = 'Reconnecting...';
         chatMessages.push({
           timestamp: new Date().toISOString(),
           message: '[BOT] Connection lost, reconnecting...'
         });
         setTimeout(() => {
            createBot();
         }, config.utils['auto-recconect-delay']);
      });
   }

   bot.on('kicked', (reason) => {
      console.log(
         '\x1b[33m',
         `[AfkBot] Bot was kicked from the server. Reason: \n${reason}`,
         '\x1b[0m'
      );
      botStatus.online = false;
      botStatus.status = 'Kicked';
      chatMessages.push({
        timestamp: new Date().toISOString(),
        message: `[BOT] Kicked: ${reason}`
      });
   });

   bot.on('error', (err) => {
      console.log(`\x1b[31m[ERROR] ${err.message}`, '\x1b[0m');
      botStatus.online = false;
      botStatus.status = 'Error';
      chatMessages.push({
        timestamp: new Date().toISOString(),
        message: `[ERROR] ${err.message}`
      });
   });
}

createBot();
