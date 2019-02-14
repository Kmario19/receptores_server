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

var request = require('request');
var WebSocket = require('ws');
var Pool = require('pg').Pool;

var url = config.TRACCAR_SERVER;
var user = {'email': config.TRACCAR_USER, 'password': config.TRACCAR_PASS};
var cookie = null;

var devices = [];
var first_time = true;

var pool = new Pool({
    user        : config.DB_USER,
    database    : config.DB_NAME,
    password    : config.DB_PASS,
    host        : config.DB_SERVER,
    port        : 5432,
    max         : 1,
    idleTimeoutMillis : 30000
});

function init() {
    request.post(url + '/api/session', { form: user }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            cookie = response.headers['set-cookie'];
            /*request({
                url: url + '/api/devices',
                headers: {
                    'Cookie': cookie
                }
            }, function (error, response, body) {
                if (!error && response.statusCode == 200) {*/
            var ws = new WebSocket('ws' + url.substring(4) + '/api/socket',[],{'headers': {'Cookie': cookie}});
            
            ws.on('open', function open() {
                console.log('Connected SOCKET!');
            });
             
            ws.on('message', function incoming(data) {
                try {
                    data = JSON.parse(data);
                } catch(e) {
                    console.log('ERROR JSON:', e);
                }
                if (data.devices) {
                    for (var i = 0; i < data.devices.length; i++) {
                        devices[data.devices[i].id] = data.devices[i];
                    }
                } else if (data.positions && !first_time) {
                    for (i = 0; i < data.positions.length; i++) {
                        console.log(data.positions[i]);
                        var track = devices[data.positions[i].deviceId];//devices.find(d => d.id == data.positions.deviceId);
                        if (track) {
                        	var trama = build_trama(track, data.positions[i]);
                        	emit_clients('trama', trama);
                            send_db(trama);
                        } else {
                            console.log('Not Track');
                        }
                    }
                } else if (data.positions && first_time) {
                    console.log('First Time, ignore positions');
                    first_time = false;
                } else {
                    console.log(data);
                }
                
            });

            ws.on('close', function close() {
                console.log('Disconnected SOCKET!');
                reintent_init();
            });
        } else {
            reintent_init();
        }
    });
}

function reintent_init(timeout) {
    if (!timeout) timeout = 5000;
    console.log('Reintentando en %i segundos...', timeout / 1000)
    setTimeout(init, timeout);
}

function send_db(trama, done) {
    pool.connect((err, pgClient) => {
        if (err) return console.error('Error PG connect: ', err);
        pgClient.query('SELECT funseguimientosatelital2($1) as response', [JSON.stringify(trama)], (err, res) => {
            if (err) {
                trama.error = err;
                pgClient.release();
                return console.error('Error PG select: ', err);
            }
            console.log('%s - %s', trama.IMEI, res.rows[0].response);
            if (typeof done == 'function')
                done(res.rows[0].response);
            pgClient.release();
        });
    });
}

function build_trama(track, position) {
    var respuesta = 0, ignition = '0', events = '8';
    if (position.protocol == 'meiligao') {
        position.attributes.ignition = position.attributes.in4 || position.attributes.in5;
    }
    if (position.protocol == 'gps103') {
		if (position.attributes.event == 'kt' || position.attributes.event == 'jt') {
			respuesta = 1;
			console.log('TRAMA RESPUESTA!');
		}			
    }
	if (position.protocol == 'h02' && position.attributes.result) {
        respuesta = 1;
        console.log('TRAMA RESPUESTA!');
    }
	if (position.attributes.ignition) {
		ignition = '1';
	}
	events += ',' + ignition;
	if (position.attributes.event == 'sos' || position.attributes.alarm == 'sos') {
		events += ',10';
	}
	if (position.attributes.event == 'powerCut' || position.attributes.alarm == 'powerCut') {
		events += ',999950';
	}
    var trama = {
        trama : '',

        receptor : 'traccar',
        ip : '',
        puerto : '',
        modelo : position.protocol,
        error : '',

        ES_TRAMA_POSICION : 1,
        ES_TRAMA_EVENTO : 0,
        ES_TRAMA_LOGIN : 0,
        ES_TRAMA_RESPUESTA : respuesta,

        IGNICION :  ignition,
        LONGITUD : '',
        IMEI : track.uniqueId,
        EVENTO : '',
        EVENTOS : events,
        COD_EVENTO : '',
        HORA : '',
        SENAL : position.valid === false ? 'V' : 'A',
        LAT : position.latitude,
        LNG : position.longitude,
        CARD_LAT : '',
        CARD_LNG : '',
        VELOCIDAD : parseFloat(position.speed * 1.852).toFixed(2),
        ORIENTACION : position.course,
        FECHA : '',
        HDOP : '',
        ALTITUD : '',
        IN_OUTS : '',
        AD1 : '',
        AD2 : '',
        AD3 : '',
        AD4 : '',
        AD5 : '',
        ODOMETRO : parseFloat(position.attributes.odometer || position.attributes.totalDistance) / 1000,
        ODOMETRO_VIRTUAL : '',
        RFID : '',
        BAT_INTERNA : '',
        BAT_EXTERNA : '',
        NUM_SATELITES : '',
        DATETIME : (new Date(position.deviceTime)).toLocaleString().replace(/-(\d)(?!\d)/g, '-0$1'), //(new Date(position.deviceTime)).toISOString().replace('T', ' ').substr(0, 19),
        DATETIME_SYS : (new Date(position.serverTime)).toLocaleString().replace(/-(\d)(?!\d)/g, '-0$1')
    }
    //console.log(trama);
    return trama;
}

const history_limit = 7, data_counter_limit = 50;
var connections = [], trackers = [];
var admins = [], clients = [], fronts = [];
var counters = {
	date: (new Date).toLocaleDateString().replace(/-(\d)(?!\d)/g, '-0$1'),
	trams: {
		per_hour: {total: 0, history: []},
		per_minute: {total: 0, history: []},
		per_second: {total: 0, history: []},
		errors: {total: 0}
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
				counters.trams.per_minute.history.push({name: (new Date).toLocaleString(), value: [(new Date).toISOString(), counters.trams.per_minute.total]});
				counters.trams.per_minute.total = 0;
				last_minute = 0;
				counters.trackers.per_hour.connected = trackers.filter(t => t.online).length;
				counters.trackers.per_hour.disconnected = trackers.filter(t => !t.online).length;
				counters.trackers.per_hour.history.push({name: (new Date).toLocaleString(), connected: counters.trackers.per_hour.connected, disconnected: counters.trackers.per_hour.disconnected});
				if (counters.date != (new Date).toLocaleDateString().replace(/-(\d)(?!\d)/g, '-0$1')) {
					updateMongo();
					counters = {
						date: (new Date).toLocaleDateString().replace(/-(\d)(?!\d)/g, '-0$1'),
						trams: {
							per_hour: {total: 0, history: []},
							per_minute: {total: 0, history: []},
							per_second: {total: 0, history: []},
							errors: {total: 0}
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
			if (track) data.IMEI = track.imei;
		}
		data.socket = socket.id;
		if (data.IMEI) {
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
		counters.trams.per_hour.total++;
		counters.trams.per_minute.total++;
		counters.trams.per_second.total++;
		if (data.error) {
			counters.trams.errors.total++;
		}
	});

	socket.on('extra_data', function (data) {
		var track = trackers.find(obj => {
			return obj.imei == data.imei
		});
		if (track && (track.placa != data.placa || track.numero != data.numero || track.cliente != data.cliente)) {
			track.placa = data.placa;
			track.cliente = data.cliente;
			track.numero = data.numero;
			data.error = true; // Para emitir solo al front
			emit_clients('extra_data', data);
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
		var imei = data.imei || data.IMEI || data;
		for (var client in clients.filter(c => c.imeis.indexOf(imei) != -1)) {
			clients[client].emit(name, data);
		}
	}
}

function updateMongo() {
	console.time('update_mongo');
	/*var collection = Mongo.db.collection('trackers');
	for (let i = 0; i < trackers.length; i++) {
		const track = trackers[i];
		collection.update(
			{ imei: track.imei },
			track,
			{ upsert: true }
		);
	}*/
	var collection = Mongo.db.collection('counters');
	collection.update(
		{ date: counters.date },
		counters,
		{ upsert: true }
	);
	console.timeEnd('update_mongo');
}

init();