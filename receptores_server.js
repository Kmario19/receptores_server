var config = require("./config.json");

var fs = require('fs');
var https = require('https');

var express = require('express');
var app = express();

var options = {
  key: fs.readFileSync('./cert/yeci.online.key'),
  cert: fs.readFileSync('./cert/5a879aef07f7271a.crt')
};

var server = https.createServer(options, app);
var io = require('socket.io')(server);

const { Mongo } = require('./lib/mongo.js');

server.listen(config.SOCKET_PORT, function() {
  console.log('server up and running at %s port', config.SOCKET_PORT);
});
/*

const express = require('express');

const app = express();

const server = app.listen(3006, function() {
    console.log('server running on port 3006');
});

const io = require('socket.io')(server);*/

const history_limit = 7, data_counter_limit = 50;
var connections = [], trackers = [];
var admins = [], clients = [], fronts = [];
var counters = {
	date: (new Date).toLocaleDateString().replace(/-(\d)(?!\d)/g, '-0$1'),
	trams: {
		per_hour: {total: 0, history: []},
		per_minute: {total: 0, history: []},
		per_second: {total: 0, history: []}
	},
	trackers: {
		per_hour: {connected: 0, disconnected: 0, history: []},
	}
};

last_minute = 0, last_hour = 0;

Mongo.connectToMongo(function () {
	console.log('Conectado a MONGO');
	Mongo.db.collection('trackers').find({}, { projection: { _id: 0 } }).toArray(function(err, result) {
		trackers = result;
		setInterval(() => {
			updateMongo();
		}, 600000);
	});
	Mongo.db.collection('counters').find({date: counters.date}, { projection: { _id: 0 } }).toArray(function(err, result) {
		if (err) console.log('%s', err);
		if (result.length) counters = result[0];
		setInterval(() => {
			if (counters.trams.per_second.history.length > data_counter_limit) {
				counters.trams.per_second.history.shift();
			}
			counters.trams.per_second.history.push({name: (new Date).toLocaleString(), value: [(new Date).toISOString(), counters.trams.per_second.total]});
			counters.trams.per_second.total = 0;
			if (last_minute >= 60) {
				if (counters.trams.per_minute.history.length > data_counter_limit) {
					counters.trams.per_minute.history.shift();
				}
				counters.trams.per_minute.history.push({name: (new Date).toLocaleString(), connected: counters.trackers.connected, disconnected: counters.trackers.disconnected});
				counters.trams.per_minute.total = 0;
				last_minute = 0;
				counters.trackers.per_hour.connected = trackers.filter(t => t.online).length;
				counters.trackers.per_hour.disconnected = trackers.filter(t => !t.online).length;
				counters.trackers.per_hour.history.push({name: (new Date).toLocaleString(), value: [(new Date).toISOString(), counters.trams.per_minute.total]});
				if (counters.date != (new Date).toLocaleDateString().replace(/-(\d)(?!\d)/g, '-0$1')) {
					updateMongo();
					counters = {
						date: (new Date).toLocaleDateString().replace(/-(\d)(?!\d)/g, '-0$1'),
						trams: {
							per_hour: {total: 0, history: []},
							per_minute: {total: 0, history: []},
							per_second: {total: 0, history: []}
						},
						trackers: {
							per_hour: {connected: 0, disconnected: 0, history: []},
						}
					};
				}
			}
			if (last_hour >= 3600) {
				counters.trams.per_hour.history.push({name: (new Date).toLocaleString(), value: [(new Date).toISOString(), counters.trams.per_hour.total]});
				counters.trams.per_hour.total = 0;
				last_hour = 0;
			}
			last_minute++;
			last_hour++;
		}, 1000);
	})
});

io.on('connection', function(socket) {
	console.log('Cliente conectado: ' + socket.id);
	connections[socket.id] = socket;

	socket.on('login', function (user) {
		console.log('login, total equipos: ', trackers.length);
		socket.emit('tracker_list', trackers);
		socket.emit('counters', counters);
		fronts[socket.id] = socket;
	});

	socket.on('login_client', function (imeis) {
		console.log('login_client, total imeis: ', imeis.length);
		clients[socket.id] = {socket: socket, imeis: imeis};
	});

	socket.on('login_admin', function () {
		console.log('login_admin, total equipos: ', trackers.length);
		admins[socket.id] = socket;
	});

	socket.on('trama', function (data) {
		console.log('trama', data.IMEI);
		if (data.IMEI) {
			var track = trackers.find(obj => {
				return obj.imei == data.IMEI
			});
		} else {
			var track = trackers.find(obj => {
				return obj.ip == data.ip && obj.puerto == data.puerto
			});
			data.imei = track.imei;
		}
		data.socket = socket.id;
		if (track) {
			track.tramas.unshift(data); // Add start
			if (track.tramas.length >= history_limit) {
				track.tramas.pop(); // Remove end
			}
			track.socket = socket.id;
			track.online = true;
			track.ip = data.ip;
			track.puerto = data.puerto;
		} else {
			trackers.push({imei: data.IMEI, ip: data.ip, puerto: data.puerto, socket: socket.id, online: true, tramas: [data]});
		}
		//io.emit('trama', data);
		emit_clients('trama', data);
		counters.trams.per_hour.total++;
		counters.trams.per_minute.total++;
		counters.trams.per_second.total++;
		if (data.error) {
			counters.total_error++;
		}
	});

	socket.on('track_disconnect', function (data) {
		let track = trackers.find(obj => {
			return obj.ip == data.ip && obj.puerto == data.puerto
		});
		if (track) {
			track.online = false;
			emit_clients('track_disconnect', track.imei);
			console.log('Desconectado: ', track.imei, track.ip, track.puerto);
		} else {
			console.log('No se encontró desconectado');
		}
	});

	socket.on('disconnect', function () {
		delete connections[socket.id];
		delete admins[socket.id];
		delete clients[socket.id];
		delete fronts[socket.id];
		console.log('Cliente desconectado: ' + socket.id);
	});

	socket.on('command', function (track, command, value) {
		/*let track = trackers.find(obj => {
			return obj.imei == imei
		});
		if (!track) return false;*/
		var s = connections[track.socket];
		if (s) {
			s.emit('command', track, command, value);
			console.log('Comando enviado');
		} else {
			console.log('Comando no enviado');
		}
	});
	socket.on('command_imei', function (imei, command, value) {
		let track = trackers.find(obj => {
			return obj.imei == imei
		});
		if (!track) {
			console.log('No se encontró equipo para enviar comando %s', imei);
			return false;
		}
		var s = connections[track.socket];
		if (s) {
			s.emit('command', track.tramas[0], command, value);
			console.log('Comando enviado a %s - %s:%s', track.imei, track.ip, track.puerto);
		} else {
			console.log('Comando no enviado');
		}
	});
});

function emit_clients(name, data) {
	for (var front in fronts) {
		fronts[front].emit(name, data);
	}
	if (!data.error) {
		for (var admin in admins) {
			admins[admin].emit(name, data);
		}
		var imei = data.imei || data;
		for (var client in clients.filter(c => c.imeis.indexOf(imei) != -1)) {
			clients[client].emit(name, data);
		}
	}
}

function updateMongo() {
	console.time('update_mongo');
	var collection = Mongo.db.collection('trackers');
	for (let i = 0; i < trackers.length; i++) {
		const track = trackers[i];
		collection.update(
			{ imei: track.imei },
			track,
			{ upsert: true }
		);
	}
	collection = Mongo.db.collection('counters');
	collection.update(
		{ date: counters.date },
		counters,
		{ upsert: true }
	);
	console.timeEnd('update_mongo');
}
/*let result = jsObjects.find(obj => {
  return obj.b === 6
})*/