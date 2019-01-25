const sql = require('alasql');
const openpgp = require('openpgp');
openpgp.initWorker({path: 'openpgp.worker.js'});

/**
 * Generates database and tables
 * @returns Boolean
 */
function setupDatabase() {
    return sql('CREATE INDEXEDDB DATABASE IF NOT EXISTS texx; \
        ATTACH INDEXEDDB DATABASE texx; \
        USE texx; \
        CREATE TABLE IF NOT EXISTS own_keys (key_type STRING, key_data STRING); \
        CREATE TABLE IF NOT EXISTS peer_keys (peer_id STRING, key_data STRING); \
        CREATE TABLE IF NOT EXISTS messages (id INT AUTO_INCREMENT, message STRING);', () => {
        localStorage.setItem('database', 'success');
        return true;
    })
}

/**
 * Sets up connection between memory storage and indexeddb
 */
function setupDatabaseConnection() {
    sql.promise('CREATE INDEXEDDB DATABASE IF NOT EXISTS texx; ATTACH INDEXEDDB DATABASE texx; USE texx;')
}

window.test = (() => {
    sql('CREATE INDEXEDDB DATABASE IF NOT EXISTS geo;\
        ATTACH INDEXEDDB DATABASE geo; \
        USE geo; \
        CREATE TABLE IF NOT EXISTS cities (city string, population number); \
        INSERT INTO cities Values ("' + (Math.random() * 100) + '","' + (Math.random() * 100) + '")', function () {

        // Select data from IndexedDB
        sql.promise('SELECT * FROM cities')
            .then(function (res) {
                console.log(res);
            });
    });
});


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

    await openpgp.generateKey(options).then(async (key) => {
        await sql.promise([`INSERT INTO own_keys VALUES ("private_key", "${key.privateKeyArmored}");`,
            `INSERT INTO own_keys VALUES ("public_key", "${key.publicKeyArmored}");`,
            `INSERT INTO own_keys VALUES ("revocation_certificate", "${key.revocationCertificate}");`]).then(() =>
            console.log('[LOG] Successfully generated and stored keys!')
        );
    });
}

/**
 * Gets the peers private key
 * @returns {Promise<String>}
 */
async function getPrivateKey() {
    return await sql.promise('SELECT key_data FROM own_keys WHERE key_type = "private_key" LIMIT 1').then(res => res.length > 0 ? res[0]['key_data'] : '');
}

/**
 * Gets the peers public key
 * @returns {Promise<String>}
 */
async function getPublicKey() {
    return await sql.promise('SELECT key_data FROM own_keys WHERE key_type = "public_key" LIMIT 1').then(res => res.length > 0 ? res[0]['key_data'] : '');
}

/**
 * Gets the peers revocation certificate
 * @returns {Promise<String>}
 */
async function getRevocationCertificate() {
    return await sql.promise('SELECT key_data FROM own_keys WHERE key_type = "revocation_certificate" LIMIT 1').then(res => res.length > 0 ? res[0]['key_data'] : '');
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
async function isEncrypted() {
    const hasPrivateKey = await getPrivateKey().then(res => res !== '');
    const hasPublicKey = await getPublicKey().then(res => res !== '');
    const hasRevocationCertificate = await getRevocationCertificate().then(res => res !== '');
    return (hasPrivateKey && hasPublicKey && hasRevocationCertificate);
}

/**
 * Stores the public key of a peer
 * @param peerId
 * @param key
 */
async function storePeerPublicKey(peerId, key) {
    console.log(peerId);
    console.log(key);
    await sql.promise(`INSERT INTO peer_keys VALUES ("${peerId}", "${key}")`).then(() =>
        console.log('[LOG] Stored public key of ' + peerId)
    );
}

/**
 * Gets the public key of a peer
 * @param peerId
 * @returns {Promise<String>}
 */
async function getPeerPublicKey(peerId) {
    return await sql.promise(`SELECT key_data FROM peer_keys WHERE peer_id = "${peerId}" LIMIT 1`).then(res =>
        res.length > 0 ? res[0]['key_data'] : ''
    );
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
exports.setupConn = setupDatabaseConnection;
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
