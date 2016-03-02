'use strict';

var net = require('net');
var util = require('util');

var conf = {
	bind: 8080
}

var handleRequest = function (chunk) {
	var client = this;
	client.pause();

	if (chunk[0] !== 0x05 && chunk[2] !== 0x00) {
		console.log('handleRequest: wrong socks version: %d', chunk[0]);
		client.end('%d%d', 0x05, 0x01);
		return;
    }

	var cmd = chunk[1];
	if(cmd != 0x01) {
		console.log('unsupported command: %d', cmd);
		client.end('%d%d', 0x05, 0x01);
		return;
	}

	var addrtype = chunk[3];
	var host = null;
	var port = null;

	var responseBuf = null;

	switch(addrtype){
		case 0x01: // ipv4
			if(chunk.length < 10) return; // 4 for host + 2 for port
			host = util.format('%d.%d.%d.%d', chunk[4], chunk[5], chunk[6], chunk[7]);
			port = chunk.readUInt16BE(8);
			responseBuf = new Buffer(10);
			chunk.copy(responseBuf, 0, 0, 10);
			chunk = chunk.slice(10);
		break;

		case 0x03: // dns
			if(chunk.length < 5) return; // if no length present yet
			var addrLength = chunk[4];
			if(chunk.length < 5 + addrLength + 2) return; // host + port
			host = chunk.toString('utf8', 5, 5 + addrLength);
			port = chunk.readUInt16BE(5 + addrLength);
			responseBuf = new Buffer(5 + addrLength + 2);
			chunk.copy(responseBuf, 0, 0, 5 + addrLength + 2);
			chunk = chunk.slice(5 + addrLength + 2);

		case 0x04: // ipv6
			if(chunk.length < 22) return // 16 for host + 2 for port
			host = chunk.slice(4, 20);
			port = chunk.readUInt16BE(20);
			responseBuf = new Buffer(22);
			chunk.copy(responseBuf, 0, 0, 22);
			chunk = chunk.slice(22);

		default:
			console.log('unsupported address type: %d', addrtype);
			client.end('%d%d', 0x05, 0x01);
			return;
	}

	var dest = net.createConnection(port, host, function() {
		responseBuf[1] = 0x00;
		responseBuf[2] = 0x00;
		client.write(responseBuf) // emit success to client
//		client.removeListener('data', onClientData);

		client.pipe(dest);
		dest.pipe(client);

		client.resume();
		client.forward = dest;

		if(chunk && chunk.length) {
			client.emit(chunk)
			chunk = null
		}

	}).once('error', function(err) {
		if(client.forward) {
			client.end('%d%d', 0x05, 0x01);
		}
	}).once('close', function() {
		if(client.forward) {
			client.end();
		}
	});

}

var handshake = function (socket, chunk) {
//	var socket = this;
    if (chunk[0] != 0x05) {
        console.log('handshake: wrong socks version: %d', chunk[0]);
        socket.end();
		return;
    }

    var method_count = chunk[1];
	if(method_count != chunk.length - 2){
		console.log('handshake: wrong method count: %d', method_count, chunk.length - 2);
		socket.end();
		return;
	}

    var auth_methods = [];
    // i starts on 1, since we've read chunk 0 & 1 already
    for (var i=2; i < method_count + 2; i++) {
        auth_methods.push(chunk[i]);
    }
    console.log('Supported auth methods: %j', auth_methods);

    var resp = new Buffer([0x05, 0x00]);
    if (auth_methods.indexOf(0x00) > -1) {
        console.log('Handing off to handleRequest');
        socket.once('data', handleRequest);
        socket.write(resp);
    } else {
        console.log('Unsuported authentication method -- disconnecting');
        resp[1] = 0xFF;
        socket.end(resp);
    }
}

var handler = function (socket){
	var client_ip = socket.remoteAddress;
	var client_port = socket.remotePort;

	socket.forward = null;

	socket.on('error', function(err) {
		console.log('[client Error]', client_ip, err);
	});
	socket.once('data', function(data) {
		console.log('[new client]', client_ip, client_port);
		handshake(socket, data);
	});
	socket.on('close', function() {
		console.log('[client disconnected]', client_ip);
	});
	socket.setTimeout(300 * 1000);
	socket.on('timeout', function() {
		console.log('[client timeout]', client_ip);
		socket.destroy();
	});
}

var ser = net.createServer({
		allowHalfOpen: false,
		pauseOnConnect: false
	}, handler);

ser.listen(conf.bind);
console.log('proxy server listen on :', conf.bind);


