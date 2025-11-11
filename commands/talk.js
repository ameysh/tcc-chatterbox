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
        )
        // Optional image/file attachment to send to the AI
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Optional image or file to include')
                .setRequired(false)
        ),
    async execute(interaction) {
        // This will be handled by the main bot file
        // The actual AI processing happens in index.js
        await interaction.deferReply();
        
    const userMessage = interaction.options.getString('message');
    // Optional attachment (image/file)
    const attachment = interaction.options.getAttachment && interaction.options.getAttachment('image');
    const attachments = attachment ? [attachment.url] : [];
        const userId = interaction.user.id;
        const username = interaction.user.displayName || interaction.user.username;
        
        // Emit custom event for AI processing
        interaction.client.emit('aiRequest', {
            interaction,
            userMessage,
            userId,
            username,
            attachments
        });
    },
};