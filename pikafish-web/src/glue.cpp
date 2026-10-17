// pikafish-web: JS <-> engine bridge (adapted from lichess-org/lila-stockfish-web, GPL-3.0)
#include "glue.hpp"

#include <istream>
#include <string>

#include "engine.h"
#include "evaluate.h"
#include "uci.h"

// Defined in main.cpp (patched): the single UCIEngine instance.
extern Stockfish::UCIEngine* uci_global;

static CommandQueue inQ;

extern "C" {

// Queue a UCI command (malloc'd UTF-8 string from JS; freed by Command).
EMSCRIPTEN_KEEPALIVE void uci(const char* utf8) { inQ.push(Command(utf8)); }

// Queue an NNUE network (malloc'd buffer from JS; freed when consumed).
EMSCRIPTEN_KEEPALIVE void setNnueBuffer(char* buf, size_t sz) { inQ.push(Command(buf, sz)); }

// Bare filename of the network this engine build expects.
EMSCRIPTEN_KEEPALIVE const char* getRecommendedNnue() { return EvalFileDefaultName; }
}

// Called by UCIEngine::loop() instead of std::getline(std::cin, ...).
// Blocks the engine thread (a pthread, thanks to -sPROXY_TO_PTHREAD) until JS sends something.
std::string js_getline() {
    auto cmd = inQ.pop();
    if (cmd.type == Command::UCI)
        return cmd.uci;
    if (cmd.type == Command::NNUE && cmd.ptr)
    {
        std::istream in(&cmd);
        uci_global->get_engine().load_network_stream(in);
    }
    return "";
}
