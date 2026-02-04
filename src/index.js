// src/index.js
require('dotenv').config();
const { Client, GatewayIntentBits,REST,Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Database = require('./database/connection');
const CommandParser = require('./commands/parser');
const JobManager = require('./scheduler/jobManager');
const logger = require('./utils/logger');

class SeekerBot {
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
        this.commands = this.createCommands();
        this.setupEventHandlers();
    }
    createCommands() {
        return [
            new SlashCommandBuilder()
                .setName('track')
                .setDescription('Track a Steam game price')
                .addStringOption(option =>
                    option.setName('url_or_id')
                        .setDescription('Steam store URL or App ID')
                        .setRequired(true)
                ),
            
            new SlashCommandBuilder()
                .setName('list')
                .setDescription('List all tracked games in this server'),
            
            new SlashCommandBuilder()
                .setName('untrack')
                .setDescription('Stop tracking a game')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('Tracking ID (from /list)')
                        .setRequired(true)
                ),
            
            new SlashCommandBuilder()
                .setName('check')
                .setDescription('Manually check a tracked game now')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('Tracking ID (from /list)')
                        .setRequired(true)
                ),
            
            new SlashCommandBuilder()
                .setName('help')
                .setDescription('Show help information')
        ];
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
            await this.client.login(process.env.ONI_SECRET_TOKEN);
            
            logger.info('Tracker Bot started successfully');
            
        } catch (error) {
            logger.error('Failed to start bot:', error);
            process.exit(1);
        }
    }

    setupEventHandlers() {
        this.client.once('clientReady', () => {
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

    async registerSlashCommands() {
        try {
            const rest = new REST({ version: '10' }).setToken(process.env.ONI_SECRET_TOKEN);
            
            logger.info('Started refreshing application (/) commands.');
            
            await rest.put(
                Routes.applicationCommands(process.env.ONI_APP_ID),
                { body: this.commands.map(cmd => cmd.toJSON()) }
            );
            
            logger.info('Successfully reloaded application (/) commands.');
        } catch (error) {
            logger.error('Error registering slash commands:', error);
        }
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
                case 'check':
                    await this.handleCheckCommand(interaction);
                    break;
                case 'help':
                    await this.handleHelpCommand(interaction);
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
        
        const input = interaction.options.getString('url_or_id');
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const channelId = interaction.channelId;
        
        logger.info(`Track command: ${input} by ${userId} in ${guildId}`);
        
        try {
            // Parse 
            const result = await this.parser.parse(input, 'steam');
            
            if (!result.success) {
                await interaction.editReply({
                    content: `❌ ${result.error}`
                });
                return;
            }

            // Check if already tracking in this guild
            const existing = await this.db.db.get(`
                SELECT ti.itemId, ti.displayName 
                FROM tracked_items ti
                JOIN tracking_types tt ON ti.trackingTypeId = tt.typeId
                WHERE ti.guildId = ? 
                AND tt.typeName = 'steam'
                AND ti.identifier = ?
                AND ti.isActive = TRUE
            `, [guildId, result.identifier]);
            
            
            if (existing) {
                await interaction.editReply({
                    content: `⚠️ Already tracking **${existing.displayName || result.identifier}** (ID: ${existing.itemId})`
                });
                return;
            }

            // Check guild limits
            const typeInfo = await this.db.db.get(
                'SELECT typeId, maxItemsPerGuild FROM tracking_types WHERE typeName = ?',
                ['steam']
            );

            const guildCount = await this.db.db.get(`
                SELECT COUNT(*) as count
                FROM tracked_items ti
                JOIN tracking_types tt ON ti.trackingTypeId = tt.typeId
                WHERE ti.guildId = ?
                AND tt.typeName = 'steam'
                AND ti.isActive = TRUE
            `, [guildId]);

            if (guildCount.count >= typeInfo.maxItemsPerGuild) {
                await interaction.editReply({
                    content: `❌ This server has reached the limit of ${typeInfo.maxItemsPerGuild} tracked Steam games.`
                });
                return;
            }

            // Get default check interval
            const defaultInterval = await this.db.db.get(
                'SELECT defaultCheckInterval FROM tracking_types WHERE typeName = ?',
                ['steam']
            );

            // Calculate next check time (10 seconds from now for immediate first check)
            const nextCheck = new Date(Date.now() + 10000);

            // Create tracking entry
            const dbResult = await this.db.db.run(`
                INSERT INTO tracked_items 
                (trackingTypeId, guildId, channelId, createdByUserId,
                 identifier, displayName, metadata, nextCheck)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                typeInfo.typeId,
                guildId,
                channelId,
                userId,
                result.identifier,
                result.displayName,
                JSON.stringify(result.metadata),
                nextCheck.toISOString()
            ]);

            await interaction.editReply({
                content: `✅ Now tracking **${result.displayName || `Steam App ${result.identifier}`}**!\n` +
                        `Tracking ID: **${dbResult.lastID}**\n` +
                        `The bot will check prices every ${defaultInterval.defaultCheckInterval / 3600} hours.`
            });

        } catch (error) {
            logger.error('Error in track command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while setting up tracking. Please try again.'
            });
        }
    }

    async handleListCommand(interaction) {
        await interaction.deferReply();
        
        const guildId = interaction.guildId;
        
        try {
            const items = await this.db.db.all(`
                SELECT 
                    ti.itemId,
                    ti.displayName,
                    ti.identifier,
                    ti.lastValue,
                    ti.lastChecked,
                    ti.nextCheck,
                    ti.errorCount,
                    ti.isPaused
                FROM tracked_items ti
                JOIN tracking_types tt ON ti.trackingTypeId = tt.typeId
                WHERE ti.guildId = ?
                AND tt.typeName = 'steam'
                AND ti.isActive = TRUE
                ORDER BY ti.createdAt DESC
            `, [guildId]);

            if (items.length === 0) {
                await interaction.editReply({
                    content: 'No tracked games in this server. Use `/track <steam-url>` to start tracking!'
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(`📊 Tracked Games in ${interaction.guild.name}`)
                .setColor(0x0099FF)
                .setTimestamp();

            for (const item of items) {
                let status = '🟢 Active';
                if (item.isPaused) status = '⏸️ Paused';
                if (item.errorCount >= 3) status = '⚠️ Errors';

                let lastPrice = 'Not checked yet';
                if (item.lastValue) {
                    const value = JSON.parse(item.lastValue);
                    lastPrice = `$${value.price}`;
                    if (value.discountPercent > 0) {
                        lastPrice += ` (${value.discountPercent}% off)`;
                    }
                }

                embed.addFields({
                    name: `${item.displayName || `Steam App ${item.identifier}`} (ID: ${item.itemId})`,
                    value: `Status: ${status}\nLast Price: ${lastPrice}\nErrors: ${item.errorCount}`,
                    inline: false
                });
            }

            embed.setFooter({ 
                text: `Total: ${items.length} games • Use /untrack <id> to stop tracking` 
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('Error in list command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while fetching the list.'
            });
        }
    }

    async handleUntrackCommand(interaction) {
        await interaction.deferReply();
        
        const itemId = interaction.options.getInteger('id');
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        
        try {
            // Verify the item belongs to this guild and user has permission
            const item = await this.db.db.get(`
                SELECT ti.*, g.ownerId
                FROM tracked_items ti
                JOIN guilds g ON ti.guildId = g.guildId
                WHERE ti.itemId = ? AND ti.guildId = ?
            `, [itemId, guildId]);

            if (!item) {
                await interaction.editReply({
                    content: '❌ Tracking ID not found or does not belong to this server.'
                });
                return;
            }

            // Check permission (user created it or is guild owner/admin)
            const member = await interaction.guild.members.fetch(userId);
            const isAdmin = member.permissions.has('ADMINISTRATOR');
            
            if (item.createdByUserId !== userId && item.ownerId !== userId && !isAdmin) {
                await interaction.editReply({
                    content: '❌ You do not have permission to untrack this game.'
                });
                return;
            }

            // Deactivate the tracking
            await this.db.db.run(`
                UPDATE tracked_items 
                SET isActive = FALSE, updatedAt = CURRENT_TIMESTAMP
                WHERE itemId = ?
            `, [itemId]);

            await interaction.editReply({
                content: `✅ Successfully stopped tracking **${item.displayName || `Steam App ${item.identifier}`}**.`
            });

        } catch (error) {
            logger.error('Error in untrack command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while stopping tracking.'
            });
        }
    }

    async handleCheckCommand(interaction) {
        await interaction.deferReply();
        
        const itemId = interaction.options.getInteger('id');
        const guildId = interaction.guildId;
        
        try {
            // Get the item
            const item = await this.db.db.get(`
                SELECT ti.*
                FROM tracked_items ti
                WHERE ti.itemId = ? AND ti.guildId = ? AND ti.isActive = TRUE
            `, [itemId, guildId]);

            if (!item) {
                await interaction.editReply({
                    content: '❌ Active tracking ID not found in this server.'
                });
                return;
            }

            // Force immediate check by updating nextCheck to now
            await this.db.db.run(`
                UPDATE tracked_items 
                SET nextCheck = datetime('now')
                WHERE itemId = ?
            `, [itemId]);

            await interaction.editReply({
                content: `✅ **${item.displayName || `Steam App ${item.identifier}`}** will be checked within the next minute.`
            });

        } catch (error) {
            logger.error('Error in check command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while scheduling the check.'
            });
        }
    }

    async handleHelpCommand(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🛠️ Tracker Bot Help')
            .setColor(0x0099FF)
            .setDescription('A bot to track Steam game prices')
            .addFields(
                {
                    name: '📌 Commands',
                    value: 
                        '`/track <url_or_id>` - Track a Steam game\n' +
                        '`/list` - List all tracked games\n' +
                        '`/untrack <id>` - Stop tracking a game\n' +
                        '`/check <id>` - Force check a game now\n' +
                        '`/help` - Show this message'
                },
                {
                    name: '🔗 Examples',
                    value: 
                        '`/track https://store.steampowered.com/app/730/`\n' +
                        '`/track 730` (CS:GO App ID)\n' +
                        '`/untrack 5` (use ID from /list)'
                },
                {
                    name: '⚙️ How it works',
                    value: 
                        '• The bot checks prices every hour\n' +
                        '• You\'ll get notifications for price changes\n' +
                        '• Max 20 games per server\n' +
                        '• Price history is kept for 30 days'
                }
            )
            .setFooter({ text: 'Made with ❤️ for gamers' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    // async handleInteraction(interaction) {
    //     if (!interaction.isCommand()) return;
        
    //     try {
    //         switch (interaction.commandName) {
    //             case 'track':
    //                 await this.handleTrackCommand(interaction);
    //                 break;
    //             case 'list':
    //                 await this.handleListCommand(interaction);
    //                 break;
    //             case 'untrack':
    //                 await this.handleUntrackCommand(interaction);
    //                 break;
    //             case 'status':
    //                 await this.handleStatusCommand(interaction);
    //                 break;
    //         }
    //     } catch (error) {
    //         logger.error('Command handling error:', error);
    //         await interaction.reply({
    //             content: '❌ An error occurred while processing your command.',
    //             ephemeral: true
    //         });
    //     }
    // }

    // async handleTrackCommand(interaction) {
    //     await interaction.deferReply();
        
    //     const input = interaction.options.getString('url_or_identifier');
    //     const userId = interaction.user.id;
    //     const guildId = interaction.guildId;
    //     const channelId = interaction.channelId;
        
    //     // Parse and validate input
    //     const parsed = await this.parser.parseTrackCommand(
    //         input, userId, guildId, channelId
    //     );
        
    //     if (parsed.validationErrors.length > 0) {
    //         await interaction.editReply({
    //             content: `❌ **Validation Errors:**\n${parsed.validationErrors.map(e => `• ${e}`).join('\n')}`
    //         });
    //         return;
    //     }
        
    //     // Check if already tracking
    //     const existing = await this.db.db.get(`
    //         SELECT item_id FROM tracked_items 
    //         WHERE guild_id = ? 
    //         AND tracking_type_id = (
    //             SELECT type_id FROM tracking_types WHERE type_name = ?
    //         )
    //         AND identifier = ?
    //         AND is_active = TRUE
    //     `, [guildId, parsed.type, parsed.identifier]);
        
    //     if (existing) {
    //         await interaction.editReply({
    //             content: `⚠️ Already tracking this item! (ID: ${existing.item_id})`
    //         });
    //         return;
    //     }
        
    //     // Create tracking entry
    //     const typeInfo = await this.db.db.get(
    //         'SELECT type_id, default_check_interval FROM tracking_types WHERE type_name = ?',
    //         [parsed.type]
    //     );
        
    //     const result = await this.db.db.run(`
    //         INSERT INTO tracked_items 
    //         (tracking_type_id, guild_id, channel_id, created_by_user_id,
    //          identifier, display_name, metadata)
    //         VALUES (?, ?, ?, ?, ?, ?, ?)
    //     `, [
    //         typeInfo.type_id,
    //         guildId,
    //         channelId,
    //         userId,
    //         parsed.identifier,
    //         parsed.metadata.display_name || null,
    //         JSON.stringify(parsed.metadata)
    //     ]);
        
    //     // Audit log
    //     await this.db.db.run(`
    //         INSERT INTO audit_log 
    //         (guild_id, user_id, action_type, resource_type, resource_id)
    //         VALUES (?, ?, ?, ?, ?)
    //     `, [
    //         guildId,
    //         userId,
    //         'CREATE',
    //         'tracked_item',
    //         result.lastID.toString()
    //     ]);
        
    //     await interaction.editReply({
    //         content: `✅ **Now tracking!**\n` +
    //                 `**Type:** ${parsed.type}\n` +
    //                 `**Item:** ${parsed.identifier}\n` +
    //                 `**ID:** ${result.lastID}\n` +
    //                 `**Next check:** In ${typeInfo.default_check_interval / 60} minutes`
    //     });
    // }
}

// Start the bot
const seeker = new SeekerBot();
seeker.start().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    if (seeker.scheduler) {
        await seeker.scheduler.shutdown();
    }
    process.exit(0);
});
