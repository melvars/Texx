const $ = require('jquery');
const util = require('util');
const nanoid = require('nanoid');

let connectedUserId, connectedUser;
const userId = nanoid();
const peer = new Peer(userId, {host: '127.0.0.1', port: 4242, path: '/', debug: 3});

// Peer events
peer.on('open', id => console.log('[LOG] Your ID is', id));
peer.on('connection', conn => console.log('[LOG] Connected with', conn.peer));
peer.on('error', err => console.error(err));

function connect(id) {
    const connectionId = nanoid();
    console.log('[LOG] Connecting to', id);
    console.log('[LOG] Your connection ID is', connectionId);
    connectedUser = peer.connect(id, {label: connectionId, reliable: true});
    connectedUserId = id;

    // setup listener
    connectedUser.on('open', () => {
        connectedUser.send('Hi!');
        // TODO: Activate chat or sth
    });

    connectedUser.on('data', data => console.log('[LOG] Received data', data));
}

function sendMessage(message) {
    console.log(`[LOG] Sending message ${message} to ${connectedUserId}`);
    connectedUser.send(message);
}

/**
 * Events after load
 */
$(document).ready(() => {
    $('#user_id_form').on('click', () => connect($('#user_id').val()));
    $('#message_form').on('click', () => sendMessage($('#message').val()));
});
