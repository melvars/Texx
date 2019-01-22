const $ = require('jquery');
const nanoid = require('nanoid');

const userId = nanoid();
const peer = new Peer(userId, {host: '127.0.0.1', port: 4242, path: '/', debug: 3});

// Peer events
peer.on('open', id => {
    console.log('[LOG] Your ID is ' + id);
    peer.on('data', data => console.log('[LOG] Received data ' + data));
    peer.on('error', err => console.error(err));
});

function connect(id) {
    console.log('[LOG] Connecting to ' + id);
    const connectionId = nanoid();
    const conn = peer.connect(id, {label: connectionId});
    console.log('[LOG] Your connection ID is ' + connectionId);

    conn.on('open', function () {
        conn.send('hi!');
    });
}

/**
 * Events after load
 */
$(document).ready(() => {
    $('#user_id_form').on('click', e => connect($('#user_id').val()));
});
