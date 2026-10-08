/**
 * Small helpers shared by the rules and alerts routers.
 */

'use strict';

var OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

// Copies only the listed fields that `source` has.
function pick(source, fields) {
    var out = {};
    source = source || {};
    fields.forEach(function(field) {
        if (Object.prototype.hasOwnProperty.call(source, field)) {
            out[field] = source[field];
        }
    });
    return out;
}

// Mongoose ValidationError messages name only the model, so the 400 body
// lists the messages of the individual failed paths when there are any.
function validationMessage(err) {
    var errors = err.errors || {};
    var messages = Object.keys(errors).map(function(path) {
        return errors[path].message;
    });
    return messages.length ? messages.join(', ') : err.message;
}

// Validation and cast errors become 400; anything else goes to the app's
// error handler.
function handleError(err, res, next) {
    if (err.name === 'ValidationError' || err.name === 'CastError') {
        return res.status(400).json({error: validationMessage(err)});
    }
    next(err);
}

// router.param handler that rejects ids that are not ObjectIds with 400.
function objectIdParam(label) {
    return function(req, res, next, id) {
        if (!OBJECT_ID_RE.test(id)) {
            return res.status(400).json({error: 'Invalid ' + label});
        }
        next();
    };
}

module.exports = {
    pick: pick,
    handleError: handleError,
    objectIdParam: objectIdParam
};
