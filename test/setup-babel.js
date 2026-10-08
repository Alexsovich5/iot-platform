'use strict';

// Compiles JSX in the dashboard sources and frontend unit tests on require.
require('babel-core/register')({
    presets: ['react'],
    only: /(src\/frontend|test\/unit\/frontend)/,
    extensions: ['.js', '.jsx']
});
