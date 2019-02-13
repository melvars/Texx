/*
 * encryption.js
 * Copyright (c) 2019, Texx
 * License: MIT
 *     See https://github.com/texxme/Texx/blob/master/LICENSE
 */

const Dexie = require('dexie');
const moment = require('moment');
const crypto = require('crypto');
const jsSHA = require("jssha");
const fingerprint = require('fingerprintjs2');
const openpgp = require('openpgp');
const swal = require('sweetalert');

let db;

// compress encryption data
openpgp.config.compression = openpgp.enums.compression.zlib;

/**
 * Generates database and tables
 * @returns Boolean
 */
function setupDatabase() {
    db = new Dexie('texx');
    db.version(2).stores({
        own_keys: '&key_type, key_data',
        peer_keys: 'peer_id, key_data',
        messages: '++id, peer_id, message, time'
    });

    localStorage.setItem('database', 'success');

    db.open().catch(e => {
        localStorage.setItem('database', 'failed');
        console.error("Database failed: " + e.stack);
        swal('Could not create the local database!', 'Please try loading this site from a different browser', 'error');
    });

    return true;
}

/**
 * Generates and stores encrypted private key, public key and a revocation certificate
 * @param peerId
 * @param fingerprint
 * @returns {Promise<void>}
 */
async function generateKeys(peerId, fingerprint) {
    const options = {
        userIds: [{name: peerId, comment: fingerprint}],
        curve: 'ed25519',
        passphrase: fingerprint
    };

    openpgp.generateKey(options).then(async (key) => {
        await db.own_keys.put({key_type: 'private_key', key_data: key.privateKeyArmored});
        db.own_keys.put({key_type: 'public_key', key_data: key.publicKeyArmored}).then(() =>
            console.log('[LOG] Successfully generated and stored keys!')
        );
    });
}

/**
 * /**
 * Gets the peers private key
 * @returns {Dexie.Promise<Dexie.Promise<string>>}
 */
async function getPrivateKey() {
    return db.own_keys.where('key_type').equals('private_key').limit(1).toArray()
        .then(res => res.length > 0 ? res[0]['key_data'] : '');
}

/**
 * Gets the peers public key
 * @returns {Dexie.Promise<Dexie.Promise<string>>}
 */
async function getPublicKey() {
    return db.own_keys.where('key_type').equals('public_key').limit(1).toArray()
        .then(res => res.length > 0 ? res[0]['key_data'] : '');
}

/**
 * /**
 * Encrypts the data with a public key (e.g the one of the peer with which you're chatting)
 * @param data
 * @param publicKey
 * @param privateKey
 * @param fingerprint
 * @returns {Promise<String>}
 */
async function encrypt(data, publicKey, privateKey, fingerprint) {
    const privateKeyObj = await decryptPrivateKey(privateKey, fingerprint);

    const options = {
        message: openpgp.message.fromText(data),
        publicKeys: (await openpgp.key.readArmored(publicKey)).keys,
        privateKeys: [privateKeyObj] // for signing
    };

    return openpgp.encrypt(options).then(ciphertext => ciphertext.data);
}

/**
 * Decrypts encrypted data with own encrypted private key and verifies the data with the public key
 * @param data
 * @param publicKey
 * @param privateKey
 * @param fingerprint
 * @returns {Promise<String>}
 */
async function decrypt(data, publicKey, privateKey, fingerprint) {
    const privateKeyObj = await decryptPrivateKey(privateKey, fingerprint);

    const options = {
        message: await openpgp.message.readArmored(data),
        publicKeys: (await openpgp.key.readArmored(publicKey)).keys, // for verification
        privateKeys: [privateKeyObj]
    };

    return openpgp.decrypt(options).then(plaintext => plaintext.data);
}

/**
 * Decrypts the private key
 * @param privateKey
 * @param fingerprint
 * @returns {Promise<module:key.Key>}
 */
async function decryptPrivateKey(privateKey, fingerprint) {
    const privateKeyObj = (await openpgp.key.readArmored(privateKey)).keys[0];
    await privateKeyObj.decrypt(fingerprint);
    return privateKeyObj;
}

/**
 * Checks whether the peer has keys
 * @returns {boolean}
 */
async function isEncrypted() {
    return Dexie.exists('texx').then(async (exists) => {
        if (exists) {
            const hasPrivateKey = getPrivateKey().then(res => res !== '');
            const hasPublicKey = getPublicKey().then(res => res !== '');
            return (hasPrivateKey && hasPublicKey);
        } else
            return false;
    });
}

/**
 * Encrypts a message
 * @param message
 * @param fingerprint
 * @returns {string}
 */
function encryptMessage(message, fingerprint) {
    const cipher = crypto.createCipher('aes-256-ctr', fingerprint);
    const plaintext = cipher.update(message, 'utf8', 'hex');
    console.log('[LOG] Encrypted message successfully!');
    return plaintext + cipher.final('hex');
}

/**
 * Decrypts a message
 * @param message
 * @param fingerprint
 * @returns {string}
 */
function decryptMessage(message, fingerprint) {
    const cipher = crypto.createCipher('aes-256-ctr', fingerprint);
    const plaintext = cipher.update(message, 'hex', 'utf8');
    console.log('[LOG] Decrypted message successfully!');
    return plaintext + cipher.final('utf8');
}

/**
 * Stores a message // TODO: Store and get own messages too
 * @param peerId
 * @param message
 * @param fingerprint
 */
async function storeMessage(peerId, message, fingerprint) {
    db.messages.put({peer_id: peerId, message: encryptMessage(message, fingerprint), time: new Date()}).then(() =>
        console.log('[LOG] Stored message of ' + peerId)
    );
}

/**
 * Gets the messages
 * @param peerId
 * @param publicKey
 * @param privateKey
 * @param fingerprint
 * @returns {Promise<Array>}
 */
async function getMessages(peerId, publicKey, privateKey, fingerprint) {
    console.log('[LOG] Getting messages...');
    try {
        const messages = await db.messages.where('peer_id').equals(peerId).sortBy('id');
        let messageArray = [];
        for (let i = messages.length; i--;) {
            await messageArray.push({
                message: await decrypt(decryptMessage(messages[i]['message'], fingerprint), publicKey, privateKey, fingerprint),
                time: moment(messages[i]['time']).fromNow()
            })
        }
        return messageArray;
    } catch (e) {
        console.log('[LOG] No messages found!');
        return [];
    }
}

/**
 * Stores the public key of a peer
 * @param peerId
 * @param key
 */
async function storePeerPublicKey(peerId, key) {
    db.peer_keys.put({peer_id: peerId, key_data: key}).then(() =>
        console.log('[LOG] Stored public key of ' + peerId)
    );
}

/**
 * Gets and verifies the public key of a peer
 * @param peerId
 * @returns {Dexie.Promise<Dexie.Promise<string>>}
 */
async function getPeerPublicKey(peerId) {
    return db.peer_keys.where('peer_id').equals(peerId).limit(1).toArray().then(async res => {
        let publicKey;
        if (res.length > 0) {
            publicKey = res[0]['key_data'];
            const publicKeyPeerId = await getPublicKeyPeerId(publicKey);
            if (publicKeyPeerId !== peerId) {
                publicKey = '';
                console.error('[LOG] Public key verification failed! The peers real identity is ' + publicKeyPeerId);
                swal('There\'s something strange going on here!', 'The peers ID could not be verified! His real ID is ' + publicKeyPeerId, 'error');
            } else
                console.log('[LOG] Public key verification succeeded!')
        } else
            publicKey = '';
        return publicKey;
    });
}

/**
 * Returns peer id of a public key
 * @param publicKey
 * @returns {Promise<String>}
 */
async function getPublicKeyPeerId(publicKey) {
    return (await openpgp.key.readArmored(publicKey)).keys[0].getPrimaryUser().then(obj => obj.user.userId.userid.replace(/ \((.+?)\)/g, "")) || '';
}

/**
 * Gets the unique fingerprint of the peer, generated using every data javascript can get from the browser
 * and the hashed passphrase of the peer
 * @param passphrase
 * @returns {Promise<String>}
 */
function generateFingerprint(passphrase) {
    return fingerprint.getPromise().then(components => {
        const fingerprintHash = fingerprint.x64hash128(components.map(pair => pair.value).join(), 31);
        let shaObj = new jsSHA('SHA3-512', 'TEXT');
        shaObj.update(passphrase);
        const passphraseHash = shaObj.getHash('HEX');
        shaObj = new jsSHA('SHA3-512', 'TEXT');
        shaObj.update(passphraseHash);
        shaObj.update(fingerprintHash);
        return shaObj.getHash('HEX');
    })
}

/**
 * Returns fingerprint of a public key
 * @param publicKey
 * @returns {Promise<String>}
 */
async function getPublicKeyFingerprint(publicKey) {
    return (await openpgp.key.readArmored(publicKey)).keys[0].getPrimaryUser().then(obj => obj.user.userId.userid.match(/\((.*)\)/)[1]) || '';
}

/**
 * Resets the database/encryption
 */
function reset() {
    db.delete();
    localStorage.removeItem('database');
    localStorage.removeItem('peer_id');
    console.log('[LOG] Database has been deleted!')
}

exports.setup = setupDatabase;
exports.generate = generateKeys;
exports.getPrivate = getPrivateKey;
exports.getPublic = getPublicKey;
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.decryptPrivate = decryptPrivateKey;
exports.check = isEncrypted;
exports.storeMsg = storeMessage;
exports.getMsgs = getMessages;
exports.store = storePeerPublicKey;
exports.get = getPeerPublicKey;
exports.getId = getPublicKeyPeerId;
exports.generateFingerprint = generateFingerprint;
exports.getFingerprint = getPublicKeyFingerprint;
exports.reset = reset;
