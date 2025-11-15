const path = require('path');
const { generateImage } = require('./fooocus');

class ImageQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
    }

    enqueue({ prompt, interaction, timeoutMs = 4 * 60 * 1000 }) {
        return new Promise((resolve, reject) => {
            this.queue.push({ prompt, interaction, timeoutMs, resolve, reject });
            // Start processing if not already
            if (!this.processing) this._processNext();
        });
    }

    async _processNext() {
        this.processing = true;

        while (this.queue.length > 0) {
            const job = this.queue.shift();
            const { prompt, interaction, timeoutMs, resolve, reject } = job;

            try {
                console.log(`ImageQueue: starting job for ${interaction.user?.username || 'unknown user'}`);

                // Call generateImage which handles Playwright automation and/or outputs polling
                const imgPath = await generateImage(prompt, { timeoutMs });

                if (!imgPath) {
                    const msg = 'No image file was found after generation.';
                    try { await interaction.editReply({ content: msg }); } catch (e) { console.error('Failed to reply to interaction:', e); }
                    reject(new Error(msg));
                    continue;
                }

                // Buffer to allow preview to settle and filesystem flushes
                const bufferMs = 5000;
                await new Promise(r => setTimeout(r, bufferMs));

                const fileName = path.basename(imgPath);
                try {
                    await interaction.editReply({ content: `Here is your image for: "${prompt}"`, files: [{ attachment: imgPath, name: fileName }] });
                    resolve({ imgPath });
                } catch (err) {
                    console.error('Error sending image reply:', err);
                    try { await interaction.editReply({ content: `Image generated but failed to send: ${err.message}` }); } catch (e) { console.error('Failed to send fallback reply:', e); }
                    reject(err);
                }

            } catch (error) {
                console.error('ImageQueue job failed:', error);
                try { await interaction.editReply({ content: `Error generating image` }); } catch (e) { console.error('Failed to reply on error:', e); }
                reject(error);
            }
        }

        this.processing = false;
        console.log('ImageQueue: idle');
    }
}

// Export a singleton queue
module.exports = new ImageQueue();
