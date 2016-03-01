'use strict';

var net = require('net');
var cluster = require('cluster');
var crypto = require('crypto');
var repl = require("repl");

var Mux = require('./mux.js');

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
		resbind: 2000, // the port for resource server connect
		slots_base: 2010, // the port for client connect
		slots_count: 5, // from '2010 + 0' to '2010 + 5'
		admin_port: 9999
	};

	var count = 0;

	var res_pool = [];


	var VAL = {
		'Magic': 'GET / HTTP/1.1',
		'START': '\n\n',
		'Fin': '\n.\n',
	}

    var find = function(addr, cb, index) {
        var i = index || 0;
        //console.log('debug', addr, index, i);
        if (i < VIP.length) {
            //socket.remoteAddress
            if ((typeof addr) === 'string') {
                if (addr.match(VIP[i])) {
                    //setImmediate(cb, true);
                    cb(addr, true);
                } else {
                    setImmediate(find, addr, cb, i + 1);
                }
            }
        } else {
            //setImmediate(cb, false);
            cb(addr, false);
        }
    }

	var checkInfo = function(data){
		var header = data.indexOf(VAL.Magic);
		var fin = data.indexOf(VAL.FIN);
		if((header != -1)&&(fin != -1)){
			return true;
		}else{
			return false;
		}
	}

    var make_server = function(profile){
		var ser = net.createServer({
			allowHalfOpen: false,
			pauseOnConnect: false
		}, function(socket) {
			var client_ip = socket.remoteAddress;
			socket.on('error', function(err) {
				console.log(now(), '[res Error]', client_ip, err);
			});
			socket.once('data', function(data) {
//				console.log(now(), '[client data]', client_ip, data);
				/*// parse info & reg handler
				if(checkInfo(data)){
					socket.setTimeout(5 * 60 * 1000);
					res_pool.push(socket);
				}else{
					socket.destroy();
				}*/
			});
			socket.on('close', function() {
				console.log(now(), '[res disconnected]', client_ip);
			});
			socket.setTimeout(300 * 1000);
			socket.on('timeout', function() {
				console.log(now(), '[res timeout]', client_ip);
				socket.destroy();
			});
		});
		return ser;
    }

//	var ser = make_server();
//	ser.listen(conf.resbind);
//	console.log(now(), 'res server start at', conf.resbind);

//

	var mkserver = function(profile){
		var ser = net.createServer({
			allowHalfOpen: false,
			pauseOnConnect: false
		}, function (socket) {
			var client_ip = socket.remoteAddress;
			socket.on('error', function(err) {
				console.log(now(), '[hub <-> client Error]', client_ip, err);
			});
			/*socket.on('data', function(data) {
//				console.log(now(), '[res <-> hub data]', client_ip, data);
				console.log(now(), '[res <-> hub data]', client_ip);
			});
			socket.on('close', function() {
				console.log(now(), '[res <-> hub disconnected]', client_ip);
			});*/
			socket.setTimeout(300 * 1000);
			socket.on('timeout', function() {
				console.log(now(), '[hub <-> client timeout]', client_ip);
				socket.destroy();
			});
		});
		return ser;
    }

	var pool = new Mux.Allocate(conf.slots_count);
	var res_server = make_server();
	res_server.on('connection', function(res_socket){
		var iomux = new Mux.mux(res_socket);
		var new_server = mkserver();
		var server_id = pool.new(new_server);

		console.log(now(), '[mk server]', server_id);
		if(server_id < 0){
			console.log(now(), '[mk server][pool full]', pool);
			res_socket.destroy();
			return;
		}

		new_server.on('connection', function(socket){
			var ch_id = iomux.new(socket);
			if(ch_id < 0){
				console.log(now(), '[res server][ch full]');
				socket.destroy();
				return;
			}

			console.log(now(), '[res server][new ch]', ch_id);
		});
		var stop_server = function (){
			console.log(now(), '[stopping server]', server_id);
			iomux.closeAll();
			new_server.close(function(){
				pool.freeId(server_id);
				console.log(now(), '[server close]', server_id);
			});
		}
		//iomux.on('empty', stop_server);

		res_socket.on('close', function(){
			console.log(now(), '[res <-> hub disconnected]');
			stop_server();
		});

		new_server.listen(conf.slots_base + server_id);
	});
	res_server.listen(conf.resbind);


}


