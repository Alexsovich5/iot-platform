'use strict';

/**
 * Device status rules.
 *
 * canTransition() is the operator path (REST API): any live status can move
 * to online, offline, maintenance or decommissioned; nothing returns to
 * registered, and decommissioned is final.
 *
 * nextStatusOnTraffic() is the device path: a message from the device marks
 * it online unless an operator has put it in maintenance or decommissioned it.
 */

var STATUSES = ['registered', 'online', 'offline', 'maintenance', 'decommissioned'];

var OPERATOR_TARGETS = {
    registered: ['registered', 'online', 'offline', 'maintenance', 'decommissioned'],
    online: ['online', 'offline', 'maintenance', 'decommissioned'],
    offline: ['online', 'offline', 'maintenance', 'decommissioned'],
    maintenance: ['online', 'offline', 'maintenance', 'decommissioned'],
    decommissioned: []
};

var TRAFFIC_NEXT = {
    registered: 'online',
    online: 'online',
    offline: 'online',
    maintenance: 'maintenance',
    decommissioned: 'decommissioned'
};

function canTransition(from, to) {
    if (!Object.prototype.hasOwnProperty.call(OPERATOR_TARGETS, from)) {
        return false;
    }
    return OPERATOR_TARGETS[from].indexOf(to) !== -1;
}

function nextStatusOnTraffic(current) {
    return Object.prototype.hasOwnProperty.call(TRAFFIC_NEXT, current) ?
        TRAFFIC_NEXT[current] : current;
}

module.exports = {
    STATUSES: STATUSES,
    canTransition: canTransition,
    nextStatusOnTraffic: nextStatusOnTraffic
};
