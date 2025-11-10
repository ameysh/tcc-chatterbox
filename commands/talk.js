const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('talk')
        .setDescription('Talk to the AI bot')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Your message to the AI')
                .setRequired(true)
                .setMaxLength(2000)
        ),
    async execute(interaction) {
        // This will be handled by the main bot file
        // The actual AI processing happens in index.js
        await interaction.deferReply();
        
        const userMessage = interaction.options.getString('message');
        const userId = interaction.user.id;
        const username = interaction.user.displayName || interaction.user.username;
        
        // Emit custom event for AI processing
        interaction.client.emit('aiRequest', {
            interaction,
            userMessage,
            userId,
            username
        });
    },
};