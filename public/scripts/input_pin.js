/*
 * input_pin.js
 * Copyright (c) 2019, Texx
 * License: MIT
 *     See https://github.com/texxme/Texx/blob/master/LICENSE
 */

const $ = require('jquery');
let pin = [];

/**
 * Initializes actions of the pin input field
 * @param callback
 */
function init(callback) {
    let tryCount = 0;

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
        tryCount++;
        callback(pin.join(''), tryCount)
    });
}

/**
 * Displays error message and clears input
 */
function isWrong(message) {
    $('#pin_message').text(message);
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
