/*
 * routes.js
 * Copyright (c) 2019, Texx
 * License: MIT
 *     See https://github.com/texxme/Texx/blob/master/LICENSE
 */

import {Router} from 'express';

const routes = Router();

/**
 * GET home page
 */
routes.get('/', (req, res) => {
    res.render('index');
});

export default routes;
