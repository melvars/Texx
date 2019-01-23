const $ = require('jquery');
const encryption = require('./2_encryption');
const nanoid = require('nanoid');

let connectedUserId, connectedUser;
const userId = nanoid();

// setup encryption
if (encryption.check()) {
    // TODO: Ask for password
    chat();
} else {
    console.log('[LOG] No existing keys found! Generating...');
    encryption.generate(userId, 'supersecure').then(() => chat());
}

function chat() {
    const peer = new Peer(userId, {host: '127.0.0.1', port: 4242, path: '/', debug: 3});

    // Peer events
    peer.on('open', id => console.log('[LOG] Your ID is', id));
    peer.on('error', err => console.error(err));
    peer.on('connection', conn => {
        connectedUser = conn;
        console.log('[LOG] Connected with', conn.peer);
        conn.on('data', message => receivedMessage(message));
    });

    /**
     * Connects to an user via his id
     * @param id
     */
    function connect(id) {
        const connectionId = nanoid();
        console.log('[LOG] Connecting to', id);
        console.log('[LOG] Your connection ID is', connectionId);
        connectedUser = peer.connect(id, {label: connectionId, reliable: true});
        connectedUserId = id;

        // setup listener
        connectedUser.on('open', () => {
            // TODO: Activate chat or sth
            // TODO: Send public key
        });

        connectedUser.on('data', message => receivedMessage(message))
    }

    /**
     * Sends a message to the user with which you're currently connected
     * @param message
     */
    function sendMessage(message) {
        console.log(`[LOG] Sending message ${message} to ${connectedUserId}`);
        connectedUser.send(message);
        receivedMessage(message, true);
    }

    /**
     * Renders the incoming messages
     * @param message
     * @param self
     */
    function receivedMessage(message, self = false) {
        if (self) {
            $('#messages').append(`<span style="color: green">${message}</span><br>`);
        } else {
            $('#messages').append(`${message}<br>`);
        }
    }

    /**
     * Events after load
     */
    $(document).ready(() => {
        $('#add_user_id').on('click', () => connect($('#user_id').val()));
        $('#send_message').on('click', () => sendMessage($('#message').val()));

        $('[toggle-contact-modal]').on('click', () => $('#add_contact_modal').toggleClass('is-active'))
    });
}

//encryption.test(); // TESTING IF ENCRYPTION WORKS
