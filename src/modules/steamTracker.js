// src/modules/steamTracker.js
const axios = require('axios');
const logger = require('../utils/logger');

class SteamTracker {
    static getType() {
        return 'steam';
    }

    static async fetch(params) {
        const { identifier} = params;
        
        try {
            logger.debug(`Fetching Steam data for app ID: ${identifier}`);
            
            const response = await axios.get(
                `https://store.steampowered.com/api/appdetails`,
                {
                    params: {
                        appids: identifier
                    },
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 10000
                }
            );

            const data = response.data[identifier];
            
            if (!data || !data.success) {
                throw new Error(`Game not found or API error for app ID: ${identifier}`);
            }

            const game = data.data;
            
            // Extract price information
            let price = 'Free';
            let originalPrice = null;
            let discountPercent = 0;
            let currency = 'USD';
            
            if (game.price_overview) {
                price = (game.price_overview.final / 100).toFixed(2);
                originalPrice = (game.price_overview.initial / 100).toFixed(2);
                discountPercent = game.price_overview.discount_percent;
                currency = game.price_overview.currency;
            } else if (game.is_free) {
                price = 0;
            }
            
            return {
                name: game.name,
                price: price,
                originalPrice: originalPrice,
                discountPercent: discountPercent,
                currency: currency,
                isFree: game.is_free || false,
                steamUrl: `https://store.steampowered.com/app/${identifier}`,
                thumbnail: game.header_image,
                success: true,
                fetchedAt: new Date().toISOString(),
                rawData: {
                    metacriticScore: game.metacritic?.score,
                    releaseDate: game.release_date?.date,
                    categories: game.categories?.map(c => c.description) || []
                }
            };
            
        } catch (error) {
            logger.error(`Steam API error for ${identifier}:`, error.message);
            
            // Provide a user-friendly error
            if (error.code === 'ECONNABORTED') {
                throw new Error('Steam API request timeout');
            } else if (error.response?.status === 429) {
                throw new Error('Too many requests to Steam API');
            } else if (error.response?.status === 404) {
                throw new Error('Game not found on Steam');
            } else {
                throw new Error(`Steam API error: ${error.message}`);
            }
        }
    }

    // Simple method to extract app ID from URL
    static extractAppId(input) {
        // Check if input is already a numeric app ID
        if (/^\d+$/.test(input)) {
            return input;
        }

        // Try to extract from URL
        const patterns = [
            /store\.steampowered\.com\/app\/(\d+)/,
            /steamcommunity\.com\/app\/(\d+)/,
            /steam:\/\/rungameid\/(\d+)/
        ];

        for (const pattern of patterns) {
            const match = input.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return null;
    }

    // Validate Steam app ID
    static validateIdentifier(identifier) {
        if (!identifier || !/^\d+$/.test(identifier)) {
            return {
                valid: false,
                error: 'Invalid Steam App ID. Must be numeric.'
            };
        }

        const appId = parseInt(identifier);
        if (appId < 10 || appId > 9999999) {
            return {
                valid: false,
                error: 'Invalid Steam App ID range. Should be between 10 and 9,999,999.'
            };
        }

        return {
            valid: true,
            normalized: identifier,
            metadata: { appId: identifier }
        };
    }
}

module.exports = SteamTracker;