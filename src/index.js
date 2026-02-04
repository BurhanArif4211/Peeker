// src/index.js
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Database = require('./database/connection');
const CommandParser = require('./commands/parser');
const JobManager = require('./scheduler/jobManager');
const logger = require('./utils/logger');

class TrackerBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers
            ]
        });

        this.db = Database.getInstance();
        this.parser = null;
        this.scheduler = null;
        
        this.setupEventHandlers();
    }

    async start() {
        try {
            logger.info('Starting Tracker Bot...');
            
            // Initialize database
            await this.db.initialize();
            
            // Initialize parser
            this.parser = new CommandParser(this.db.db);
            
            // Initialize job scheduler
            this.scheduler = new JobManager(this.db.db);
            await this.scheduler.initialize();
            
            // Login to Discord
            await this.client.login(process.env.DISCORD_TOKEN);
            
            logger.info('Tracker Bot started successfully');
            
        } catch (error) {
            logger.error('Failed to start bot:', error);
            process.exit(1);
        }
    }

    setupEventHandlers() {
        this.client.once('ready', () => {
            logger.info(`Logged in as ${this.client.user.tag}`);
            this.registerSlashCommands();
        });

        this.client.on('guildCreate', async (guild) => {
            await this.handleGuildJoin(guild);
        });

        this.client.on('guildDelete', async (guild) => {
            await this.handleGuildLeave(guild);
        });

        this.client.on('interactionCreate', async (interaction) => {
            await this.handleInteraction(interaction);
        });
    }

    async handleGuildJoin(guild) {
        logger.info(`Joined guild: ${guild.name} (${guild.id})`);
        
        await this.db.db.run(`
            INSERT OR REPLACE INTO guilds 
            (guild_id, guild_name, owner_id, member_count, icon_hash)
            VALUES (?, ?, ?, ?, ?)
        `, [
            guild.id,
            guild.name,
            guild.ownerId,
            guild.memberCount,
            guild.icon
        ]);
        
        // Store channels
        for (const channel of guild.channels.cache.values()) {
            if (channel.isTextBased()) {
                await this.db.db.run(`
                    INSERT OR REPLACE INTO channels 
                    (channel_id, guild_id, channel_name, channel_type)
                    VALUES (?, ?, ?, ?)
                `, [
                    channel.id,
                    guild.id,
                    channel.name,
                    channel.type
                ]);
            }
        }
    }

    async handleInteraction(interaction) {
        if (!interaction.isCommand()) return;
        
        try {
            switch (interaction.commandName) {
                case 'track':
                    await this.handleTrackCommand(interaction);
                    break;
                case 'list':
                    await this.handleListCommand(interaction);
                    break;
                case 'untrack':
                    await this.handleUntrackCommand(interaction);
                    break;
                case 'status':
                    await this.handleStatusCommand(interaction);
                    break;
            }
        } catch (error) {
            logger.error('Command handling error:', error);
            await interaction.reply({
                content: '❌ An error occurred while processing your command.',
                ephemeral: true
            });
        }
    }

    async handleTrackCommand(interaction) {
        await interaction.deferReply();
        
        const input = interaction.options.getString('url_or_identifier');
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const channelId = interaction.channelId;
        
        // Parse and validate input
        const parsed = await this.parser.parseTrackCommand(
            input, userId, guildId, channelId
        );
        
        if (parsed.validationErrors.length > 0) {
            await interaction.editReply({
                content: `❌ **Validation Errors:**\n${parsed.validationErrors.map(e => `• ${e}`).join('\n')}`
            });
            return;
        }
        
        // Check if already tracking
        const existing = await this.db.db.get(`
            SELECT item_id FROM tracked_items 
            WHERE guild_id = ? 
            AND tracking_type_id = (
                SELECT type_id FROM tracking_types WHERE type_name = ?
            )
            AND identifier = ?
            AND is_active = TRUE
        `, [guildId, parsed.type, parsed.identifier]);
        
        if (existing) {
            await interaction.editReply({
                content: `⚠️ Already tracking this item! (ID: ${existing.item_id})`
            });
            return;
        }
        
        // Create tracking entry
        const typeInfo = await this.db.db.get(
            'SELECT type_id, default_check_interval FROM tracking_types WHERE type_name = ?',
            [parsed.type]
        );
        
        const result = await this.db.db.run(`
            INSERT INTO tracked_items 
            (tracking_type_id, guild_id, channel_id, created_by_user_id,
             identifier, display_name, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            typeInfo.type_id,
            guildId,
            channelId,
            userId,
            parsed.identifier,
            parsed.metadata.display_name || null,
            JSON.stringify(parsed.metadata)
        ]);
        
        // Audit log
        await this.db.db.run(`
            INSERT INTO audit_log 
            (guild_id, user_id, action_type, resource_type, resource_id)
            VALUES (?, ?, ?, ?, ?)
        `, [
            guildId,
            userId,
            'CREATE',
            'tracked_item',
            result.lastID.toString()
        ]);
        
        await interaction.editReply({
            content: `✅ **Now tracking!**\n` +
                    `**Type:** ${parsed.type}\n` +
                    `**Item:** ${parsed.identifier}\n` +
                    `**ID:** ${result.lastID}\n` +
                    `**Next check:** In ${typeInfo.default_check_interval / 60} minutes`
        });
    }
}

// Start the bot
const bot = new TrackerBot();
bot.start().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    if (bot.scheduler) {
        await bot.scheduler.shutdown();
    }
    process.exit(0);
});
