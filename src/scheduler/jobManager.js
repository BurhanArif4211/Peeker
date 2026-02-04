// src/scheduler/job-manager.js
const cron = require('node-cron');
const EventEmitter = require('events');
const logger = require('../utils/logger');

class JobManager extends EventEmitter {
    constructor(db) {
        super();
        this.db = db;
        this.jobs = new Map();
        this.modules = new Map();
        this.isShuttingDown = false;
        
        // Graceful shutdown handling
        process.on('SIGTERM', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());
    }

    async initialize() {
        logger.info('Initializing job scheduler...');
        
        // Load tracking modules
        await this.loadModules();
        
        // Schedule the main checking job
        this.scheduleMainJob();
        
        // Schedule cleanup job (daily)
        this.scheduleCleanupJob();
        
        // Resume any pending trackings
        await this.resumePendingTrackings();
    }

    async loadModules() {
        // Dynamically load tracking modules
        const moduleNames = ['steam-tracker', 'stock-tracker', 'product-tracker'];
        
        for (const moduleName of moduleNames) {
            try {
                const module = require(`../modules/${moduleName}`);
                const type = module.getType();
                
                this.modules.set(type, module);
                logger.info(`Loaded module: ${moduleName} (${type})`);
            } catch (error) {
                logger.error(`Failed to load module ${moduleName}:`, error);
            }
        }
    }

    scheduleMainJob() {
        // Run every minute to check for due items
        this.jobs.set('main-checker', cron.schedule('* * * * *', async () => {
            if (this.isShuttingDown) return;
            
            try {
                await this.processDueItems();
            } catch (error) {
                logger.error('Error in main checking job:', error);
                this.emit('error', error);
            }
        }, {
            scheduled: true,
            timezone: "UTC"
        }));
        
        logger.info('Main checking job scheduled (every minute)');
    }

    scheduleCleanupJob() {
        // Run daily at 3 AM UTC
        this.jobs.set('cleanup', cron.schedule('0 3 * * *', async () => {
            await this.cleanupOldData();
        }, {
            scheduled: true,
            timezone: "UTC"
        }));
    }

    async processDueItems() {
        // Get items due for checking
        const dueItems = await this.db.all(`
            SELECT 
                ti.*,
                tt.type_name,
                tt.module_name,
                c.channel_name,
                g.guild_name
            FROM tracked_items ti
            JOIN tracking_types tt ON ti.tracking_type_id = tt.type_id
            JOIN channels c ON ti.channel_id = c.channel_id
            JOIN guilds g ON ti.guild_id = g.guild_id
            WHERE ti.is_active = TRUE 
            AND ti.is_paused = FALSE
            AND ti.next_check <= datetime('now')
            ORDER BY ti.next_check ASC
            LIMIT 50 -- Process in batches
        `);

        if (dueItems.length === 0) return;

        logger.debug(`Processing ${dueItems.length} due items`);
        
        // Process items in parallel with concurrency limit
        const concurrencyLimit = 10;
        for (let i = 0; i < dueItems.length; i += concurrencyLimit) {
            const batch = dueItems.slice(i, i + concurrencyLimit);
            await Promise.allSettled(
                batch.map(item => this.processItem(item))
            );
            
            // Small delay between batches
            if (i + concurrencyLimit < dueItems.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }

    async processItem(item) {
        const startTime = Date.now();
        
        try {
            const module = this.modules.get(item.type_name);
            if (!module) {
                throw new Error(`No module found for type: ${item.type_name}`);
            }

            // Parse metadata
            const metadata = JSON.parse(item.metadata || '{}');
            const params = { ...metadata, identifier: item.identifier };

            // Fetch current value
            const result = await module.fetch(params);
            
            // Parse last value for comparison
            const lastValue = item.last_value ? JSON.parse(item.last_value) : null;
            
            // Calculate change
            const change = this.calculateChange(lastValue, result);
            
            // Update database
            await this.db.run(`
                UPDATE tracked_items 
                SET 
                    last_checked = CURRENT_TIMESTAMP,
                    last_value = ?,
                    last_change_percentage = ?,
                    error_count = 0,
                    last_error = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = ?
            `, [
                JSON.stringify(result),
                change.percentage,
                item.item_id
            ]);
            
            // Save to history
            await this.db.run(`
                INSERT INTO tracking_history (item_id, value, change_percentage)
                VALUES (?, ?, ?)
            `, [
                item.item_id,
                JSON.stringify(result),
                change.percentage
            ]);
            
            // Check if we should notify
            if (change.shouldNotify && item.notify_on_change) {
                await this.sendNotification(item, result, change);
            }
            
            const processingTime = Date.now() - startTime;
            logger.debug(`Processed item ${item.item_id} in ${processingTime}ms`);
            
        } catch (error) {
            await this.handleProcessingError(item, error);
        }
    }

    calculateChange(oldValue, newValue) {
        if (!oldValue || !oldValue.price || !newValue.price) {
            return { percentage: 0, shouldNotify: false };
        }

        const oldPrice = parseFloat(oldValue.price);
        const newPrice = parseFloat(newValue.price);
        
        if (isNaN(oldPrice) || isNaN(newPrice) || oldPrice === 0) {
            return { percentage: 0, shouldNotify: false };
        }

        const percentage = ((newPrice - oldPrice) / oldPrice) * 100;
        const shouldNotify = Math.abs(percentage) >= 1.0; // Configurable threshold
        
        return { 
            percentage: parseFloat(percentage.toFixed(2)),
            shouldNotify 
        };
    }

    async sendNotification(item, currentValue, change) {
        try {
            // Get Discord channel (you'll need your Discord client here)
            const channel = await this.getDiscordChannel(item.channel_id);
            if (!channel) return;

            // Build notification message
            const message = this.buildNotificationMessage(item, currentValue, change);
            
            // Send notification
            await channel.send(message);
            
            logger.info(`Notification sent for item ${item.item_id} in channel ${item.channel_id}`);
            
        } catch (error) {
            logger.error(`Failed to send notification for item ${item.item_id}:`, error);
        }
    }

    async handleProcessingError(item, error) {
        const errorCount = item.error_count + 1;
        const maxErrors = 5;
        
        // Update error count
        await this.db.run(`
            UPDATE tracked_items 
            SET 
                error_count = ?,
                last_error = ?,
                is_active = CASE WHEN ? >= ? THEN FALSE ELSE is_active END,
                updated_at = CURRENT_TIMESTAMP
            WHERE item_id = ?
        `, [
            errorCount,
            error.message.substring(0, 255),
            errorCount,
            maxErrors,
            item.item_id
        ]);
        
        if (errorCount >= maxErrors) {
            logger.warn(`Deactivated item ${item.item_id} due to ${errorCount} consecutive errors`);
            
            // Notify admin about deactivation
            await this.notifyDeactivation(item, error);
        }
        
        logger.error(`Error processing item ${item.item_id}:`, error);
    }

    async resumePendingTrackings() {
        // Find items that were being processed when the bot shut down
        const pendingItems = await this.db.all(`
            SELECT * FROM tracked_items 
            WHERE is_active = TRUE 
            AND last_checked < datetime('now', '-1 hour')
            AND next_check < datetime('now', '-30 minutes')
        `);

        if (pendingItems.length > 0) {
            logger.info(`Resuming ${pendingItems.length} pending trackings`);
            
            // Reset their next_check time
            await this.db.run(`
                UPDATE tracked_items 
                SET next_check = CURRENT_TIMESTAMP
                WHERE item_id IN (${pendingItems.map(i => i.item_id).join(',')})
            `);
        }
    }

    async cleanupOldData() {
        // Delete history older than 90 days
        const result = await this.db.run(`
            DELETE FROM tracking_history 
            WHERE detected_at < datetime('now', '-90 days')
        `);
        
        logger.info(`Cleaned up ${result.changes} old history records`);
        
        // Deactivate items with too many errors
        await this.db.run(`
            UPDATE tracked_items 
            SET is_active = FALSE 
            WHERE error_count >= 10 
            AND is_active = TRUE
        `);
    }

    async shutdown() {
        if (this.isShuttingDown) return;
        
        this.isShuttingDown = true;
        logger.info('Shutting down job scheduler...');
        
        // Stop all cron jobs
        for (const [name, job] of this.jobs) {
            job.stop();
            logger.debug(`Stopped job: ${name}`);
        }
        
        // Wait for current processing to complete
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        logger.info('Job scheduler shutdown complete');
    }

    // Helper methods
    buildNotificationMessage(item, currentValue, change) {
        const changeEmoji = change.percentage > 0 ? '📈' : change.percentage < 0 ? '📉' : '➡️';
        const changeText = change.percentage > 0 ? 
            `+${change.percentage}%` : 
            `${change.percentage}%`;
        
        return {
            embeds: [{
                title: `🔔 ${item.display_name || item.identifier}`,
                description: `Price update detected!`,
                color: change.percentage > 0 ? 0x00ff00 : 0xff0000,
                fields: [
                    {
                        name: 'Current Price',
                        value: `$${currentValue.price}`,
                        inline: true
                    },
                    {
                        name: 'Change',
                        value: `${changeEmoji} ${changeText}`,
                        inline: true
                    },
                    {
                        name: 'Store',
                        value: currentValue.store || 'Steam',
                        inline: true
                    }
                ],
                timestamp: new Date(),
                footer: {
                    text: `Tracker Bot • ID: ${item.item_id}`
                }
            }]
        };
    }
}

module.exports = JobManager;
