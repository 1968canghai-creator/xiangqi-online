// pikafish-web: JS-side API, prepended into the Emscripten factory (works on emcc 3.1.x and newer).
//
//   const engine = await Pikafish({ listen: line => ..., onError: msg => ... });
//   engine.setNnueBuffer(new Uint8Array(await (await fetch('pikafish.nnue')).arrayBuffer()));
//   engine.uci('uci'); engine.uci('position startpos'); engine.uci('go depth 12');

if (!Module['listen']) Module['listen'] = function (line) { console.log(line); };
if (!Module['onError']) Module['onError'] = function (msg) { console.error(msg); };

Module['print'] = function (line) { Module['listen'](line); };
Module['printErr'] = function (msg) { Module['onError'](msg); };

/** Send one UCI command line (no trailing newline needed). Output arrives asynchronously via listen(). */
Module['uci'] = function (command) {
  var sz = lengthBytesUTF8(command) + 1;
  var ptr = _malloc(sz); // freed by Command() in glue.hpp
  if (!ptr) throw new Error('pikafish: could not allocate ' + sz + ' bytes');
  stringToUTF8(command, ptr, sz);
  _uci(ptr);
};

/** Hand the (zstd-compressed, as downloaded) pikafish.nnue bytes to the engine. */
Module['setNnueBuffer'] = function (buf) {
  if (!buf || !buf.byteLength) throw new Error('pikafish: empty nnue buffer');
  if (!(buf instanceof Uint8Array)) buf = new Uint8Array(buf);
  var ptr = _malloc(buf.byteLength); // freed by Command() in glue.hpp
  if (!ptr) throw new Error('pikafish: could not allocate ' + buf.byteLength + ' bytes for the network');
  // Always take a fresh view: memory may have grown and stale HEAPU8 views would be detached.
  new Uint8Array(wasmMemory.buffer).set(buf, ptr);
  _setNnueBuffer(ptr, buf.byteLength);
};

/** Bare file name of the network this build expects (e.g. "pikafish.nnue"). */
Module['getRecommendedNnue'] = function () { return UTF8ToString(_getRecommendedNnue()); };
