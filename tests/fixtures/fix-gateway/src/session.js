/** One FIX session between the desk and a venue: sequence numbers and heartbeats. */
class Session {
  constructor({ senderCompId, targetCompId, heartbeat }) {
    this.senderCompId = senderCompId;
    this.targetCompId = targetCompId;
    this.heartbeat = heartbeat;
    this.nextSeqNum = 1;
    this.lastSent = 0;
  }

  send(type, at) {
    this.lastSent = at;
    return { type, seqNum: this.nextSeqNum++ };
  }

  /** A heartbeat (0) once the interval has passed without a message, or the one a test request (1) asks for. */
  due(now, testRequestId = null) {
    if (testRequestId !== null) return { type: '0', testRequestId };
    return now - this.lastSent >= this.heartbeat * 1000 ? { type: '0', testRequestId: null } : null;
  }
}

module.exports = { Session };
