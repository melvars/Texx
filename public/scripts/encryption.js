const Dexie = require('dexie');
const openpgp = require('openpgp');

let db;

/**
 * Generates database and tables
 * @returns Boolean
 */
function setupDatabase() {
    db = new Dexie('texx');
    db.version(2).stores({
        own_keys: '&key_type, key_data',
        peer_keys: 'peer_id, key_data',
        messages: 'peer_id, message'
    });

    localStorage.setItem('database', 'success');

    db.open().catch(e => {
        localStorage.setItem('database', 'failed');
        console.error("Database failed: " + e.stack);
    });

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

    await openpgp.generateKey(options).then(async (key) => {
        await db.own_keys.put({key_type: 'private_key', key_data: key.privateKeyArmored});
        await db.own_keys.put({key_type: 'public_key', key_data: key.publicKeyArmored});
        await db.own_keys.put({key_type: 'revocation_certificate', key_data: key.revocationCertificate}).then(() =>
            console.log('[LOG] Successfully generated and stored keys!')
        );
    });
}

/**
 * Gets the peers private key
 * @returns {Promise<String>}
 */
async function getPrivateKey() {
    return await db.own_keys.where('key_type').equals('private_key').limit(1).toArray()
        .then(res => res.length > 0 ? res[0]['key_data'] : '');
}

/**
 * Gets the peers public key
 * @returns {Promise<String>}
 */
async function getPublicKey() {
    return await db.own_keys.where('key_type').equals('public_key').limit(1).toArray()
        .then(res => res.length > 0 ? res[0]['key_data'] : '');
}

/**
 * Gets the peers revocation certificate
 * @returns {Promise<String>}
 */
async function getRevocationCertificate() {
    return await db.own_keys.where('key_type').equals('public_key').limit(1).toArray()
        .then(res => res.length > 0 ? res[0]['key_data'] : '');
}

/**
 * /**
 * Encrypts the data with a public key (e.g the one of the peer with which you're chatting)
 * @param data
 * @param publicKey
 * @returns {Promise<String>}
 */
async function encrypt(data, publicKey) {
    //const privateKeyObj = (await openpgp.key.readArmored(privateKey)).keys[0];
    //await privateKeyObj.decrypt(passphrase);

    const options = {
        message: openpgp.message.fromText(data),
        publicKeys: (await openpgp.key.readArmored(publicKey)).keys,
        //privateKeys: [privateKeyObj] // TODO: Use private key for signing
    };

    return await openpgp.encrypt(options).then(ciphertext => ciphertext.data);
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
    const privateKeyObj = await decryptPrivateKey(privateKey, passphrase);

    const options = {
        message: await openpgp.message.readArmored(data),
        publicKeys: (await openpgp.key.readArmored(publicKey)).keys, // for verification
        privateKeys: [privateKeyObj]
    };

    return await openpgp.decrypt(options).then(plaintext => plaintext.data);
}

/**
 * Decrypts the private key
 * @param privateKey
 * @param passphrase
 * @returns {Promise<module:key.Key>}
 */
async function decryptPrivateKey(privateKey, passphrase) {
    const privateKeyObj = (await openpgp.key.readArmored(privateKey)).keys[0];
    await privateKeyObj.decrypt(passphrase);
    return privateKeyObj;
}

/**
 * Checks whether the peer has keys
 * @returns {boolean}
 */
async function isEncrypted() {
    return await Dexie.exists('texx').then(async (exists) => {
        if (exists) {
            const hasPrivateKey = await getPrivateKey().then(res => res !== '');
            const hasPublicKey = await getPublicKey().then(res => res !== '');
            const hasRevocationCertificate = await getRevocationCertificate().then(res => res !== '');
            return (hasPrivateKey && hasPublicKey && hasRevocationCertificate);
        } else
            return false;
    });
}

/**
 * Stores the public key of a peer
 * @param peerId
 * @param key
 */
async function storePeerPublicKey(peerId, key) {
    await db.peer_keys.put({peer_id: peerId, key_data: key}).then(() =>
        console.log('[LOG] Stored public key of ' + peerId)
    );
}

/**
 * Gets and verifies the public key of a peer
 * @param peerId
 * @returns {Promise<String>}
 */
async function getPeerPublicKey(peerId) {
    return await db.peer_keys.where('peer_id').equals(peerId).limit(1).toArray().then(async res => {
        let publicKey;
        if (res.length > 0) {
            publicKey = res[0]['key_data'];
            const publicKeyUserId = (await (await openpgp.key.readArmored(publicKey)).keys[0].getPrimaryUser()
                .then(obj => obj.user.userId.userid));
            if (publicKeyUserId !== peerId) {
                publicKey = '';
                console.error('[LOG] Public key verification failed! The peers real identity is ' + publicKeyUserId)
            } else
                console.log('[LOG] Public key verification succeeded!')
        } else
            publicKey = '';
        return publicKey;
    });
}

/**
 * Resets the database/encryption
 */
function reset() {
    db.delete();
    localStorage.removeItem('database');
    console.log('[LOG] Database has been deleted!')
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
exports.decryptPrivate = decryptPrivateKey;
exports.check = isEncrypted;
exports.store = storePeerPublicKey;
exports.get = getPeerPublicKey;
exports.reset = reset;
exports.test = testEncryption;
