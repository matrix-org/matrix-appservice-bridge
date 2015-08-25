"use strict";

/**
 * @constructor
 */
function Bridge() {

}

Bridge.prototype.setMatrixSide = function(side) {
    // HS url, AS token, localpart, domain
};

Bridge.prototype.setJungleSide = function(side) {

};

Bridge.prototype.run = function() {
    // listen on AS port
    // invoke onRun on Jungle side
};

/*
NOTES:
Have a concept of a 'Side' of the bridge, the Matrix side and the Jungle side.
We can implement the Matrix side, but they need to do the Jungle side. Each
side has functions for *sending* actions e.g.
  side = {
    invite: function,
    join: function,
    sendMessage: function
  }
This interface means we can call through to the jungle side even without knowing
their impl. This gets tricky though for non 1:1 mappings so we need to be able
to 'fallback' to more generic functions too.

The matrix side will have handlers called, and we have default handlers which map
1:1 e.g. onInvite -> jungleSide.invite() - we need to allow these handlers to be
overridden.

How does the jungle side work? We expose matrix.invite() and just expect them
to do the right incantation? Could work but requires knowledge of matrix API e.g.
invite before join. Unless this is the "intent"? In which case people who skip
invite() would be fine because the intent is to join() by any means necessary e.g.
the bridge does the invite transparently?

Noddy example:

matrixSide.join = HTTP POST /join/$ROOM_ID
jungleSide.join = /join $CHANNEL

matrixSide.onJoin = jungleSide.join() // TODO: Mapping?
jungleSide.onJoin = matrixSide.join() // TODO: Mapping?

Provide mapping functions? (e.g. here is a room ID / name / topic / alias, how
do I represent this in your language? This depends on stored state possibly..
so expose user/room stores?) e.g.

mapRoomId: function(roomId, roomAlias, roomStore) {
    return "something jungle side will recognise; allow objects as well as strings";
}

mapJungleId: function(jungleId, roomStore) {
    // How could the bridge ever actually call this; where does jungleId come from?
    return roomId;
}


*/

/*

var b = new Bridge();

b.setMatrixSide({
    config: url, token, domain, localpart, portToListenOn,

    onAliasQuery: function() {
        // return promise?
        // have default impls (e.g. PROVISION_ROOM)
    },

    onUserQuery: function() {
        // return promise?
        // have default impls (e.g. PROVISION_USER)
    },

    onIncomingRequest: function(request) {
        // steps to map generic requests (events) from matrix to jungle (unfiltered)
    }

    onInvite: function(request) {
        // steps to map invites from matrix to jungle
    }

    onJoin: function(request) {
        // steps to map joins from matrix to jungle
    }

    onSend: function(request) {
        // steps to map messages from matrix to jungle
    },

    send: function(thing) {}
    join: function(thing) {}
    invite: function(thing) {}

});

b.run();
*/


module.exports = Bridge;
