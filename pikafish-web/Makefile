# pikafish-web — build Pikafish as a browser/Node WebAssembly module.
#
#   make PIKAFISH=/path/to/Pikafish -j$(nproc)
#
# Produces dist/pikafish.js, dist/pikafish.wasm, dist/pikafish.worker.js (older emcc only).
# Requires: Emscripten (emcc 3.1.x or newer) and a Pikafish checkout with patches/pikafish-web.patch applied.

PIKAFISH ?= ../Pikafish
SRC      := $(PIKAFISH)/src
OUT      ?= dist
NAME     ?= pikafish
BUILD    := build

CXX := em++

# Mirrors `make ARCH=wasm32` in Pikafish's own Makefile (minus -m64, which emcc rejects/ignores).
CXXFLAGS := -std=c++17 -O3 -DNDEBUG -fno-exceptions -funroll-loops -flto=full \
	-Wall -Wcast-qual -Wextra -Wshadow -flax-vector-conversions=none \
	-DIS_64BIT -DNO_PREFETCH -DUSE_POPCNT -DUSE_SLOPPY_ATOMICS -DARCH=wasm32 \
	-DUSE_SSE41 -msse4.1 -DUSE_SSSE3 -mssse3 -DUSE_SSE2 -msse2 -msimd128 -pthread \
	-I$(SRC) -I$(SRC)/external -I$(SRC)/external/common -I$(SRC)/external/decompress \
	$(EXTRA_CXXFLAGS)

LDFLAGS := -pthread -sPROXY_TO_PTHREAD -sALLOW_BLOCKING_ON_MAIN_THREAD=0 \
	-sMODULARIZE -sEXPORT_NAME=Pikafish -sENVIRONMENT=web,worker,node \
	-sEXPORTED_FUNCTIONS='[_malloc,_main]' \
	-sEXPORTED_RUNTIME_METHODS='[stringToUTF8,UTF8ToString,lengthBytesUTF8]' \
	-sINCOMING_MODULE_JS_API='[locateFile,print,printErr,wasmMemory,buffer,instantiateWasm,wasmBinary,mainScriptUrlOrBlob,onExit,onAbort,noExitRuntime]' \
	-sINITIAL_MEMORY=192MB -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=2GB -sTOTAL_STACK=3MB \
	-sEXIT_RUNTIME -sSTRICT -Wno-pthreads-mem-growth \
	--pre-js=src/pre.js \
	$(EXTRA_LDFLAGS)

# Same file set as Pikafish's own Makefile: every .cpp under src/ except universal/ and temp_builds/.
ENGINE_SRCS := $(shell find -L $(SRC) \( -path '$(SRC)/universal' -o -path '$(SRC)/temp_builds' \) -prune -o -name '*.cpp' -print)
OBJS := $(patsubst $(SRC)/%.cpp,$(BUILD)/%.o,$(ENGINE_SRCS)) $(BUILD)/glue.o
# MAIN_SHIM=1 is needed only for mismatched toolchains (clang >= 15 with Emscripten <= 3.1.7,
# e.g. Ubuntu's apt package). build.sh detects this automatically.
ifeq ($(MAIN_SHIM),1)
OBJS += $(BUILD)/main_shim.o
endif

all: $(OUT)/$(NAME).js

$(OUT)/$(NAME).js: $(OBJS) src/pre.js | $(OUT)
	$(CXX) $(CXXFLAGS) $(LDFLAGS) $(OBJS) -o $@

$(BUILD)/%.o: $(SRC)/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/glue.o: src/glue.cpp src/glue.hpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/main_shim.o: src/main_shim.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -MMD -MP -c $< -o $@

$(OUT):
	mkdir -p $@

clean:
	rm -rf $(BUILD) $(OUT)

-include $(OBJS:.o=.d)
.PHONY: all clean
