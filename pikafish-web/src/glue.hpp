// pikafish-web: JS <-> engine bridge (adapted from lichess-org/lila-stockfish-web, GPL-3.0)
#pragma once

#include <emscripten.h>
#include <condition_variable>
#include <cstdlib>
#include <memory>
#include <mutex>
#include <queue>
#include <streambuf>
#include <string>

// One item in the inbound queue: either a UCI text command or an NNUE buffer.
struct Command : public std::streambuf {
  enum Type { UCI, NNUE } type;
  std::string uci;
  std::shared_ptr<void> ptr = nullptr;

  // Takes ownership of a malloc'd UTF-8 string coming from JS.
  Command(const char* text) : type(UCI), uci(text) { std::free((void*)text); }

  // Takes ownership of a malloc'd NNUE buffer coming from JS; exposes it as a streambuf.
  Command(char* buf, size_t sz) : type(NNUE), ptr((void*)buf, std::free) { setg(buf, buf, buf + sz); }

  using std::streambuf::seekoff;
  using std::streambuf::seekpos;
};

struct CommandQueue {
  std::mutex m;
  std::queue<Command> q;
  std::condition_variable cv;

  void push(Command el) {
    std::unique_lock<std::mutex> lock(m);
    q.push(el);
    lock.unlock();
    cv.notify_one();
  }

  Command pop() {
    std::unique_lock<std::mutex> lock(m);
    while (q.empty())
      cv.wait(lock);
    Command el = std::move(q.front());
    q.pop();
    return el;
  }
};
