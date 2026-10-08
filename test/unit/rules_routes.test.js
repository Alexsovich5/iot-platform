'use strict';

var expect = require('chai').expect;
var sinon = require('sinon');
var request = require('supertest');
var createApp = require('../../src/app');

var RULE_ID = '56d0f1a2b3c4d5e6f7a8b9c0';

function validationError(message) {
    var err = new Error(message);
    err.name = 'ValidationError';
    return err;
}

describe('rules routes', function() {
    var Rule;
    var alertService;
    var stored;
    var app;

    beforeEach(function() {
        stored = {
            _id: RULE_ID,
            name: 'Hot',
            metric: 'temperature',
            operator: 'gt',
            threshold: 30,
            set: sinon.spy(function(fields) {
                Object.keys(fields).forEach(function(key) {
                    stored[key] = fields[key];
                });
            }),
            save: sinon.spy(function(cb) {
                process.nextTick(function() {
                    cb(null, stored);
                });
            }),
            toJSON: function() {
                return {_id: stored._id, name: stored.name, threshold: stored.threshold};
            }
        };
        Rule = {
            create: sinon.spy(function(fields, cb) {
                process.nextTick(function() {
                    cb(null, {_id: RULE_ID, name: fields.name});
                });
            }),
            findById: sinon.stub().yields(null, stored),
            findByIdAndRemove: sinon.stub().yields(null, {_id: RULE_ID, name: 'Hot'})
        };
        alertService = {invalidateRules: sinon.spy()};
        app = createApp({Rule: Rule, alertService: alertService});
    });

    it('POST /api/rules creates the rule, returns 201 and invalidates the cache once', function(done) {
        request(app)
            .post('/api/rules')
            .send({name: 'Hot', metric: 'temperature', operator: 'gt', threshold: 30, bogus: 1})
            .expect(201)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.name).to.equal('Hot');
                expect(Rule.create.firstCall.args[0]).to.not.have.property('bogus');
                expect(alertService.invalidateRules.calledOnce).to.equal(true);
                done();
            });
    });

    it('PUT /api/rules/:id updates the rule and invalidates the cache once', function(done) {
        request(app)
            .put('/api/rules/' + RULE_ID)
            .send({threshold: 40, _id: 'other'})
            .expect(200)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(stored.set.firstCall.args[0]).to.deep.equal({threshold: 40});
                expect(stored.save.calledOnce).to.equal(true);
                expect(res.body.threshold).to.equal(40);
                expect(alertService.invalidateRules.calledOnce).to.equal(true);
                done();
            });
    });

    it('DELETE /api/rules/:id removes the rule and invalidates the cache once', function(done) {
        request(app)
            .delete('/api/rules/' + RULE_ID)
            .expect(200)
            .end(function(err) {
                if (err) {
                    return done(err);
                }
                expect(Rule.findByIdAndRemove.firstCall.args[0]).to.equal(RULE_ID);
                expect(alertService.invalidateRules.calledOnce).to.equal(true);
                done();
            });
    });

    it('returns 400 for a validation error and leaves the cache alone', function(done) {
        Rule.create = function(fields, cb) {
            process.nextTick(function() {
                cb(validationError('deviceId and deviceType are mutually exclusive'));
            });
        };
        request(app)
            .post('/api/rules')
            .send({name: 'Both', deviceId: 'd1', deviceType: 'sensor'})
            .expect(400)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.error).to.match(/mutually exclusive/);
                expect(alertService.invalidateRules.called).to.equal(false);
                done();
            });
    });

    it('returns 400 for a malformed rule id', function(done) {
        request(app)
            .put('/api/rules/not-an-id')
            .send({threshold: 1})
            .expect(400)
            .end(function(err) {
                if (err) {
                    return done(err);
                }
                expect(Rule.findById.called).to.equal(false);
                done();
            });
    });

    it('returns 404 for an unknown rule on PUT and DELETE', function(done) {
        Rule.findById = sinon.stub().yields(null, null);
        Rule.findByIdAndRemove = sinon.stub().yields(null, null);
        request(app).put('/api/rules/' + RULE_ID).send({threshold: 1}).expect(404).end(function(err) {
            if (err) {
                return done(err);
            }
            request(app).delete('/api/rules/' + RULE_ID).expect(404).end(function(err2) {
                if (err2) {
                    return done(err2);
                }
                expect(alertService.invalidateRules.called).to.equal(false);
                done();
            });
        });
    });
});
