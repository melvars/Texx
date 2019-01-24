const $ = require('jquery');
const encryption = require('./2_encryption');
const nanoid = require('nanoid');

let connectedPeers = []; // TODO: Save new peers in array
let connectedPeer;
const peerId = nanoid();

// setup encryption
if (encryption.setup() && encryption.check()) {
    // TODO: Ask for password
    chat();
} else {
    console.log('[LOG] No existing keys found! Generating...');
    encryption.generate(peerId, 'supersecure').then(() => chat());
}

function chat() {
    const peer = new Peer(peerId, {host: '127.0.0.1', port: 4242, path: '/', debug: 0});

    // Peer events
    peer.on('open', id => console.log('[LOG] Your ID is', id));
    peer.on('error', err => console.error(err));
    peer.on('connection', conn => {
        connectedPeer = conn;
        console.log('[LOG] Connected with', conn.peer);
        conn.on('data', message => receivedMessage(message));
    });

    /**
     * Connects to a peer via his id
     * @param id
     */
    function connect(id) {
        const connectionId = nanoid();
        console.log('[LOG] Connecting to', id);
        console.log('[LOG] Your connection ID is', connectionId);
        connectedPeer = peer.connect(id, {label: connectionId, reliable: true});

        // setup listener
        connectedPeer.on('open', () => {
            // TODO: Activate chat or sth
            transferKey(encryption.getPublic());
        });

        connectedPeer.on('data', message => receivedMessage(message))
    }

    /**
     * Sends a message to the peer with which you're currently connected
     * @param message
     */
    function sendMessage(message) {
        console.log(`[LOG] Sending message ${message} to ${connectedPeer.peer}`);
        connectedPeer.send({type: 'text', data: message});
        receivedMessage(message, true);
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
    function receivedMessage(message, self = false) {
        if (self) {
            $('#messages').append(`<span style="color: green">${message}</span><br>`);
        } else {
            if (message.type === 'text')
                $('#messages').append(`${message.data}<br>`);
            else if (message.type === 'key') {
                console.log(connectedPeer.peer);
                console.log(peer.connections);
                encryption.store(connectedPeer.peer, message.data)
            }
        }
    }

    /**
     * Events after load
     */
    $(document).ready(() => {
        $('#add_peer_id').on('click', () => connect($('#peer_id').val()));
        $('#send_message').on('click', () => sendMessage($('#message').val()));

        $('[toggle-contact-modal]').on('click', () => $('#add_contact_modal').toggleClass('is-active'))
    });
}

//encryption.test(); // TESTING IF ENCRYPTION WORKS
