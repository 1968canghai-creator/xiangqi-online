// pikafish-web: entry shim for toolchains where clang (>= 15) renames main(int, char**)
// to __main_argc_argv but the Emscripten driver (<= 3.1.7) still expects a plain `main`.
// Harmless on newer Emscripten (both symbols resolve). Only used by the web build.
extern "C" int __main_argc_argv(int, char**);

int main() {
    static char  name[] = "pikafish";
    static char* argv[] = {name, nullptr};
    return __main_argc_argv(1, argv);
}
