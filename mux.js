'use strict';

const util = require('util');
const EventEmitter = require('events').EventEmitter;
const stream = require('stream');
const Transform = require("stream").Transform;

var Mux = {};
module.exports = Mux;

var Allocate = function (num){
	if (!(this instanceof Allocate)) {
		return new Allocate(num);
	}

	if(num <= 0) return;
	this.slots = [];
	this.count = 0;
	var slots = this.slots;
	for(var i=0; i<num; i++){
		slots[i] = null;
	}
}
Allocate.prototype.new = function (obj){
	var slots = this.slots;
	for(var i=0; i<slots.length; i++){
		if(slots[i] == null){
			slots[i] = obj;
			this.count++;
			return i;
		}
	}
	return -1;
}
Allocate.prototype.assign = function (id, obj){
	var slots = this.slots;
	if(id >= slots.length){
		return -1;
	}
	if(slots[id] == null){
		slots[id] = obj;
		this.count++;
		return id;
	}
	return -1;
}
Allocate.prototype.has = function (obj){
	var slots = this.slots;
	for(var i=0; i<slots.length; i++){
		if(slots[i] == obj){
			return i;
		}
	}
	return -1;
}
Allocate.prototype.getId = function (id){
	var slots = this.slots;
	if(slots[id] != null){
		return slots[id];
	}else{
		return null;
	}
}
Allocate.prototype.free = function (obj){
	var slots = this.slots;
	for(var i=0; i<slots.length; i++){
		if(slots[i] == obj){
			slots[i] = null;
			this.count--;
			return i;
		}
	}
	return -1;
}
Allocate.prototype.freeId = function (id){
	var slots = this.slots;
	if(id >= slots.length){
		return false;
	}
	if(slots[id] != null){
		slots[id] = null;
		this.count--;
		return true;
	}
	return false;
}
Allocate.prototype.dump = function (){
	var slots = this.slots;
	console.log('[Allocate][dump]', slots.length);
	var used = [];
	for(var i=0; i<slots.length; i++){
		if(slots[i] != null){
			used.push(i);
		}
	}
	console.log('[Allocate][dump]', used.length, used);
}


const ACT = {
	NEW: 0,
	FIN: 1,
	CLS: 2,
	ERR: 4,
}

function readHead(data){
	var out = {};

	if(data[0] == 0xFF){
		// CONTORLL pack
		out.type = 0;
		out.channel = data[1];
		out.act = data[2];
	}else{
		// DATA pack
		out.type = 1;
		out.channel = data[0];
		out.length = data.readUInt16BE(1);
	}

	return out;
}

var rechunk = function (input, output){
	var meta = this;
	meta.FIFO = [];
	meta.buff = new Buffer(0);

	meta.handler = function (chunk1){
		var socket = this;
//		console.log('in', meta, meta.buff, chunk);
		meta.buff = Buffer.concat([meta.buff, chunk1]);
		var chunk = meta.buff;

		while(1){
			if(chunk.length < 3) break;

			var pack = readHead(chunk);
			var len = chunk.length - 3;
//			console.log('[rechunk]', pack);
			if(pack.type == 1){
				var datalen = pack.length;
				if(len < datalen){
					break;
				}
				if(len > datalen){
					meta.FIFO.push(chunk.slice(0, datalen + 3));
					meta.buff = chunk = chunk.slice(datalen + 3);
				}else{
					meta.FIFO.push(chunk);
					meta.buff = new Buffer(0);
					break;
				}
			}else{
				// CONTORLL pack
				meta.FIFO.push(chunk.slice(0, 3));
				meta.buff = chunk = chunk.slice(3);
				if(len == 0){
					break;
				}
			}
		}

		// trigger emitter
		if(meta.FIFO.length){
			process.nextTick(emit_buff);
			//setImmediate(emit_buff);
		}
	}

	var emit_buff = function () {
    	if(meta.FIFO.length){
    		var out = meta.FIFO.shift();
//			console.log('[rechunk]', out);
            output.emit('data', out);
    		process.nextTick(emit_buff);
			//setImmediate(emit_buff);
    	}
    }

	input.on('data', meta.handler);

	return meta.handler;
}

function mux(mux_io){
	if (!(this instanceof mux)) {
		return new mux(mux_io);
	}

	var meta = this;
	meta.mux_io = mux_io;

	var allo = meta.allo = new Allocate(255);
	var pack_in = meta.pack_in = new EventEmitter();

	var parse_pack = function (pack){
//		console.log('[pack]', pack);
		var out = readHead(pack);
		var ch_id = out.channel;
		var socket = allo.getId(ch_id);
		if(out.type == 1){
//			console.log('[pack][DATA]', ch_id, out.length, pack.slice(3, 8));
			meta.emit('data_ch', out.channel, pack.slice(3));

			if(socket){
				socket.write(pack.slice(3));
			}else{
				console.log('[pack][DATA] channel not found', ch_id, out.length);
			}
		}else{
			// CONTORLL pack
			var ev = null;
			switch(out.act){
				case ACT.NEW:
					ev = 'new_ch';
				break;
				case ACT.FIN:
					ev = 'end_ch';
					if(socket){
						meta.end(ch_id, 0);
						socket.flag = socket.flag | ACT.FIN;
					}
				break;
				case ACT.CLS:
					ev = 'close_ch';
					if(socket){
						meta.close(ch_id, 0);
						socket.destroy();
						socket.flag = socket.flag | ACT.CLS;
					}
					if(meta.count() == 0){
						meta.emit('empty');
					}
				break;
				case ACT.ERR:
					ev = 'err_ch';
					if(socket){
						meta.error(ch_id, 'by CTRL pack');
						socket.flag = socket.flag | ACT.ERR;
					}
				break;
			}
			if(ev){
				console.log('[pack][CTRL]', out, ev);
				meta.emit(ev, out.channel);
			}else{
				console.log('[pack][CTRL] ACT not found', out);
			}
		}
	}

	meta.rechunker = new rechunk(mux_io, pack_in);
	pack_in.on('data', parse_pack);

//	console.log('[new mux]', this);

}
util.inherits(mux, EventEmitter);
mux.prototype.count = function (){
	var allo = this.allo;
	return allo.count;
//	console.log('[mux sub count]', this);
}
var binding = function(self, id, socket, type){
	var allo = self.allo;
	var mux_io = self.mux_io;
	var head = (type == 1) ? '[sub]' : '[in]';
	if(type == 1){
		id = allo.assign(id, socket);
		console.log('[mux set new ch]', id, self.count());
	}else{
		id = allo.new(socket);
		var cmd = new Buffer([0xFF, id, ACT.NEW]);
		console.log('[mux new ch]', id, self.count());
	}
	if(id >= 0){
		if(type != 1) mux_io.write(cmd);
		socket.id = id;
		socket.flag = 0x00;
		socket.on('data', function(data){
//			console.log(head + '[ch' + id + ']data', data.length, data.slice(0, 5));
			self.write(id, data);
		});
		socket.on('close', function(){
			console.log(head + '[ch' + id + ']close');
			self.close(id, !(socket.flag & ACT.CLS));
		});
		socket.on('end', function(){
			console.log(head + '[ch' + id + ']end');
			self.end(id, !(socket.flag & ACT.FIN));
		});
		socket.on('error', function(err){
			console.log(head + '[ch' + id + ']err', err);
			self.error(id, err);
		});
	}
	return id;
}
// do at local only
mux.prototype.assign = function (id, socket){
	return binding(this, id, socket, 1);
}
mux.prototype.closeAll = function (){
	var self = this;
	var allo = self.allo;
	var mux_io = self.mux_io;
	console.log('[mux close All]', self.count());
	if(self.count() > 0){
		var slots = allo.slots;
		var i = 0;
		for(i=0; i<slots.length; i++){
			if(slots[i]){
				slots[i].flag = slots[i].flag | ACT.CLS;
				slots[i].destroy();
			}
		}
	}
}

// send status over net
mux.prototype.new = function (socket){
	return binding(this, -1, socket, 0);
}
mux.prototype.write = function (id, data){
//	console.log('[mux write]', id, data.length, data.slice(0, 5));
	var mux_io = this.mux_io;
	var buf = new Buffer([id, 0x00, 0x00]);
	var len = data.length;
	var out = data;
	var maxlen = 0xFFFF;
if(len == 0) console.log('[mux write]length == 0 !!', id, data);
	var bufMx = new Buffer([id, 0x00, 0x00]);
	bufMx.writeUInt16BE(maxlen, 1);

	while(1){
		if(len > maxlen){
//			console.log('[mux write]', id, maxlen, out.slice(0, 5));
			mux_io.write(bufMx);
			mux_io.write(out.slice(0, maxlen));
			out = out.slice(maxlen);
			len -= maxlen;
		}else{
//			console.log('[mux write]', id, len, out.length, out.slice(0, 5));
			buf.writeUInt16BE(len, 1);
			mux_io.write(buf);
			mux_io.write(out);
			break;
		}
	}
}
mux.prototype.error = function (ch_id, err){
	// ch input error
	console.log('[mux error][' + ch_id + ']', err);
	var mux_io = this.mux_io;
	if(err == 'by CTRL pack'){

	}else{
		var buf = new Buffer([0xFF, ch_id, ACT.ERR]);
		mux_io.write(buf);
	}
}
mux.prototype.end = function (ch_id, type){
	// ch end
//	console.log('[mux input end][' + ch_id + ']');
	var mux_io = this.mux_io;
	if(type){
		var buf = new Buffer([0xFF, ch_id, ACT.FIN]);
		mux_io.write(buf);
	}
}
mux.prototype.close = function (ch_id, type){
	// ch close
//	console.log('[mux input close][' + ch_id + ']');
	var mux_io = this.mux_io;

	if(type){
		var buf = new Buffer([0xFF, ch_id, ACT.CLS]);
		mux_io.write(buf);
	}

	var allo = this.allo;
	allo.freeId(ch_id);
//	console.log('[mux close][' + ch_id + ']', allo);
}


Mux.rechunk = rechunk;
Mux.Allocate = Allocate;

Mux.mux = mux;

function Socket(isserver, client, options){
	if (!(this instanceof Socket)) {
		return new Socket(isserver, client, options);
	}
	stream.Duplex.call(this, options);

	var self = this;
	self.timer = null;
	self.timeout = null;
	self.timeoutFn = null;
	self.isserver = (isserver) ? true : false;
	if(!isserver){
		self.server = new Socket(true, self, options);
	}else{
		self.client = client;
	}
	self.__timeout = function(){
		console.log('[Socket][Timeout]', self.isserver);
		self.emit('timeout');
	};
}
util.inherits(Socket, stream.Duplex);
Socket.prototype._read = function(n){
//	console.log('[Socket][_read]', this.isserver, n, this._readableState.buffer);
//	this.push(this._readableState.buffer.shift());
	var self = this;
	if(self.timeout){
		if(self.timer) clearTimeout(self.timer);
		self.timer = setTimeout(self.__timeout, self.timeout);
		self.timer.unref();
	}
};
Socket.prototype._write = function(data, encoding, cb){
	var self = this;
	if(self.timeout){
		if(self.timer) clearTimeout(self.timer);
		self.timer = setTimeout(self.__timeout, self.timeout);
		self.timer.unref();
	}

	var output = (this.isserver) ? this.client : this.server;
	output.push(data);
//	console.log('[Socket][_write]', this.isserver, data, output.isserver);
	cb();
};
Socket.prototype.destroy = function(exception){
	console.log('[Socket][destroy]', this.isserver, this.id, exception);
	this.emit('close', exception);
};
Socket.prototype.end = function(data, encoding){
	console.log('[Socket][end]', this.isserver, data, this.id);
	//this.emit('end', data);
	stream.Duplex.prototype.end.call(this, data, encoding);
};
Socket.prototype.setTimeout = function(msecs, cb){
	console.log('[Socket][setTimeout]', this.isserver, msecs, cb);
	var self = this;
	if(msecs === 0){
		if(self.timer) clearTimeout(self.timer);
		if (cb) {
			this.removeListener('timeout', cb);
		}
	}else{
		self.timeout = msecs;
		self.timer = setTimeout(self.__timeout, self.timeout);
		self.timer.unref();
		if (cb) {
			this.once('timeout', cb);
		}
	}
	return this;
};
/*Socket.prototype.__timeout = function(){
	console.log('[Socket][Timeout]', this.isserver);
	this.emit('timeout');
};*/
Mux.Socket = Socket;



