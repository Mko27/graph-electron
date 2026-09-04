/**
 * The serializer MIME type announced during the Gremlin WebSocket handshake.
 *
 * It must be one TinkerPop actually registers. `application/json` is NOT: the
 * JS driver only special-cases GraphBinary and GraphSON v2, so an unrecognised
 * value leaves it writing GraphSON v3 while telling the server something else
 * entirely — and the server refuses the connection.
 *
 * GraphSON v3 is the right pick here: it is what the driver's default
 * reader/writer produce, and Neptune, JanusGraph and stock TinkerPop servers
 * all accept it.
 */
export const GREMLIN_MIME_TYPE = 'application/vnd.gremlin-v3.0+json';
