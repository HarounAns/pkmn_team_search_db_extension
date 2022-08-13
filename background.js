const API_URL = 'https://e92t7zlra4.execute-api.us-east-1.amazonaws.com/dev/teams';

const logIncomingWebSocketMessage = arg => {
    console.log(`%c < ${arg}`, 'background: #000; color: #800080');
}

const getCurrentTab = async () => {
    const queryOptions = { active: true, lastFocusedWindow: true };
    // `tab` will either be a `tabs.Tab` instance or `undefined`.
    const [tab] = await chrome.tabs.query(queryOptions);
    return tab;
}

const parseMessages = async (messages, showdownUsername) => {
    // console.log(messages);

    // determine if opponent is p1 or p2
    const amIPlayer1 = messages.find(msg => msg.toLowerCase().startsWith(`player|p1|${showdownUsername.toLowerCase()}`));
    const opponentPlayer = amIPlayer1 ? 'p2' : 'p1';

    const opponentPokemon = messages.filter(msg => msg.startsWith(`poke|${opponentPlayer}|`))
        .map(msg => msg.split(`poke|${opponentPlayer}|`)[1]
            .split(',')[0]
            .split('|')[0]
        );

    if (!opponentPokemon.length) return;
    console.info('opponentPokemon', opponentPokemon);

    const teams = await getTeamsForPokemon(opponentPokemon);
    if (!teams.length) {
        console.info('No teams matching opponents Pokemon');
        return;
    }

    console.info('Found the following team(s):');
    for (const { pokepasteUrl } of teams) {
        console.info(` - ${pokepasteUrl}`);
    }
}

const getTeamsForPokemon = async (pokemon) => {
    // need to handle urshifu edge case where you don't know which type it is - we will always search for rapid strike since the other is banned
    pokemon = pokemon.map(p => p.toLowerCase() === 'urshifu-*' ? 'urshifu-rapid-strike' : p);
    const res = await fetch(`${API_URL}?pokemon=${encodeURIComponent(JSON.stringify(pokemon))}`);
    const { teams } = await res.json();
    return teams;
}

const getShowdownUserNameFromCookie = () => {
    return new Promise((resolve, reject) => {
        chrome.cookies.get({
            url: 'https://play.pokemonshowdown.com',
            name: 'showdown_username'
        },
            function (cookie) {
                if (cookie) {
                    resolve(cookie.value)
                }
                else {
                    console.error('Can\'t get cookie!')
                    reject(0);
                }
            })
    });
}

let battleId;
chrome.tabs.onUpdated.addListener(async () => {
    let url;
    try {
        const tab = await getCurrentTab();
        url = tab.url;
        if (!url) return;
    } catch (error) {
        console.error('Could not get active tab url');
        return;
    }

    const battleUrlPrefix = 'https://play.pokemonshowdown.com/battle-'
    if (!url.startsWith(battleUrlPrefix))
        return;

    const _battleId = url.split(battleUrlPrefix)[1];

    if (battleId === _battleId) return;
    battleId = _battleId;
    console.info(url);

    // can't connect to private room, short circuit
    if (battleId.includes('-')) {
        console.error('Cant connect to private room', battleId);
    }

    const showdownUsername = await getShowdownUserNameFromCookie();

    const wsURL = 'wss://sim3.psim.us/showdown/123/12345678/websocket';

    const battleRoom = `battle-${battleId}`;
    console.info('Connecting to Socket with for battle room ', battleRoom);
    const socket = new WebSocket(wsURL);

    socket.onopen = function (e) {
        console.info("[open] Connection established");
        socket.send(`["|/join ${battleRoom}"]`);
    };

    socket.onmessage = function ({ data }) {
        logIncomingWebSocketMessage(data);

        if (data.startsWith(`a[">${battleRoom}`)) {
            const messages = data.split('\\n|');
            parseMessages(messages, showdownUsername);
        }
    };

    socket.onclose = function (event) {
        if (event.wasClean) {
            console.info(`[close] Connection closed cleanly, code=${event.code} reason=${event.reason}`);
        } else {
            // e.g. server process killed or network down
            // event.code is usually 1006 in this case
            console.error('[close] Connection died');
        }
    };

    socket.onerror = function (error) {
        console.error(`[error] ${error.message}`);
    };
});