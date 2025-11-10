const { Client, GatewayIntentBits, Events } = require('discord.js');
const readline = require('readline');
require('dotenv').config();

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

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