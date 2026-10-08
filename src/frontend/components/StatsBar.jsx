/**
 * Device counts by status, as returned by GET /api/stats.
 */

'use strict';

var React = require('react');

var StatsBar = React.createClass({
    propTypes: {
        stats: React.PropTypes.object.isRequired
    },

    render: function() {
        var stats = this.props.stats;
        return (
            <div className="stats-bar">
                {Object.keys(stats).map(function(key) {
                    return (
                        <div key={key} className="stat">
                            <span className="stat-label">{key}</span>
                            <span className="stat-value">{stats[key]}</span>
                        </div>
                    );
                })}
            </div>
        );
    }
});

module.exports = StatsBar;
