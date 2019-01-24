const sql = require('alasql');
const openpgp = require('openpgp');
openpgp.initWorker({path: 'openpgp.worker.js'});

/**
 * Generated localstorage database and tables
 * @returns {boolean}
 */
function setupDatabase() {
    sql('CREATE localStorage DATABASE IF NOT EXISTS texx_ls');
    sql('ATTACH localStorage DATABASE texx_ls AS db');
    sql('SET AUTOCOMMIT ON');
    sql('CREATE TABLE IF NOT EXISTS db.own_keys (key_type STRING, key_data STRING)');
    sql('CREATE TABLE IF NOT EXISTS db.peer_keys (peer_id STRING, key_data STRING)');
    sql('CREATE TABLE IF NOT EXISTS db.messages (id INT AUTO_INCREMENT, message STRING)');
    return true;
}

/**
 * Generates and stores encrypted private key, public key and a revocation certificate
 * @param peerId
 * @param passphrase
 * @returns {Promise<void>}
 */
async function generateKeys(peerId, passphrase) {
    const options = {
        userIds: [{name: peerId}],
        numBits: 4096,
        passphrase: passphrase
    };

    await openpgp.generateKey(options).then((key) => {
        sql(`INSERT INTO db.own_keys VALUES ("private_key", "${key.privateKeyArmored}")`);
        sql(`INSERT INTO db.own_keys VALUES ("public_key", "${key.publicKeyArmored}")`);
        sql(`INSERT INTO db.own_keys VALUES ("revocation_certificate", "${key.revocationCertificate}")`);
        console.log('[LOG] Successfully generated and stored keys!');
    });
}

/**
 * Gets the peers private key
 * @returns {string}
 */
function getPrivateKey() {
    const privateKey = sql('SELECT key_data FROM db.own_keys WHERE key_type = "private_key" LIMIT 1');
    return privateKey.length > 0 ? privateKey[0]['key_data'] : '';
}

/**
 * Gets the peers public key
 * @returns {string}
 */
function getPublicKey() {
    const publicKey = sql('SELECT key_data FROM db.own_keys WHERE key_type = "public_key" LIMIT 1');
    return publicKey.length > 0 ? publicKey[0]['key_data'] : '';
}

/**
 * Gets the peers revocation certificate
 * @returns {string}
 */
function getRevocationCertificate() {
    const revocationCertificate = sql('SELECT key_data FROM db.own_keys WHERE key_type = "revocation_certificate" LIMIT 1');
    return revocationCertificate.length > 0 ? revocationCertificate[0]['key_data'] : '';
}

/**
 * /**
 * Encrypts the data with a public key (e.g the one of the peer with which you're chatting)
 * @param data
 * @param publicKey
 * @returns {Promise<String>}
 */
async function encrypt(data, publicKey) {
    console.log(publicKey);
    //const privateKeyObj = (await openpgp.key.readArmored(privateKey)).keys[0];
    //await privateKeyObj.decrypt(passphrase);

    const options = {
        message: openpgp.message.fromText(data),
        publicKeys: (await openpgp.key.readArmored(publicKey)).keys,
        //privateKeys: [privateKeyObj] // TODO: Use private key for signing
    };

    return await openpgp.encrypt(options).then(ciphertext => {
        console.log(ciphertext.data);
        return ciphertext.data;
    });
}

/**
 * Decrypts encrypted data with own encrypted private key and verifies the data with the public key
 * @param data
 * @param publicKey
 * @param privateKey
 * @param passphrase
 * @returns {Promise<String>}
 */
async function decrypt(data, publicKey, privateKey, passphrase) {
    const privateKeyObj = (await openpgp.key.readArmored(privateKey)).keys[0];
    await privateKeyObj.decrypt(passphrase);

    const options = {
        message: await openpgp.message.readArmored(data),
        publicKeys: (await openpgp.key.readArmored(publicKey)).keys, // for verification
        privateKeys: [privateKeyObj]
    };

    return await openpgp.decrypt(options).then(plaintext => plaintext.data)
}

/**
 * Checks whether the peer has keys
 * @returns {boolean}
 */
function isEncrypted() {
    const hasPrivateKey = getPrivateKey() !== '';
    const hasPublicKey = getPublicKey() !== '';
    const hasRevocationCertificate = getRevocationCertificate() !== '';
    return (hasPrivateKey && hasPublicKey && hasRevocationCertificate);
}

/**
 * Stores the public key of a peer
 * @param peerId
 * @param key
 */
function storePeerPublicKey(peerId, key) {
    console.log(peerId);
    console.log(key);
    sql(`INSERT INTO db.peer_keys VALUES ("${peerId}", "${key}")`);
    console.log('[LOG] Stored public key of ' + peerId);
}

/**
 * Gets the public key of a peer
 * @param peerId
 */
function getPeerPublicKey(peerId) {
    const publicKey = sql(`SELECT key_data FROM db.peer_keys WHERE peer_id = "${peerId}" LIMIT 1`);
    return publicKey.length > 0 ? publicKey[0]['key_data'] : '';
}

/**
 * Just a general test case
 */
function testEncryption() {
    generateKeys('test_id', 'supersecure').then(() => {
        encrypt('The meaning of life', getPublicKey()).then(encrypted => {
            decrypt(encrypted, getPublicKey(), getPrivateKey(), 'supersecure').then(decrypted => {
                if (decrypted === 'The meaning of life')
                    console.log("YEEHA, Test succeeded!")
            })
        })
    })
}

exports.setup = setupDatabase;
exports.generate = generateKeys;
exports.getPrivate = getPrivateKey;
exports.getPublic = getPublicKey;
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.check = isEncrypted;
exports.store = storePeerPublicKey;
exports.get = getPeerPublicKey;
exports.test = testEncryption;

window.sql = sql; // For debugging
