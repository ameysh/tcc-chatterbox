const { Client, GatewayIntentBits, Events, Collection } = require('discord.js');
const { Ollama } = require('ollama');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Initialize Ollama client
const ollama = new Ollama({ host: 'http://localhost:11434' });

// Conversation logging function
function logConversation(username, userMessage, aiResponse) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${username}: ${userMessage}\n[${timestamp}] Bot: ${aiResponse}\n---\n`;
    
    // Create logs directory if it doesn't exist
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
    }
    
    // Create log file with current date
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const logFile = path.join(logsDir, `conversations-${today}.txt`);
    
    // Append to log file
    fs.appendFileSync(logFile, logEntry, 'utf8');
    console.log(`Conversation logged to: ${logFile}`);
}

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Commands collection
client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            console.log(`Loaded command: ${command.data.name}`);
        } else {
            console.log(`Warning: Command at ${filePath} is missing required "data" or "execute" property.`);
        }
    }
}

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
    console.log('Bot is online and ready!');
    console.log('---');
    console.log('Manual Message Commands:');
    console.log('• Type "send <channel_id> <message>" to send a message to a specific channel');
    console.log('• Type "list" to see available channels');
    console.log('• Type "help" to see these commands again');
    console.log('---');
    
    // Set up readline interface for manual input
    setupManualInput(readyClient);
});

// Listen for messages
client.on(Events.MessageCreate, message => {
    // Ignore messages from bots (including this bot)
    if (message.author.bot) return;
    
    // Ignore system messages
    if (message.system) return;
    
    // Only respond to messages in guilds (servers)
    if (!message.guild) return;

    // Log incoming messages for debugging
    console.log(`Message from ${message.author.username}: ${message.content}`);

    // Can add custom message commands here

});

// Handle slash command interactions
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error('Error executing command:', error);
        const errorMessage = 'There was an error while executing this command!';
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
        }
    }
});

// Handle AI requests from the /talk command
client.on('aiRequest', async ({ interaction, userMessage, userId, username }) => {
    try {
        console.log(`AI request from ${username}: ${userMessage}`);
        
        // Generate response using Ollama
        const response = await ollama.chat({
            model: process.env.OLLAMA_MODEL || 'llama3.2',
            messages: [
                {
                    role: 'system',
                    content: process.env.OLLAMA_SYSTEM_PROMPT || 'You are a helpful assistant.'
                },
                {
                    role: 'user',
                    content: userMessage
                }
            ],
        });

        const aiResponse = response.message.content;
        
        // Discord has a 2000 character limit for messages
        let finalResponse = aiResponse;
        if (aiResponse.length > 2000) {
            finalResponse = aiResponse.substring(0, 1997) + '...';
            await interaction.editReply(finalResponse);
        } else {
            await interaction.editReply(aiResponse);
        }
        
        // Log the conversation
        logConversation(username, userMessage, finalResponse);
        
        console.log(`AI response sent to ${username}`);
        
    } catch (error) {
        console.error('Error generating AI response:', error);
        await interaction.editReply('Sorry, I encountered an error while generating a response. Please try again later.');
    }
});

// Error handling
client.on(Events.Error, error => {
    console.error('Discord client error:', error);
});

// Manual input function
function setupManualInput(client) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'Bot> '
    });

    rl.prompt();

    rl.on('line', async (input) => {
        const args = input.trim().split(' ');
        const command = args[0].toLowerCase();

        try {
            switch (command) {
                case 'send':
                    if (args.length < 3) {
                        console.log('Usage: send <channel_id> <message>');
                        break;
                    }
                    const channelId = args[1];
                    const message = args.slice(2).join(' ');
                    
                    const channel = client.channels.cache.get(channelId);
                    if (!channel) {
                        console.log('❌ Channel not found! Use "list" to see available channels.');
                        break;
                    }
                    
                    await channel.send(message);
                    console.log(`✅ Message sent to #${channel.name}: "${message}"`);
                    break;

                case 'list':
                    console.log('\n📋 Available Channels:');
                    client.guilds.cache.forEach(guild => {
                        console.log(`\n🏠 ${guild.name}:`);
                        guild.channels.cache
                            .filter(ch => ch.type === 0) // Text channels only
                            .forEach(channel => {
                                console.log(`  • #${channel.name} (ID: ${channel.id})`);
                            });
                    });
                    console.log('');
                    break;

                case 'help':
                    console.log('\n📖 Manual Message Commands:');
                    console.log('• send <channel_id> <message> - Send a message to a specific channel');
                    console.log('• list - Show all available channels with their IDs');
                    console.log('• help - Show this help message');
                    console.log('• exit - Close the bot\n');
                    break;

                case 'exit':
                    console.log('👋 Shutting down bot...');
                    await client.destroy();
                    rl.close();
                    process.exit(0);
                    break;

                default:
                    if (input.trim()) {
                        console.log('❓ Unknown command. Type "help" for available commands.');
                    }
                    break;
            }
        } catch (error) {
            console.error('❌ Error:', error.message);
        }

        rl.prompt();
    });

    rl.on('close', () => {
        console.log('\n👋 Goodbye!');
        process.exit(0);
    });
}

// Login to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);