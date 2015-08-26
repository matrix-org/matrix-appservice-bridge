"use strict";
/*
Intents:
 invite|unban(A,B): -> make sure A in room, send invite from A to B.
 join(B): -> make sure B can join (invite if needed), then join.
 leave(A): -> no-op if not in room
 kick|ban(A,B,R): -> make sure A in room, then ban with reason R.

 setTopic(A,T) -> make sure A in room and has power, then set topic.
 setName(A,N): ->   "     "
 setTyping(A,T)
 sendMessage(A,M): -> make sure A in room and has power, send message.
 redact(A,E): -> make sure A in room and has power, then redact
 setPowerLevel(A,B,P) -> make sure A&B in room, make A set B's level to P.

 createRoom(A,opts): -> PM vs Public, allow A to be bot or virt user

 setDisplayName(A,N): -> make A if needed, then set profile name.
 setAvatarUrl(A,U): -> "
*/

/**
 * Create an entity which can fulfil the intent of a given user.
 * @constructor
 * @param {MatrixClient} client The matrix client instance whose intent is being
 * fulfilled e.g. the entity joining the room when you call intent.join(roomId).
 * @param {MatrixClient} botClient The client instance for the AS bot itself.
 * This will be used to perform more priveleged actions such as creating new
 * rooms, sending invites, etc.
 */
function Intent(client, botClient) {
    this.client = client;
    this.botClient = botClient;
}

/**
 * <p>Invite a user to a room.</p>
 * This will automatically make the client join the room so they can send the
 * invite if they are not already joined.
 * @param {string} roomId The room to invite the user to.
 * @param {string} invitee The user ID to invite.
 * @return {Promise} Resolved when invited, else rejected with an error.
 */
Intent.prototype.invite = function(roomId, invitee) {

};

module.exports = Intent;
