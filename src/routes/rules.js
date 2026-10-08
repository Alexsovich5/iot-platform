/**
 * Alert rule routes: list, create, update and delete. Mounted at
 * /api/rules by routes/api.js. The Rule model and the alert service are
 * taken from the app settings 'Rule' and 'alertService' (see app.js); every
 * successful change clears the service's cached rule set.
 */

'use strict';

var express = require('express');
var http = require('./http');

var router = express.Router();

var FIELDS = ['name', 'deviceId', 'deviceType', 'metric', 'operator', 'threshold',
    'severity', 'cooldownSec', 'enabled'];

function invalidate(req) {
    var service = req.app.get('alertService');
    if (service) {
        service.invalidateRules();
    }
}

router.param('id', http.objectIdParam('rule id'));

router.get('/', function(req, res, next) {
    req.app.get('Rule').find({}).sort({createdAt: -1}).exec(function(err, found) {
        if (err) {
            return next(err);
        }
        res.json({rules: found, count: found.length});
    });
});

router.post('/', function(req, res, next) {
    req.app.get('Rule').create(http.pick(req.body, FIELDS), function(err, rule) {
        if (err) {
            return http.handleError(err, res, next);
        }
        invalidate(req);
        res.status(201).json(rule);
    });
});

router.put('/:id', function(req, res, next) {
    var updates = http.pick(req.body, FIELDS);
    req.app.get('Rule').findById(req.params.id, function(err, rule) {
        if (err) {
            return http.handleError(err, res, next);
        }
        if (!rule) {
            return res.status(404).json({error: 'Rule not found'});
        }
        rule.set(updates);
        // The model's scope validator runs only when deviceType changes,
        // so an update that adds deviceId to a type-scoped rule is checked
        // here.
        if (rule.deviceId && rule.deviceType) {
            return res.status(400).json({error: 'deviceId and deviceType are mutually exclusive'});
        }
        rule.save(function(saveErr, saved) {
            if (saveErr) {
                return http.handleError(saveErr, res, next);
            }
            invalidate(req);
            res.json(saved);
        });
    });
});

router.delete('/:id', function(req, res, next) {
    req.app.get('Rule').findByIdAndRemove(req.params.id, function(err, rule) {
        if (err) {
            return http.handleError(err, res, next);
        }
        if (!rule) {
            return res.status(404).json({error: 'Rule not found'});
        }
        invalidate(req);
        res.json(rule);
    });
});

module.exports = router;
