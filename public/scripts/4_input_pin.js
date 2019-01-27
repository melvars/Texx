const $ = require('jquery');
let pin = [];

/**
 * Initializes actions of the pin input field
 * @param callback
 */
function init(callback) {
    $('#1').focus().on('input', (el) => {
        pin.push($(el.target).val());
        $(el.target).val('*');
        $('#' + (parseInt($(el.target).attr('id')) + 1).toString()).focus();
    });

    $('#2').on('input', (el) => {
        pin.push($(el.target).val());
        $(el.target).val('*');
        $('#' + (parseInt($(el.target).attr('id')) + 1).toString()).focus();
    });

    $('#3').on('input', (el) => {
        pin.push($(el.target).val());
        $(el.target).val('*');
        $('#' + (parseInt($(el.target).attr('id')) + 1).toString()).focus();
    });

    $('#4').on('input', (el) => {
        pin.push($(el.target).val());
        $(el.target).val('*');
        console.log(pin);
        callback(pin.join(''))
    });
}

/**
 * Displays error message and clears input
 */
function isWrong() {
    $('#pin_message').text('Passphrase is wrong!');
    for (let i = 1; i < 5; i++) $(`#${i}`).val('');
    $('#1').focus();
    pin = [];
}

/**
 * Display generation message
 */
function needsGeneration() {
    // TODO: Add loading animation
    $('#pin_message').text('Generating keys...');
}

exports.init = init;
exports.failure = isWrong;
exports.generate = needsGeneration;
