var config = require("./../config.json");
const MongoClient = require('mongodb').MongoClient;

class Mongo {
    static connectToMongo(done) {
        if ( this.db ) return Promise.resolve(this.db);
        this.client = new MongoClient(this.url, this.options);
        this.client.connect(function (err) {
            if (err) {
                return console.error(err);
            }
            Mongo.db = Mongo.client.db(config.MONGO_DB);
            done();
        });
    }
}

Mongo.client = null;
Mongo.db = null;
Mongo.url = 'mongodb://' + config.MONGO_USER + ':' + config.MONGO_PASS + '@' + config.MONGO_SERVER + ':27017';
Mongo.options = {
    bufferMaxEntries:   0,
    reconnectTries:     5000,
    useNewUrlParser:    true
}

Mongo.insert_trama = function(trama) {
    const collection = this.db.collection(trama.receptor.toString());
    collection.insertOne(trama);
}

Mongo.insert_error = function(trama) {
    const collection = this.db.collection(trama.receptor + '_errores');
    collection.insertOne(trama);
}

module.exports = { Mongo }