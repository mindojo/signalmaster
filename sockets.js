var socketIO = require('socket.io'),
    uuid = require('node-uuid'),
    crypto = require('crypto'),
    https = require('https');


module.exports = function (server, config) {
    var io = socketIO.listen(server);

    if (config.logLevel) {
        // https://github.com/Automattic/socket.io/wiki/Configuring-Socket.IO
        io.set('log level', config.logLevel);
    }

    var iceServers = [];
    var xirsysURL = 'https://global.xirsys.net/ice?' +
        'ident=' + config.xirsys.identificator +
        '&secret=' + config.xirsys.secret +
        '&domain=' + config.xirsys.domain +
        '&application=default&room=default&secure=1';
    function updateICEServers() {
        https.get(xirsysURL, function (result) {
            result.on('data', function (data) {
                var response = JSON.parse(data);
                if (response.d && response.d.iceServers) {
                    iceServers = response.d.iceServers;
                } else {
                    console.log(response);
                }
            });
        }).on('error', function (error) {
            console.log(error);
        });
    }
    updateICEServers();

    io.sockets.on('connection', function (client) {
        client.resources = {
            screen: false,
            video: true,
            audio: false
        };

        // pass a message to another id
        client.on('message', function (details) {
            if (!details) return;

            var otherClient = io.to(details.to);
            if (!otherClient) return;

            details.from = client.id;
            otherClient.emit('message', details);
        });

        client.on('shareScreen', function () {
            client.resources.screen = true;
        });

        client.on('unshareScreen', function (type) {
            client.resources.screen = false;
            removeFeed('screen');
        });

        client.on('join', join);

        function removeFeed(type) {
            if (client.room) {
                io.sockets.in(client.room).emit('remove', {
                    id: client.id,
                    type: type
                });
                if (!type) {
                    client.leave(client.room);
                    client.room = undefined;
                }
            }
        }

        function join(name, cb) {
            // sanity check
            if (typeof name !== 'string') return;
            // check if maximum number of clients reached
            if (config.rooms && config.rooms.maxClients > 0 &&
                clientsInRoom(name) >= config.rooms.maxClients) {
                safeCb(cb)('full');
                return;
            }
            // leave any existing rooms
            removeFeed();
            safeCb(cb)(null, describeRoom(name));
            client.join(name);
            client.room = name;
        }

        // we don't want to pass "leave" directly because the
        // event type string of "socket end" gets passed too.
        client.on('disconnect', function () {
            removeFeed();
        });
        client.on('leave', function () {
            removeFeed();
        });

        client.on('create', function (name, cb) {
            if (arguments.length == 2) {
                cb = (typeof cb == 'function') ? cb : function () {};
                name = name || uuid();
            } else {
                cb = name;
                name = uuid();
            }
            // check if exists
            var room = io.nsps['/'].adapter.rooms[name];
            if (room && room.length) {
                safeCb(cb)('taken');
            } else {
                join(name);
                safeCb(cb)(null, name);
            }
        });

        // support for logging full webrtc traces to stdout
        // useful for large-scale error monitoring
        client.on('trace', function (data) {
            console.log('trace', JSON.stringify(
            [data.type, data.session, data.prefix, data.peer, data.time, data.value]
            ));
        });

        client.emit('stunservers', [iceServers[0]]);
        client.emit('turnservers', iceServers.slice(1));
        updateICEServers();
    });


    function describeRoom(name) {
        var adapter = io.nsps['/'].adapter;
        var clients = adapter.rooms[name] || {};
        var result = {
            clients: {}
        };
        Object.keys(clients).forEach(function (id) {
            result.clients[id] = adapter.nsp.connected[id].resources;
        });
        return result;
    }

    function clientsInRoom(name) {
        return io.sockets.clients(name).length;
    }

};

function safeCb(cb) {
    if (typeof cb === 'function') {
        return cb;
    } else {
        return function () {};
    }
}
