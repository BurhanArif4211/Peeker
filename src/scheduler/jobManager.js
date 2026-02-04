// src/scheduler/jobManager.js
const cron = require('node-cron');
const logger = require('../utils/logger');
const SteamTracker = require('../modules/steamTracker');

class JobManager {
    constructor(db, discordClient) {
        this.db = db;
        this.client = discordClient;
        this.jobs = new Map();
        this.isShuttingDown = false;
        
        // Graceful shutdown
        process.on('SIGTERM', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());
    }

    async initialize() {
        logger.info('Initializing job scheduler...');
        
        // Schedule the main checking job (every minute)
        this.jobs.set('main-checker', cron.schedule('* * * * *', async () => {
            await this.checkDueItems();
        }));
        
        // Schedule daily cleanup job (2 AM UTC)
        this.jobs.set('cleanup', cron.schedule('0 2 * * *', async () => {
            await this.cleanup();
        }, {
            timezone: "UTC"
        }));
        
        logger.info('Job scheduler initialized');
    }

    async checkDueItems() {
        if (this.isShuttingDown) return;
        
        try {
            // Get items due for checking
            const dueItems = await this.db.all(`
                SELECT 
                    ti.*,
                    tt.typeName,
                    c.channelName,
                    g.guildName
                FROM tracked_items ti
                JOIN tracking_types tt ON ti.trackingTypeId = tt.typeId
                JOIN channels c ON ti.channelId = c.channelId
                JOIN guilds g ON ti.guildId = g.guildId
                WHERE ti.isActive = TRUE 
                AND ti.isPaused = FALSE
                AND (ti.nextCheck IS NULL OR ti.nextCheck <= datetime('now'))
                ORDER BY ti.nextCheck ASC NULLS FIRST
                LIMIT 10 -- Process 10 at a time to avoid rate limiting
            `);

            if (dueItems.length === 0) return;

            logger.debug(`Processing ${dueItems.length} due items`);
            
            // Process each item
            for (const item of dueItems) {
                await this.processItem(item);
                // Small delay between items to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
        } catch (error) {
            logger.error('Error in checkDueItems:', error);
        }
    }

    async processItem(item) {
        const startTime = Date.now();
        
        try {
            // Determine which tracker to use based on type
            let result;
            if (item.typeName === 'steam') {
                result = await SteamTracker.fetch({
                    identifier: item.identifier,
                    region: 'us'
                });
            } else {
                throw new Error(`Unknown tracker type: ${item.typeName}`);
            }

            if (!result.success) {
                throw new Error(result.error || 'Unknown error');
            }

            // Parse last value for comparison
            const lastValue = item.lastValue ? JSON.parse(item.lastValue) : null;
            
            // Calculate price change
            const change = this.calculatePriceChange(lastValue, result);
            
            // Calculate next check time
            const checkInterval = item.customCheckInterval || 
                (await this.getDefaultCheckInterval(item.trackingTypeId));
            const nextCheck = new Date(Date.now() + (checkInterval * 1000));
            
            // Update database
            await this.db.run(`
                UPDATE tracked_items 
                SET 
                    lastChecked = CURRENT_TIMESTAMP,
                    nextCheck = ?,
                    lastValue = ?,
                    lastChangePercentage = ?,
                    errorCount = 0,
                    lastError = NULL,
                    updatedAt = CURRENT_TIMESTAMP
                WHERE itemId = ?
            `, [
                nextCheck.toISOString(),
                JSON.stringify(result),
                change.percentage,
                item.itemId
            ]);
            
            // Save to history
            await this.db.run(`
                INSERT INTO tracking_history (itemId, value, price, discountPercent)
                VALUES (?, ?, ?, ?)
            `, [
                item.itemId,
                JSON.stringify(result),
                parseFloat(result.price),
                result.discountPercent || 0
            ]);
            
            // Send notification if significant change detected
            if (change.shouldNotify && item.notifyOnChange) {
                await this.sendNotification(item, result, change);
            }
            
            const processingTime = Date.now() - startTime;
            logger.debug(`Processed item ${item.itemId} in ${processingTime}ms`);
            
        } catch (error) {
            await this.handleProcessingError(item, error);
        }
    }

    calculatePriceChange(oldValue, newValue) {
        if (!oldValue || !oldValue.price || oldValue.price === 'Free') {
            return { percentage: 0, shouldNotify: false };
        }

        const oldPrice = parseFloat(oldValue.price);
        const newPrice = parseFloat(newValue.price);
        
        if (isNaN(oldPrice) || isNaN(newPrice) || oldPrice === 0) {
            return { percentage: 0, shouldNotify: false };
        }

        const percentage = ((newPrice - oldPrice) / oldPrice) * 100;
        const shouldNotify = Math.abs(percentage) >= 1.0; // Notify on 1%+ change
        
        return { 
            percentage: parseFloat(percentage.toFixed(2)),
            shouldNotify 
        };
    }

    async sendNotification(item, currentValue, change) {
        try {
            const channel = await this.getDiscordChannel(item.channelId);
            if (!channel) {
                logger.warn(`Channel ${item.channelId} not found for notification`);
                return;
            }

            const embed = this.buildNotificationEmbed(item, currentValue, change);
            await channel.send({ embeds: [embed] });
            
            logger.info(`Notification sent for ${item.displayName || item.identifier} in ${item.guildName}`);
            
        } catch (error) {
            logger.error(`Failed to send notification for item ${item.itemId}:`, error);
        }
    }

    async getDiscordChannel(channelId) {
        if (!this.client) return null;
        
        try {
            return await this.client.channels.fetch(channelId);
        } catch (error) {
            return null;
        }
    }

    buildNotificationEmbed(item, currentValue, change) {
        const changeEmoji = change.percentage > 0 ? '📈' : change.percentage < 0 ? '📉' : '➡️';
        const changeText = change.percentage > 0 ? 
            `+${change.percentage}%` : 
            `${change.percentage}%`;
        
        const embed = {
            color: change.percentage < 0 ? 0x00FF00 : 0xFF0000, // Green for price drop, red for increase
            title: `💰 Price Update: ${currentValue.name}`,
            url: currentValue.steamUrl,
            thumbnail: currentValue.thumbnail ? { url: currentValue.thumbnail } : undefined,
            fields: [
                {
                    name: 'Current Price',
                    value: `$${currentValue.price} ${currentValue.currency}`,
                    inline: true
                },
                {
                    name: 'Change',
                    value: `${changeEmoji} ${changeText}`,
                    inline: true
                }
            ],
            timestamp: new Date(),
            footer: {
                text: `Tracker Bot • Use /list to see all tracked games`
            }
        };

        // Add discount info if applicable
        if (currentValue.discountPercent > 0) {
            embed.fields.push({
                name: 'Discount',
                value: `🏷️ ${currentValue.discountPercent}% off!`,
                inline: true
            });
            
            if (currentValue.originalPrice) {
                embed.fields.push({
                    name: 'Original Price',
                    value: `~~$${currentValue.originalPrice}~~`,
                    inline: true
                });
            }
        }

        return embed;
    }

    async handleProcessingError(item, error) {
        const errorCount = item.errorCount + 1;
        const maxErrors = 5;
        
        // Update error count
        await this.db.run(`
            UPDATE tracked_items 
            SET 
                errorCount = ?,
                lastError = ?,
                isActive = CASE WHEN ? >= ? THEN FALSE ELSE isActive END,
                updatedAt = CURRENT_TIMESTAMP
            WHERE itemId = ?
        `, [
            errorCount,
            error.message.substring(0, 200),
            errorCount,
            maxErrors,
            item.itemId
        ]);
        
        if (errorCount >= maxErrors) {
            logger.warn(`Deactivated item ${item.itemId} due to ${errorCount} consecutive errors: ${error.message}`);
        }
        
        logger.error(`Error processing item ${item.itemId}:`, error.message);
    }

    async getDefaultCheckInterval(trackingTypeId) {
        const result = await this.db.get(
            'SELECT defaultCheckInterval FROM tracking_types WHERE typeId = ?',
            [trackingTypeId]
        );
        return result ? result.defaultCheckInterval : 3600;
    }

    async cleanup() {
        // Delete history older than 30 days
        const result = await this.db.run(`
            DELETE FROM tracking_history 
            WHERE detectedAt < datetime('now', '-30 days')
        `);
        
        if (result.changes > 0) {
            logger.info(`Cleaned up ${result.changes} old history records`);
        }
        
        // Deactivate items with too many errors
        const deactivated = await this.db.run(`
            UPDATE tracked_items 
            SET isActive = FALSE 
            WHERE errorCount >= 10 
            AND isActive = TRUE
        `);
        
        if (deactivated.changes > 0) {
            logger.info(`Deactivated ${deactivated.changes} items with too many errors`);
        }
    }

    async shutdown() {
        if (this.isShuttingDown) return;
        
        this.isShuttingDown = true;
        logger.info('Shutting down job scheduler...');
        
        // Stop all cron jobs
        for (const [name, job] of this.jobs) {
            job.stop();
        }
        
        logger.info('Job scheduler shutdown complete');
    }
}

module.exports = JobManager;