//process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var fs = require('fs');
var https = require('https');

var express = require('express');
var app = express();

var options = {
  key: fs.readFileSync('./cert/yeci.online.key'),
  cert: fs.readFileSync('./cert/5a879aef07f7271a.crt')
};
var serverPort = 3006;

var server = https.createServer(options, app);
var io = require('socket.io')(server);

server.listen(serverPort, function() {
  console.log('server up and running at %s port', serverPort);
});
/*

const express = require('express');

const app = express();

const server = app.listen(3006, function() {
    console.log('server running on port 3006');
});

const io = require('socket.io')(server);*/

const history_limit = 7;
var connections = [], trackers = [], tracker_count = 0;
var admins = [], clients = [], fronts = [];

io.on('connection', function(socket) {
	console.log('Cliente conectado: ' + socket.id);
	connections[socket.id] = socket;

	socket.on('login', function (user) {
		console.log('login, total equipos: ', trackers.length);
		socket.emit('tracker_list', trackers);
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
			let track = trackers.find(obj => {
				return obj.imei == data.IMEI
			});
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
	for (var admin in admins) {
		admins[admin].emit(name, data);
	}
	for (var front in fronts) {
		fronts[front].emit(name, data);
	}
	console.log('emitido');
}
/*let result = jsObjects.find(obj => {
  return obj.b === 6
})*/