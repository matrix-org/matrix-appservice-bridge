#!/usr/bin/env node
"use strict";

// **********************************************************************
// ** This file contains a template script for updating databases from **
// ** version 0.3 to version 1.0. You will likely need to edit and     **
// ** customise it for your application service.                       **
// **********************************************************************

var Promise = require("bluebird");
var Datastore = require("nedb");
Promise.promisifyAll(Datastore.prototype);
var nopt = require("nopt");
var path = require("path");
var fs = require("fs");

const ROOM_DB = "1.0-db/rooms.db";

var opts = nopt({
    "help": Boolean,
    rooms: path,
}, {
    "h": "--help"
});

if (!opts.help && !opts.rooms) {
    console.log("--rooms is required.");
    opts.help = true;
}

if (opts.help) {
    console.log(
`Database Upgrade script (v0.3 => v1.0)
--------------------------------------

 Usage:
   --rooms   The path to rooms.db. Required.

A new room database file will be created in a directory called "1.0-db". The
existing database file will not be modified.
`
);
process.exit(0);
}

// *********************************************************
// ** You will probably want to customise these functions **
// *********************************************************

function generateMatrixEntry(opts)
{
    // This function should return an object to represent a 'type=matrix' entry
    // or 'null' if it does not wish to emit unlinked entries.
    //
    // opts will contain:
    //   'matrix': the 'data' field from the old database format
    //   'matrix_id': the 'id' field from the old database format
    return null;
}

function generateRemoteEntry(opts)
{
    // This function should return an object to represent a 'type=remote' entry
    // or 'null' if it does not wish to emit unlinked entries.
    //
    // opts will contain:
    //   'remote': the 'data' field from the old database format
    //   'remote_id': the 'id' field from the old database format
    return null;
}

function generateLinkId(opts)
{
    // This function should return a string to use as the 'id' field for linked
    // entries. Its behaviour should match the way that such IDs are generated
    // by the application service code.
    //
    // opts will contain:
    //   'matrix': the 'data' field for the matrix object
    //   'remote': the 'data' field for the remote object
    //   'matrix_id': the 'id' field for the matrix object
    //   'remote_id': the 'id' field for the remote object
    return opts.matrix_id + " " + opts.remote_id;
}

var upgradeRooms = Promise.coroutine(function*(db) {
    console.log("Upgrading rooms database");
    // 0.3 rooms.db format:
    // type=matrix, id=<matrix_id> data={...}  -- UNIQUE(id)
    // type=remote, id=<remote_id> data={...}  -- UNIQUE(id)
    // type=union, link_key=<room_id remote_id>, remote_id, matrix_id, data={...}
    //
    //
    // 1.0 rooms.db format:
    // id=*, matrix_id=<matrix_id>, remote_id=null, matrix={...}
    // id=*, matrix_id=null, remote_id=<remote_id>, remote={...}
    // id=*, matrix_id=<matrix_id>, remote_id=<remote_id>, matrix={...}, remote={...}, data={...}

    var entries = yield db.findAsync({});
    var newRoomStore = new Datastore({
        filename: ROOM_DB,
        autoload: true
    });

    var matrixRooms = {
        // matrix_id: {data fields}
    };
    var remoteRooms = {
        // remote_id: {data fields}
    };

    var insertions = {}; // unique based on ID
    function insert(id, entry)
    {
        if (id in insertions) {
            throw new Error("Duplicate id: " + id);
        }

        entry.id = id;
        insertions[id] = entry;
    }

    // First pull out matrix and remote room entities
    console.log("Loading rooms");

    entries.forEach(function(e) {
        switch (e.type) {
            case "matrix":
                if (matrixRooms[e.id]) {
                    throw new Error("Duplicate matrix id: " + e.id);
                }
                matrixRooms[e.id] = e.data;

                var entry = generateMatrixEntry({matrix_id: e.id, matrix: e.data});
                if (entry) insert(entry.id, entry);

                break;
            case "remote":
                if (remoteRooms[e.id]) {
                    throw new Error("Duplicate remote id: " + e.id);
                }
                remoteRooms[e.id] = e.data;

                var entry = generateRemoteEntry({remote_id: e.id, remote: e.data});
                if (entry) insert(entry.id, entry);

                break;
        }
    });

    console.log("Generating links");

    entries.forEach(function(e) {
        if (e.type !== "union") {
            return;
        }
        var matrixData = matrixRooms[e.matrix_id];
        var remoteData = remoteRooms[e.remote_id];

        if (!matrixData || !remoteData) {
            throw new Error("Missing matrix/remote data for union type: " + JSON.stringify(e));
        }

        var id = generateLinkId({
            matrix_id: e.matrix_id,
            remote_id: e.remote_id,
            matrix: matrixData,
            remote: remoteData,
        });

        insert(id, {
            matrix_id: e.matrix_id,
            remote_id: e.remote_id,
            matrix: matrixData,
            remote: remoteData,
            data: e.data,
        });
    });

    var insertList = [];
    Object.keys(insertions).forEach(function(k) {
        insertList.push(insertions[k]);
    });

    yield newRoomStore.insertAsync(insertList);

    // if everything worked we should have globally unique 'id' values and sparse
    // non-unique matrix_id and remote_id
    try {
        yield newRoomStore.ensureIndexAsync({
            fieldName: "id",
            unique: true,
            sparse: false
        });
        yield newRoomStore.ensureIndexAsync({
            fieldName: "matrix_id",
            unique: false,
            sparse: true
        });
        yield newRoomStore.ensureIndexAsync({
            fieldName: "remote_id",
            unique: false,
            sparse: true
        });
    } catch (err) {
        console.error(JSON.stringify(err));
    }
});

Promise.coroutine(function*() {
    try {
        fs.mkdirSync("1.0-db");
    }
    catch (err) {
        if (err.code !== "EEXIST") { throw err; }
        try { fs.unlinkSync(ROOM_DB); } catch (e) {}
    }
    var roomStore = new Datastore({
        filename: opts.rooms,
        autoload: true
    });
    yield upgradeRooms(roomStore);
    console.log("Upgrade complete.");
})();
