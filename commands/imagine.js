const { SlashCommandBuilder } = require('discord.js');
const imageQueue = require('../lib/imageQueue');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('imagine')
        .setDescription('Generate an image')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('Prompt to generate')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Defer immediately to keep the interaction open while queued
        await interaction.deferReply();

        const prompt = interaction.options.getString('prompt');

        try {
            // Enqueue the job; this promise resolves when the reply with the image is sent
            await imageQueue.enqueue({ prompt, interaction, timeoutMs: 4 * 60 * 1000 });
        } catch (error) {
            console.error('Error handling /imagine queue job:', error);
            try {
                // Attempt to inform the user
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: `Error generating image` });
                } else {
                    await interaction.editReply({ content: `Error generating image` });
                }
            } catch (e) {
                console.error('Failed to send error response to interaction:', e);
            }
        }
    },
};
