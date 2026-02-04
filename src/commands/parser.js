// src/commands/parser.js
const logger = require('../utils/logger');

class CommandParser {
    constructor(db) {
        this.db = db;
        // Register parsers for different tracker types
        this.parsers = {
            'steam': this.parseSteamInput.bind(this)
        };
        
        // Future: Add more parsers here
        // this.parsers['stock'] = this.parseStockInput.bind(this);
    }

    async parse(input, trackerType = 'steam') {
        const parser = this.parsers[trackerType];
        
        if (!parser) {
            return {
                success: false,
                error: `No parser available for tracker type: ${trackerType}`
            };
        }

        try {
            return await parser(input);
        } catch (error) {
            logger.error('Parse error:', error);
            return {
                success: false,
                error: `Failed to parse input: ${error.message}`
            };
        }
    }

    async parseSteamInput(input) {
        // Clean input
        const cleanInput = input.trim();
        
        // Extract app ID
        const SteamTracker = require('../modules/steamTracker');
        const appId = SteamTracker.extractAppId(cleanInput);
        
        if (!appId) {
            return {
                success: false,
                error: 'Could not extract Steam App ID from input. Please provide a valid Steam store URL or App ID.'
            };
        }

        // Validate the app ID
        const validation = SteamTracker.validateIdentifier(appId);
        if (!validation.valid) {
            return {
                success: false,
                error: validation.error
            };
        }

        // Optional: Fetch game name for display
        let displayName = null;
        try {
            const gameInfo = await SteamTracker.fetch({ identifier: appId });
            displayName = gameInfo.name;
        } catch (error) {
            // If we can't fetch the name, we'll use the app ID as display
            logger.warn(`Could not fetch game name for app ID ${appId}:`, error.message);
        }

        return {
            success: true,
            trackerType: 'steam',
            identifier: appId,
            displayName: displayName,
            metadata: validation.metadata
        };
    }

    // Future: Add more parser methods for other tracker types
    // async parseStockInput(input) { ... }
    // async parseProductInput(input) { ... }
}

module.exports = CommandParser;

// // src/commands/parser.js
// const url = require('url');
// const validator = require('validator');
// const logger = require('../utils/logger');

// class CommandParser {
//     constructor(db) {
//         this.db = db;
//         this.urlPatterns = {
//             steam: [
//                 /store\.steampowered\.com\/app\/(\d+)/,
//                 /steamcommunity\.com\/app\/(\d+)/
//             ],
//             amazon: [
//                 /amazon\.(com|ca|co\.uk|de|fr|it|es|co\.jp)\/[^/]+\/dp\/([A-Z0-9]{10})/
//             ],
//             youtube: [
//                 /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
//                 /youtu\.be\/([a-zA-Z0-9_-]{11})/
//             ]
//         };
//     }

//     async parseTrackCommand(input, userId, guildId, channelId) {
//         // Input can be: URL, command with type, or ambiguous identifier
//         const parsed = {
//             input,
//             userId,
//             guildId,
//             channelId,
//             type: null,
//             identifier: null,
//             metadata: {},
//             validationErrors: []
//         };

//         // Step 1: Try to parse as URL
//         const urlParseResult = this.parseUrl(input);
//         if (urlParseResult) {
//             Object.assign(parsed, urlParseResult);
//         } else {
//             // Step 2: Try to parse as command with explicit type
//             const commandParseResult = this.parseCommandWithType(input);
//             if (commandParseResult) {
//                 Object.assign(parsed, commandParseResult);
//             } else {
//                 // Step 3: Try to identify type from ambiguous input
//                 const type = this.guessTypeFromInput(input);
//                 if (type) {
//                     parsed.type = type;
//                     parsed.identifier = input;
//                 } else {
//                     parsed.validationErrors.push('Could not determine tracking type from input');
//                 }
//             }
//         }

//         // Step 4: Validate against tracking type
//         if (parsed.type) {
//             const validationResult = await this.validateForType(parsed.type, parsed.identifier);
//             if (validationResult.valid) {
//                 parsed.identifier = validationResult.normalized;
//                 parsed.metadata = { ...parsed.metadata, ...validationResult.metadata };
//             } else {
//                 parsed.validationErrors.push(...validationResult.errors);
//             }
//         }

//         // Step 5: Check user/guild limits
//         const limitCheck = await this.checkLimits(userId, guildId, parsed.type);
//         if (!limitCheck.allowed) {
//             parsed.validationErrors.push(limitCheck.reason);
//         }

//         return parsed;
//     }

//     parseUrl(input) {
//         try {
//             // Check if input looks like a URL
//             if (!input.includes('://') && !input.startsWith('www.')) {
//                 return null;
//             }

//             const parsedUrl = new URL(input.includes('://') ? input : `https://${input}`);
//             const hostname = parsedUrl.hostname.replace('www.', '');

//             // Match against known patterns
//             for (const [type, patterns] of Object.entries(this.urlPatterns)) {
//                 for (const pattern of patterns) {
//                     const match = parsedUrl.href.match(pattern);
//                     if (match) {
//                         return {
//                             type,
//                             identifier: match[1] || match[2],
//                             metadata: {
//                                 url: parsedUrl.href,
//                                 hostname,
//                                 fullMatch: match[0]
//                             }
//                         };
//                     }
//                 }
//             }

//             // Generic URL handling
//             return {
//                 type: 'product',
//                 identifier: parsedUrl.href,
//                 metadata: {
//                     url: parsedUrl.href,
//                     hostname,
//                     isGenericUrl: true
//                 }
//             };
//         } catch (error) {
//             logger.debug('URL parse failed:', error.message);
//             return null;
//         }
//     }

//     parseCommandWithType(input) {
//         // Patterns: "steam 730", "stock AAPL", "type:steam id:730"
//         const patterns = [
//             // "type identifier"
//             /^(\w+)\s+([^\s]+)$/,
//             // "type:identifier"
//             /^(\w+):([^\s]+)$/,
//             // Key-value pairs
//             /type:(\w+).*?(?:id|url|symbol):([^\s]+)/i
//         ];

//         for (const pattern of patterns) {
//             const match = input.match(pattern);
//             if (match) {
//                 const [, type, identifier] = match;
//                 return {
//                     type: type.toLowerCase(),
//                     identifier: identifier.trim()
//                 };
//             }
//         }

//         return null;
//     }

//     guessTypeFromInput(input) {
//         const inputLower = input.toLowerCase().trim();

//         // Steam App IDs are numeric
//         if (/^\d+$/.test(inputLower)) {
//             return 'steam';
//         }

//         // Stock symbols: 1-5 uppercase letters
//         if (/^[A-Z]{1,5}$/.test(input)) {
//             return 'stock';
//         }

//         // Cryptocurrency: BTC, ETH, etc.
//         if (/^(BTC|ETH|XRP|ADA|DOT|SOL|DOGE|SHIB)$/i.test(input)) {
//             return 'crypto';
//         }

//         // ISBN numbers
//         if (/^(97[89])?\d{9}[\dX]$/.test(input)) {
//             return 'book';
//         }

//         return null;
//     }

//     async validateForType(type, identifier) {
//         const typeConfig = await this.db.get(
//             'SELECT config_schema FROM tracking_types WHERE type_name = ?',
//             [type]
//         );

//         if (!typeConfig) {
//             return {
//                 valid: false,
//                 errors: [`Unknown tracking type: ${type}`]
//             };
//         }

//         // Type-specific validation
//         const validators = {
//             steam: this.validateSteamIdentifier,
//             stock: this.validateStockIdentifier,
//             product: this.validateProductIdentifier,
//             crypto: this.validateCryptoIdentifier
//         };

//         const validatorFn = validators[type] || this.validateGenericIdentifier;
//         return validatorFn(identifier);
//     }

//     validateSteamIdentifier(identifier) {
//         // Steam App IDs are numeric and typically 4-7 digits
//         if (!/^\d+$/.test(identifier)) {
//             return {
//                 valid: false,
//                 errors: ['Steam App ID must be numeric']
//             };
//         }

//         const appId = parseInt(identifier, 10);
//         if (appId < 10 || appId > 9999999) {
//             return {
//                 valid: false,
//                 errors: ['Invalid Steam App ID range']
//             };
//         }

//         return {
//             valid: true,
//             normalized: appId.toString(),
//             metadata: { app_id: appId }
//         };
//     }

//     validateStockIdentifier(identifier) {
//         // Basic stock symbol validation
//         const symbol = identifier.toUpperCase();
        
//         if (!/^[A-Z]{1,5}$/.test(symbol)) {
//             return {
//                 valid: false,
//                 errors: ['Stock symbol must be 1-5 uppercase letters']
//             };
//         }

//         // Blacklist common invalid symbols
//         const blacklist = ['TEST', 'NULL', 'NONE', 'NaN'];
//         if (blacklist.includes(symbol)) {
//             return {
//                 valid: false,
//                 errors: ['Invalid stock symbol']
//             };
//         }

//         return {
//             valid: true,
//             normalized: symbol,
//             metadata: { symbol, exchange: 'NASDAQ' } // Default exchange
//         };
//     }

//     async checkLimits(userId, guildId, type) {
//         // Get type limits
//         const typeLimit = await this.db.get(`
//             SELECT max_items_per_guild 
//             FROM tracking_types 
//             WHERE type_name = ?
//         `, [type]);

//         if (!typeLimit) {
//             return { allowed: false, reason: 'Invalid tracking type' };
//         }

//         // Count current user's items of this type in this guild
//         const userCount = await this.db.get(`
//             SELECT COUNT(*) as count
//             FROM tracked_items
//             WHERE guild_id = ? 
//             AND created_by_user_id = ?
//             AND tracking_type_id = (
//                 SELECT type_id FROM tracking_types WHERE type_name = ?
//             )
//             AND is_active = TRUE
//         `, [guildId, userId, type]);

//         // Count guild's items of this type
//         const guildCount = await this.db.get(`
//             SELECT COUNT(*) as count
//             FROM tracked_items
//             WHERE guild_id = ?
//             AND tracking_type_id = (
//                 SELECT type_id FROM tracking_types WHERE type_name = ?
//             )
//             AND is_active = TRUE
//         `, [guildId, type]);

//         const maxPerUser = 5; // Configurable
//         const maxPerGuild = typeLimit.max_items_per_guild;

//         if (userCount.count >= maxPerUser) {
//             return {
//                 allowed: false,
//                 reason: `You've reached the limit of ${maxPerUser} ${type} trackers per user`
//             };
//         }

//         if (guildCount.count >= maxPerGuild) {
//             return {
//                 allowed: false,
//                 reason: `This server has reached the limit of ${maxPerGuild} ${type} trackers`
//             };
//         }

//         return { allowed: true };
//     }
// }

// module.exports = CommandParser;
