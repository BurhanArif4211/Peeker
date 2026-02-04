const { Client, GatewayIntentBits, REST, Routes } = require("discord.js")
let ONI_SECRET_TOKEN = process.env.ONI_SECRET_TOKEN
let ONI_APP_ID = process.env.ONI_APP_ID

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent // Required to read message content
    ]
});

const commands = [
    {
        name: 'track',
        description: 'Track game price',
        options: [{
            name: 'url',
            description: 'Game url to check',
            type: 3, // STRING type
            required: true
        }]
    }
];

// Register slash commands
const rest = new REST({ version: '10' }).setToken(ONI_SECRET_TOKEN);

(async () => {
    try {
        await rest.put(
            Routes.applicationCommands(ONI_APP_ID),
            { body: commands }
        );
    } catch (error) {
        console.error(error);
    }
})();

client.once("clientReady", function () {
    console.log(`Logged in as ${client.user}!`);
})

client.on("interactionCreate", async interaction => {
    // / means an interaction 
    if (!interaction.isCommand()) {
        return;
    }
    //commands
    if (interaction.commandName == "track") {

        let gameInfo = await getSteamInfo(interaction.options.getString('url'));
        await interaction.reply(JSON.stringify(gameInfo));
    }

})

client.login(ONI_SECRET_TOKEN);


async function getSteamInfo(url) {
    // https://store.steampowered.com/api/appdetails?appids=  
    /** We will fetch the game info in form of json and return the price to the caller */

    const gameId = url.split("/")[4] //'s magic

    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${gameId}`)
    let jsonData = await response.json()

    // console.log(jsonData[gameId])

    const data = jsonData[gameId];

        if (data) {
            return {
                name: data.data.name,
                price: data.data.price_overview?.final_formatted || 'Free',
                discount: data.data.price_overview?.discount_percent || 0
            };
        }

}
