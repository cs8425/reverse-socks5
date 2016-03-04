'use strict';

var net = require('net');
var cluster = require('cluster');
var crypto = require('crypto');
var repl = require("repl");

var mux = require('./mux.js');

var pand = function(num) {
    return (num < 10) ? '0' + num : num + '';
}

var now = function() {
    var t = new Date();
    var out = '[';
    out += t.getFullYear();
    out += '/' + pand(t.getMonth() + 1);
    out += '/' + pand(t.getDate());
    out += ' ' + pand(t.getHours());
    out += ':' + pand(t.getMinutes());
    out += ':' + pand(t.getSeconds()) + ']';
    return out;
}

if (cluster.isMaster) {
    cluster.fork();
    cluster.on('exit', function(worker, code, signal) {
        console.log(now(), 'worker ' + worker.process.pid + ' died');
        cluster.fork();
    });

} else {

	var conf = {
		hub_host: '127.0.0.1', // hub server here
		hub_port: 4030,
		local_socks: '127.0.0.1', // your local socks server
		local_socks_port: 8080
	};

	var to_hub = function (host, port){
		var hub = net.connect(port, host);
		var iomux = null;
//console.log('init', hub);
		hub.on('connect', function (){
//console.log('connect', hub);
			iomux = new mux.mux(hub);

			var new_ch = function (ch_id){
				var self = this;
				var socket = net.connect(conf.local_socks_port, conf.local_socks);
				var id = self.assign(ch_id, socket);
				if(id >= 0){
					socket.id = id;
					//console.log('[new_ch]', ch_id);
				}else{
					console.log('[new_ch][full]', ch_id, self.count());
					socket.destroy();
				}
			}
			iomux.on('new_ch', new_ch);

		});

		hub.on('error', function(err) {
			console.log(now(), '[to hub Error]', err);
		});
		hub.on('end', function() {
			console.log(now(), '[to hub End]');
			hub.destroy();
		});
		hub.on('close', function() {
			console.log(now(), '[to hub disconnected]');
			if(iomux) iomux.closeAll();
			var t = setTimeout(connect, 3000);
		});
		hub.setTimeout(300 * 1000);
		hub.on('timeout', function() {
			console.log(now(), '[to hub timeout]');
			hub.destroy();
		});

		return hub;
	}

	var connect = function (){
		to_hub(conf.hub_host, conf.hub_port);
		console.log(now(), 'reverse proxy server connect to', conf.hub_host, ':', conf.hub_port);
	}
	connect();
}


