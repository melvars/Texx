const $ = require('jquery');
const nanoid = require('nanoid');

let connectedUserId, connectedUser;
const userId = nanoid();
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
        $('#messages').append(`<span style="color: green">${message}</span><hr>`);
    } else {
        $('#user_id').val(connectedUserId); // TODO: WTH DOESNT THIS WORK LOL
        $('#messages').append(`${message}<hr>`);
    }
}

/**
 * Events after load
 */
$(document).ready(() => {
    $('#user_id_form').on('click', () => connect($('#user_id').val()));
    $('#message_form').on('click', () => sendMessage($('#message').val()));
});
