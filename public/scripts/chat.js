const $ = require('jquery');
const encryption = require('./2_encryption');
const generate = require('nanoid/generate');
const nolookalikes = require('nanoid-dictionary/nolookalikes');

let connectedPeers = []; // TODO: Save new peers in array
let connectedPeer;
const peerId = generate(nolookalikes, 16);
const host = '127.0.0.1';

// setup encryption
(async () => {
    encryption.setup();
    if (localStorage.getItem('database') === 'success' && await encryption.check()) {
        // TODO: Ask for passphrase
        chat();
    } else {
        console.log('[LOG] No existing keys found! Generating...');
        (async () => await encryption.generate(peerId, 'supersecure').then(() => chat()))()
    }
})();

function chat() {
    const peer = new Peer(peerId, {host: host, port: 8080, path: '/api', debug: 0});

    // Peer events
    peer.on('open', id => console.log('[LOG] Your ID is', id));
    peer.on('error', err => console.error(err));
    peer.on('connection', conn => {
        connectedPeer = conn;
        console.log('[LOG] Connected with', connectedPeer.peer);
        connectedPeer.on('open', async () => await encryption.getPublic().then(res => transferKey(res)));
        connectedPeer.on('data', async message => await receivedMessage(message));
    });

    /**
     * Connects to a peer via his id
     * @param id
     */
    function connect(id) {
        const connectionId = generate(nolookalikes, 16);
        console.log('[LOG] Connecting to', id);
        console.log('[LOG] Your connection ID is', connectionId);
        connectedPeer = peer.connect(id, {label: connectionId, reliable: true});
        console.log('[LOG] Connected with', connectedPeer.peer);
        connectedPeer.on('open', async () => await encryption.getPublic().then(res => transferKey(res)));
        connectedPeer.on('data', async message => await receivedMessage(message))
    }

    /**
     * Sends a message to the peer with which you're currently connected
     * @param message
     * @returns {Promise<void>}
     */
    async function sendMessage(message) {
        console.log(`[LOG] Sending message ${message} to ${connectedPeer.peer}`);
        await encryption.get(connectedPeer.peer).then(async peerKey => {
            await encryption.encrypt(message, peerKey).then(async encrypted => {
                connectedPeer.send({type: 'text', data: encrypted});
                await receivedMessage(message, true);
            })
        })
    }

    /**
     * Transfers the (public) key to the currently connected peer
     * @param key
     */
    function transferKey(key) {
        console.log(`[LOG] Transferring key to ${connectedPeer.peer}`);
        connectedPeer.send({type: 'key', data: key});
    }

    /**
     * Renders and processes the incoming messages
     * @param message
     * @param self
     */
    async function receivedMessage(message, self = false) {
        if (self) {
            $('#messages').append(`<span style="color: green">${message}</span><br>`);
        } else {
            if (message.type === 'text') {
                // TODO: Cleanup async method calls
                await encryption.get(connectedPeer.peer).then(async peerKey => {
                    await encryption.getPrivate().then(async privateKey => {
                        await encryption.decrypt(message.data, peerKey, privateKey, 'supersecure')
                            .then(plaintext => $('#messages').append(`${plaintext}<br>`));
                    })
                })
            } else if (message.type === 'key') {
                await encryption.store(connectedPeer.peer, message.data)
            }
        }
    }

    /**
     * Events after load
     */
    $(document).ready(() => {
        $('#add_peer_id').on('click', () => connect($('#peer_id').val()));
        $('#send_message').on('click', async () => await sendMessage($('#message').val()));

        $('[toggle-contact-modal]').on('click', () => $('#add_contact_modal').toggleClass('is-active'))
    });
}

//encryption.test(); // TESTING IF ENCRYPTION WORKS
