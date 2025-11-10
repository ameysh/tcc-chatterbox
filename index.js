const { Client, GatewayIntentBits, Events, Collection } = require('discord.js');
const { Ollama } = require('ollama');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Initialize Ollama client
const ollama = new Ollama({ host: 'http://localhost:11434' });

// Conversation memory storage (threadId -> conversation history)
// threadId is channelId for /talk commands, or original messageId for reply threads
const conversationHistory = new Map();

// Mapping from message IDs to their thread IDs (to handle reply chains)
const messageToThreadMap = new Map();

// Function to get or create conversation history for a thread
function getThreadConversation(threadId) {
    if (!conversationHistory.has(threadId)) {
        conversationHistory.set(threadId, [
            {
                role: 'system',
                content: process.env.OLLAMA_SYSTEM_PROMPT || 'You are a helpful assistant.'
            }
        ]);
    }
    return conversationHistory.get(threadId);
}

// Function to add message to thread's conversation history
function addToConversation(threadId, role, content, username = null) {
    const conversation = getThreadConversation(threadId);
    
    // Add username context for user messages to help AI track speakers
    const messageContent = username && role === 'user' ? `${username}: ${content}` : content;
    conversation.push({ role, content: messageContent });
    
    // Keep conversation history manageable (last 20 messages + system prompt)
    if (conversation.length > 21) {
        // Keep system prompt (first message) and last 20 messages
        const systemPrompt = conversation[0];
        const recentMessages = conversation.slice(-20);
        conversationHistory.set(threadId, [systemPrompt, ...recentMessages]);
    }
}

// Function to clear a thread's conversation history
function clearThreadConversation(threadId) {
    conversationHistory.delete(threadId);
    console.log(`Cleared conversation history for thread ${threadId}`);
}

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

// Shared function to process AI requests
async function processAIRequest(messageOrInteraction, userMessage, username, userId, isSlashCommand = false) {
    try {
        console.log(`AI request from ${username}: ${userMessage}`);
        
        // Determine thread ID for conversation context
        let threadId;
        if (isSlashCommand) {
            // For /talk commands, use channel ID as thread ID
            threadId = messageOrInteraction.channelId;
        } else {
            // For replies, find the original thread starter
            if (messageOrInteraction.reference && messageOrInteraction.reference.messageId) {
                const referencedMessageId = messageOrInteraction.reference.messageId;
                
                // First check if there's a direct mapping from the referenced message
                if (messageToThreadMap.has(referencedMessageId)) {
                    threadId = messageToThreadMap.get(referencedMessageId);
                    console.log(`Found thread mapping: message ${referencedMessageId} -> thread ${threadId}`);
                } else {
                    // Fallback: trace back through the conversation chain
                    let rootMessageId = referencedMessageId;
                    
                    try {
                        let currentMessageId = rootMessageId;
                        let depth = 0;
                        const maxDepth = 20; // Prevent infinite loops
                        
                        while (depth < maxDepth) {
                            // Check if there's a mapping for this message
                            if (messageToThreadMap.has(currentMessageId)) {
                                threadId = messageToThreadMap.get(currentMessageId);
                                console.log(`Found thread mapping during trace: message ${currentMessageId} -> thread ${threadId}`);
                                break;
                            }
                            
                            const referencedMessage = await messageOrInteraction.channel.messages.fetch(currentMessageId);
                            
                            // If this message is also a reply, continue tracing back
                            if (referencedMessage.reference && referencedMessage.reference.messageId) {
                                rootMessageId = referencedMessage.reference.messageId;
                                currentMessageId = referencedMessage.reference.messageId;
                                depth++;
                            } else {
                                // Found the root message (no more references)
                                rootMessageId = currentMessageId;
                                break;
                            }
                        }
                        
                        if (!threadId) {
                            threadId = rootMessageId;
                            console.log(`Traced thread back to root message: ${rootMessageId}`);
                        }
                    } catch (error) {
                        console.log('Could not trace thread root, using referenced message ID');
                        threadId = referencedMessageId;
                    }
                }
            } else {
                // Fallback to channel ID if no reference
                threadId = messageOrInteraction.channelId;
            }
        }
        
        console.log(`Using thread ID: ${threadId}`);
        
        // Get thread's conversation history
        const conversation = getThreadConversation(threadId);
        console.log(`Thread has ${conversation.length - 1} previous messages`);
        
        // Add user's message to conversation history with username
        addToConversation(threadId, 'user', userMessage, username);
        
        // Generate response using Ollama with full conversation context
        const response = await ollama.chat({
            model: process.env.OLLAMA_MODEL || 'llama3.2',
            messages: conversation.concat([{ 
                role: 'user', 
                content: `${username}: ${userMessage}` 
            }]),
        });

        const aiResponse = response.message.content;
        
        // Add AI's response to conversation history
        addToConversation(threadId, 'assistant', aiResponse);
        
        // Handle Discord's 2000 character limit
        let finalResponse = aiResponse;
        if (aiResponse.length > 2000) {
            finalResponse = aiResponse.substring(0, 1997) + '...';
        }
        
        // Send response based on type (slash command or regular message)
        let botResponseMessage;
        if (isSlashCommand) {
            await messageOrInteraction.editReply(finalResponse);
            // For slash commands, fetching the response message is necessary
            botResponseMessage = await messageOrInteraction.fetchReply();
        } else {
            botResponseMessage = await messageOrInteraction.reply(finalResponse);
        }
        
        // Map the bot's response message to this thread for future replies
        messageToThreadMap.set(botResponseMessage.id, threadId);
        console.log(`Mapped bot message ${botResponseMessage.id} to thread ${threadId}`);
        
        // Log the conversation
        logConversation(username, userMessage, finalResponse);
        
        console.log(`AI response sent to ${username}`);
        
    } catch (error) {
        console.error('Error generating AI response:', error);
        const errorMessage = 'Sorry, I encountered an error while generating a response. Please try again later.';
        
        if (isSlashCommand) {
            await messageOrInteraction.editReply(errorMessage);
        } else {
            await messageOrInteraction.reply(errorMessage);
        }
    }
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
    
    // Set bot presence
    readyClient.user.setPresence({
        activities: [
            {
                name: 'Observing TCC Gamerforge',
                type: 3 // ActivityType.Watching
            }
        ],
        status: 'online'
    });
    
    console.log('Bot is online and ready!');
    console.log('---');
    console.log('Manual Message Commands:');
    console.log('- Type "send <channel_id> <message>" to send a message to a specific channel');
    console.log('- Type "list" to see available channels');
    console.log('- Type "help" to see these commands again');
    console.log('---');
    
    // Set up readline interface for manual input
    setupManualInput(readyClient);
});

// Listen for messages
client.on(Events.MessageCreate, async message => {
    // Ignore messages from bots (including this bot)
    if (message.author.bot) return;
    
    // Ignore system messages
    if (message.system) return;
    
    // Only respond to messages in guilds (servers)
    if (!message.guild) return;

    // Log incoming messages for debugging
    console.log(`Message from ${message.author.username}: ${message.content}`);

    // Check if this message is a reply to the bot
    if (message.reference && message.reference.messageId) {
        try {
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
            
            // If the reply is to the bot, continue the conversation
            if (repliedMessage.author.id === client.user.id) {
                console.log(`Reply to bot from ${message.author.username}: ${message.content}`);
                
                // Process the reply through Ollama
                await processAIRequest(message, message.content, message.author.username, message.author.id);
                return;
            }
        } catch (error) {
            console.error('Error fetching replied message:', error);
        }
    }
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
    await processAIRequest(interaction, userMessage, username, userId, true);
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
                    console.log('\nAvailable Channels:');
                    client.guilds.cache.forEach(guild => {
                        console.log(`\n${guild.name}:`);
                        guild.channels.cache
                            .filter(ch => ch.type === 0) // Text channels only
                            .forEach(channel => {
                                console.log(`  - #${channel.name} (ID: ${channel.id})`);
                            });
                    });
                    console.log('');
                    break;

                case 'help':
                    console.log('\nManual Message Commands:');
                    console.log('- send <channel_id> <message> - Send a message to a specific channel');
                    console.log('- list - Show all available channels with their IDs');
                    console.log('- clear <thread_id> - Clear conversation history for a thread');
                    console.log('- clearall - Clear all conversation histories');
                    console.log('- help - Show this help message');
                    console.log('- exit - Close the bot\n');
                    break;

                case 'clear':
                    if (args.length < 2) {
                        console.log('Usage: clear <thread_id> (can be channel_id or message_id)');
                        break;
                    }
                    const threadId = args[1];
                    clearThreadConversation(threadId);
                    console.log(`Cleared conversation history for thread ${threadId}`);
                    break;

                case 'clearall':
                    conversationHistory.clear();
                    console.log('Cleared all conversation histories');
                    break;

                case 'exit':
                    console.log('Shutting down bot...');
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
        console.log('\nGoodbye!');
        process.exit(0);
    });
}

// Login to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);