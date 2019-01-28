/*
 * chat.js
 * Copyright (c) 2019, Texx
 * License: MIT
 *     See https://github.com/texxme/Texx/blob/master/LICENSE
 */

// general imports
const $ = require('jquery');
const crypto = require('crypto');
const encryption = require('./encryption');
const wordList = require('./wordlist');
const pinInput = require('./input_pin');
const xkcdPassword = require('xkcd-password');

// setup vars
const host = '127.0.0.1';
let peerId, call, passphrase, connectedPeer;
let connectedPeers = []; // TODO: Save new peers in array

// setup generator
const generator = new xkcdPassword();
generator.initWithWordList(wordList);

/**
 * Sets up encryption, user etc.
 */
(async () => {
    // generate peerId
    if (localStorage.getItem('peer_id') === null) {
        peerId = await generator.generate().then(words => words.join('-'));
        localStorage.setItem('peer_id', peerId);
    } else
        peerId = localStorage.getItem('peer_id');

    encryption.setup();
    await evaluateKeyGeneration();
})();

/**
 * Evaluates whether a key generation is needed and initializes regarding actions
 * @returns {Promise<void>}
 */
async function evaluateKeyGeneration() {
    if (localStorage.getItem('database') === 'success' && await encryption.check()) {
        pinInput.init(async (pin, tryCount) => {
            try {
                if (await encryption.getId(await encryption.getPublic()) !== peerId) throw "Not verified!";
                passphrase = new Buffer(crypto.createHmac('SHA256', pin).update(pin).digest('hex')).toString('base64');
                await encryption.decryptPrivate(await encryption.getPrivate(), passphrase);
                chat()
            } catch (e) { // decrypting failed
                if (tryCount === 3) {
                    encryption.reset();
                    console.error('Too many tries!');
                    pinInput.failure('This account got removed, the site will reload.');
                    setTimeout(() => location.reload(), 1500)
                } else if (e === 'Not verified!') {
                    console.error(e);
                    pinInput.failure(e);
                } else {
                    console.error('Passphrase is wrong!');
                    pinInput.failure('Passphrase is wrong!');
                }
            }
        });
    } else {
        pinInput.init(pin => {
            console.log('[LOG] No existing keys found! Generating...');
            pinInput.generate();
            passphrase = new Buffer(crypto.createHmac('SHA256', pin).update(pin).digest('hex')).toString('base64');
            (async () => await encryption.generate(peerId, passphrase).then(() => chat()))()
        });
    }
}

/**
 * Initializes chat functions
 */
function chat() {
    // hide pin input and display chat
    $('#enter_pin').hide();
    $('#chat').fadeIn();

    // start the peer
    const peer = new Peer(peerId, {host: host, port: 8080, path: '/api', debug: 0});

    // Peer events
    peer.on('open', id => console.log('[LOG] Your ID is', id));
    peer.on('error', err => console.error(err));
    peer.on('call', call => getMediaStream(stream => call.answer(stream))); // TODO: Ask for call accept
    peer.on('connection', async conn => {
        connectedPeer = conn;
        console.log('[LOG] Connected with', connectedPeer.peer);
        encryption.getMsgs(connectedPeer.peer, await encryption.get(connectedPeer.peer), await encryption.getPrivate(), passphrase).then(messages =>
            messages.forEach(data => receivedMessage(`${data.message} - ${data.time}`, true)));
        connectedPeer.on('open', async () => transferKey(await encryption.getPublic()));
        connectedPeer.on('data', async message => {
            console.log('[LOG] Received new message!');
            await receivedMessage(message);
        })
    });

    /**
     * Connects to a peer via his id
     * @param id
     * @returns {Promise<void>}
     */
    async function connect(id) {
        const connectionId = (await generator.generate()).join('-');
        console.log('[LOG] Connecting to', id);
        console.log('[LOG] Your connection ID is', connectionId);
        connectedPeer = peer.connect(id, {label: connectionId, reliable: true});
        console.log('[LOG] Connected with', connectedPeer.peer);
        encryption.getMsgs(connectedPeer.peer, await encryption.get(connectedPeer.peer), await encryption.getPrivate(), passphrase).then(messages =>
            messages.forEach(data => receivedMessage(`${data.message} - ${data.time}`, true)));
        connectedPeer.on('open', async () => transferKey(await encryption.getPublic()));
        connectedPeer.on('data', async message => {
            console.log('[LOG] Received new message!');
            await receivedMessage(message);
        })
    }

    /**
     * Sends a message to the peer with which you're currently connected
     * @param message
     * @returns {Promise<void>}
     */
    async function sendMessage(message) {
        console.log(`[LOG] Sending message '${message}' to ${connectedPeer.peer}`);
        connectedPeer.send({
            type: 'text',
            data: await encryption.encrypt(message, await encryption.get(connectedPeer.peer), await encryption.getPrivate(), passphrase)
        });
        await receivedMessage(message, true);
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
                await encryption.storeMsg(peerId, message.data);
                await encryption.decrypt(message.data, await encryption.get(connectedPeer.peer), await encryption.getPrivate(), passphrase)
                    .then(plaintext => $('#messages').append(`${plaintext}<br>`));
            } else if (message.type === 'key') {
                await encryption.store(connectedPeer.peer, message.data)
            }
        }
    }

    /**
     * Click events
     */
    $(document).ready(() => {
        $('#send_message').on('click', async () => await sendMessage($('#message').val()) & $('#message').val(''));

        // FABs
        $('#add_peer_id').on('click', async () => await connect($('#peer_id').val()));
        $('#logout').on('click', () => location.reload());
        $('#delete').on('click', () => encryption.reset() & location.reload());
        $('#call').on('click', () => getMediaStream(stream => {
            call = peer.call(peerId, stream); // TODO: Encrypt call
            initCall(call)
        }));

        $('[toggle-contact-modal]').on('click', () => $('#add_contact_modal').toggleClass('is-active'))
    });
}

function getMediaStream(callback) {
    navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
    navigator.getUserMedia(
        {audio: true, video: {width: 1280, height: 720}},
        stream => callback(stream),
        err => console.error(err)
    )
}

function initCall(call) {
    call.on('stream', stream => {
        const video = document.querySelector('video');
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
        };
    })
}
